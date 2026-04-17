import type { SupabaseClient } from '@supabase/supabase-js'

export const SUPPORTED_PERSONAL_RECORD_DISTANCES = [5000, 10000, 21097, 42195] as const

export type SupportedPersonalRecordDistance = (typeof SUPPORTED_PERSONAL_RECORD_DISTANCES)[number]

const HISTORICAL_PERSONAL_RECORD_HYDRATION_COOLDOWN_HOURS = 6
const HISTORICAL_PERSONAL_RECORD_HYDRATION_COOLDOWN_MS =
  HISTORICAL_PERSONAL_RECORD_HYDRATION_COOLDOWN_HOURS * 60 * 60 * 1000
const HISTORICAL_PERSONAL_RECORD_HYDRATION_ERROR = 'historical_import_failed'

type PersonalRecordRow = {
  distance_meters: number
  duration_seconds: number
  pace_seconds_per_km: number | null
  record_date: string | null
  run_id: string | null
  strava_activity_id: number | null
}

type PersonalRecordCanonicalRow = PersonalRecordRow & {
  source: string | null
  metadata: Record<string, unknown> | null
  hydration_attempted_at: string | null
  hydration_failed_at: string | null
  hydration_error: string | null
}

type PersonalRecordCanonicalView = {
  distance_meters: SupportedPersonalRecordDistance
  duration_seconds: number
  pace_seconds_per_km: number | null
  record_date: string | null
  run_id: string | null
  strava_activity_id: number | null
  source: string | null
  metadata: Record<string, unknown> | null
  hydration_attempted_at: string | null
  hydration_failed_at: string | null
  hydration_error: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function toPositiveInteger(value: unknown) {
  const normalizedValue = Number(value)

  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return null
  }

  return Math.round(normalizedValue)
}

function toSupportedDistance(value: unknown): SupportedPersonalRecordDistance | null {
  const normalizedValue = toPositiveInteger(value)

  if (
    normalizedValue === 5000
    || normalizedValue === 10000
    || normalizedValue === 21097
    || normalizedValue === 42195
  ) {
    return normalizedValue
  }

  return null
}

function toNullableTrimmedString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizePersonalRecordRow(row: PersonalRecordRow) {
  const distanceMeters = toSupportedDistance(row.distance_meters)
  const durationSeconds = toPositiveInteger(row.duration_seconds)

  if (!distanceMeters || !durationSeconds) {
    return null
  }

  return {
    distance_meters: distanceMeters,
    duration_seconds: durationSeconds,
    pace_seconds_per_km: row.pace_seconds_per_km !== null && Number.isFinite(Number(row.pace_seconds_per_km))
      ? Number(row.pace_seconds_per_km)
      : null,
    record_date: row.record_date ?? null,
    run_id: row.run_id ?? null,
    strava_activity_id: row.strava_activity_id ?? null,
  }
}

function normalizePersonalRecordCanonicalRow(row: PersonalRecordCanonicalRow | null): PersonalRecordCanonicalView | null {
  if (!row) {
    return null
  }

  const normalizedRow = normalizePersonalRecordRow(row)

  if (!normalizedRow) {
    return null
  }

  return {
    ...normalizedRow,
    source: typeof row.source === 'string' && row.source.trim() ? row.source.trim() : null,
    metadata: asRecord(row.metadata),
    hydration_attempted_at: toNullableTrimmedString(row.hydration_attempted_at),
    hydration_failed_at: toNullableTrimmedString(row.hydration_failed_at),
    hydration_error: toNullableTrimmedString(row.hydration_error),
  }
}

async function recomputePersonalRecordWinner(params: {
  supabase: SupabaseClient
  userId: string
  distanceMeters: SupportedPersonalRecordDistance
}) {
  const { data, error } = await params.supabase.rpc('recompute_personal_record_for_user_distance', {
    p_user_id: params.userId,
    p_distance_meters: params.distanceMeters,
  })

  if (error) {
    throw new Error(error.message)
  }

  return Boolean(data)
}

async function loadCanonicalPersonalRecord(params: {
  supabase: SupabaseClient
  userId: string
  distanceMeters: SupportedPersonalRecordDistance
}): Promise<PersonalRecordCanonicalView | null> {
  const { data, error } = await params.supabase
    .from('personal_records')
    .select(
      'distance_meters, duration_seconds, pace_seconds_per_km, record_date, run_id, strava_activity_id, source, metadata, hydration_attempted_at, hydration_failed_at, hydration_error'
    )
    .eq('user_id', params.userId)
    .eq('distance_meters', params.distanceMeters)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return normalizePersonalRecordCanonicalRow((data as PersonalRecordCanonicalRow | null) ?? null)
}

function shouldAttemptHistoricalPersonalRecordHydration(record: PersonalRecordCanonicalView) {
  if (!record.strava_activity_id || record.run_id || !toSupportedDistance(record.distance_meters)) {
    return false
  }

  if (!record.hydration_attempted_at) {
    return true
  }

  const attemptedAt = new Date(record.hydration_attempted_at)

  if (Number.isNaN(attemptedAt.getTime())) {
    return true
  }

  return Date.now() - attemptedAt.getTime() >= HISTORICAL_PERSONAL_RECORD_HYDRATION_COOLDOWN_MS
}

async function markHistoricalPersonalRecordHydrationAttempt(params: {
  supabase: SupabaseClient
  userId: string
  distanceMeters: SupportedPersonalRecordDistance
  record: PersonalRecordCanonicalView
}) {
  if (!shouldAttemptHistoricalPersonalRecordHydration(params.record)) {
    return false
  }

  const attemptedAt = new Date().toISOString()
  const cooldownThreshold = new Date(
    Date.now() - HISTORICAL_PERSONAL_RECORD_HYDRATION_COOLDOWN_MS
  ).toISOString()

  const baseQuery = params.supabase
    .from('personal_records')
    .update({
      hydration_attempted_at: attemptedAt,
    })
    .eq('user_id', params.userId)
    .eq('distance_meters', params.distanceMeters)
    .eq('strava_activity_id', params.record.strava_activity_id)
    .is('run_id', null)
    .select('distance_meters')

  const query = params.record.hydration_attempted_at
    ? baseQuery.lt('hydration_attempted_at', cooldownThreshold)
    : baseQuery.is('hydration_attempted_at', null)

  const { data, error } = await query.maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return Boolean(data)
}

async function markHistoricalPersonalRecordHydrationFailure(params: {
  supabase: SupabaseClient
  userId: string
  distanceMeters: SupportedPersonalRecordDistance
  stravaActivityId: number
}) {
  const { error } = await params.supabase
    .from('personal_records')
    .update({
      hydration_failed_at: new Date().toISOString(),
      hydration_error: HISTORICAL_PERSONAL_RECORD_HYDRATION_ERROR,
    })
    .eq('user_id', params.userId)
    .eq('distance_meters', params.distanceMeters)
    .eq('strava_activity_id', params.stravaActivityId)
    .is('run_id', null)

  if (error) {
    throw new Error(error.message)
  }
}

async function clearHistoricalPersonalRecordHydrationFailure(params: {
  supabase: SupabaseClient
  userId: string
  distanceMeters: SupportedPersonalRecordDistance
}) {
  const { error } = await params.supabase
    .from('personal_records')
    .update({
      hydration_failed_at: null,
      hydration_error: null,
    })
    .eq('user_id', params.userId)
    .eq('distance_meters', params.distanceMeters)

  if (error) {
    throw new Error(error.message)
  }
}

async function maybeHydrateCanonicalPersonalRecordRun(params: {
  supabase: SupabaseClient
  userId: string
  distanceMeters: SupportedPersonalRecordDistance
  record?: PersonalRecordCanonicalView | null
  hydrateHistoricalActivityByIdForUser?: (userId: string, stravaActivityId: number) => Promise<string | null>
}) {
  const record = params.record ?? await loadCanonicalPersonalRecord({
    supabase: params.supabase,
    userId: params.userId,
    distanceMeters: params.distanceMeters,
  })

  if (!record || !shouldAttemptHistoricalPersonalRecordHydration(record)) {
    return record
  }

  if (!params.hydrateHistoricalActivityByIdForUser) {
    return record
  }

  try {
    const didMarkAttempt = await markHistoricalPersonalRecordHydrationAttempt({
      supabase: params.supabase,
      userId: params.userId,
      distanceMeters: params.distanceMeters,
      record,
    })

    if (!didMarkAttempt) {
      return await loadCanonicalPersonalRecord({
        supabase: params.supabase,
        userId: params.userId,
        distanceMeters: params.distanceMeters,
      }).catch(() => record) ?? record
    }

    const stravaActivityId = record.strava_activity_id
    if (!stravaActivityId) {
      return record
    }

    const importedRunId = await params.hydrateHistoricalActivityByIdForUser(
      params.userId,
      stravaActivityId
    )

    if (!importedRunId) {
      await markHistoricalPersonalRecordHydrationFailure({
        supabase: params.supabase,
        userId: params.userId,
        distanceMeters: params.distanceMeters,
        stravaActivityId,
      }).catch((error) => {
        console.warn('Failed to persist historical personal record hydration failure', {
          userId: params.userId,
          distanceMeters: params.distanceMeters,
          stravaActivityId,
          error: error instanceof Error ? error.message : 'unknown_error',
        })
      })

      return record
    }

    await recomputePersonalRecordWinner({
      supabase: params.supabase,
      userId: params.userId,
      distanceMeters: params.distanceMeters,
    })

    const hydratedRecord = await loadCanonicalPersonalRecord({
      supabase: params.supabase,
      userId: params.userId,
      distanceMeters: params.distanceMeters,
    })

    if (hydratedRecord?.run_id) {
      await clearHistoricalPersonalRecordHydrationFailure({
        supabase: params.supabase,
        userId: params.userId,
        distanceMeters: params.distanceMeters,
      }).catch((error) => {
        console.warn('Failed to clear historical personal record hydration failure', {
          userId: params.userId,
          distanceMeters: params.distanceMeters,
          error: error instanceof Error ? error.message : 'unknown_error',
        })
      })

      return hydratedRecord
    }

    const { error } = await params.supabase
      .from('personal_records')
      .update({
        run_id: importedRunId,
        hydration_failed_at: null,
        hydration_error: null,
      })
      .eq('user_id', params.userId)
      .eq('distance_meters', params.distanceMeters)
      .eq('strava_activity_id', stravaActivityId)
      .is('run_id', null)

    if (error) {
      throw new Error(error.message)
    }

    return await loadCanonicalPersonalRecord({
      supabase: params.supabase,
      userId: params.userId,
      distanceMeters: params.distanceMeters,
    })
  } catch (error) {
    const stravaActivityId = record.strava_activity_id
    if (!stravaActivityId) {
      console.warn('Historical personal record hydration failed', {
        userId: params.userId,
        distanceMeters: params.distanceMeters,
        stravaActivityId: record.strava_activity_id,
        error: error instanceof Error ? error.message : 'unknown_error',
      })

      return record
    }

    await markHistoricalPersonalRecordHydrationFailure({
      supabase: params.supabase,
      userId: params.userId,
      distanceMeters: params.distanceMeters,
      stravaActivityId,
    }).catch((failureError) => {
      console.warn('Failed to persist historical personal record hydration failure', {
        userId: params.userId,
        distanceMeters: params.distanceMeters,
        stravaActivityId,
        error: failureError instanceof Error ? failureError.message : 'unknown_error',
      })
    })

    console.warn('Historical personal record hydration failed', {
      userId: params.userId,
      distanceMeters: params.distanceMeters,
      stravaActivityId,
      error: error instanceof Error ? error.message : 'unknown_error',
    })

    return record
  }
}

export async function recomputePersonalRecordForUserDistance(params: {
  supabase: SupabaseClient
  userId: string
  distanceMeters: SupportedPersonalRecordDistance
  hydrateHistoricalActivityByIdForUser?: (userId: string, stravaActivityId: number) => Promise<string | null>
}) {
  const hasWinner = await recomputePersonalRecordWinner({
    supabase: params.supabase,
    userId: params.userId,
    distanceMeters: params.distanceMeters,
  })

  if (hasWinner) {
    await maybeHydrateCanonicalPersonalRecordRun({
      supabase: params.supabase,
      userId: params.userId,
      distanceMeters: params.distanceMeters,
      hydrateHistoricalActivityByIdForUser: params.hydrateHistoricalActivityByIdForUser,
    })
  }

  return {
    updated: hasWinner,
    deleted: !hasWinner,
  }
}
