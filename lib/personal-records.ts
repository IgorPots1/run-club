import 'server-only'

import { createAppEvent } from '@/lib/events/createAppEvent'
import { buildPersonalRecordAchievedEvent } from '@/lib/events/returnTriggerEvents'
import { processAppEventPushDeliveries } from '@/lib/push/appEventPush'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export const SUPPORTED_PERSONAL_RECORD_DISTANCES = [5000, 10000, 21097, 42195] as const

const HISTORICAL_PERSONAL_RECORD_HYDRATION_COOLDOWN_HOURS = 6
const HISTORICAL_PERSONAL_RECORD_HYDRATION_COOLDOWN_MS =
  HISTORICAL_PERSONAL_RECORD_HYDRATION_COOLDOWN_HOURS * 60 * 60 * 1000
const HISTORICAL_PERSONAL_RECORD_HYDRATION_ERROR = 'historical_import_failed'

const LOCAL_FULL_RUN_PERSONAL_RECORD_TOLERANCES: Record<number, number> = {
  5000: 25,
  10000: 25,
  21097: 30,
  42195: 50,
}

export type SupportedPersonalRecordDistance = (typeof SUPPORTED_PERSONAL_RECORD_DISTANCES)[number]

type PersonalRecordCandidate = {
  distance_meters: SupportedPersonalRecordDistance
  duration_seconds: number
  pace_seconds_per_km: number
  record_date: string | null
  strava_activity_id: number | null
  source: 'strava_best_effort' | 'local_full_run'
  metadata: Record<string, unknown> | null
}

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

export type PersonalRecordView = {
  distance_meters: SupportedPersonalRecordDistance
  duration_seconds: number
  pace_seconds_per_km: number | null
  record_date: string | null
  run_id: string | null
  strava_activity_id: number | null
}

type PersonalRecordCanonicalView = PersonalRecordView & {
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

function toNonNegativeInteger(value: unknown) {
  const normalizedValue = Number(value)

  if (!Number.isFinite(normalizedValue) || normalizedValue < 0) {
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

function normalizeBestEffortName(value: unknown) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
    : ''
}

function resolveSupportedBestEffortDistance(bestEffort: Record<string, unknown>): SupportedPersonalRecordDistance | null {
  const exactDistance = toSupportedDistance(bestEffort.distance)

  if (exactDistance) {
    return exactDistance
  }

  const normalizedName = normalizeBestEffortName(bestEffort.name)

  if (!normalizedName) {
    return null
  }

  if (normalizedName === '5k' || normalizedName === '5km' || normalizedName === '5000') {
    return 5000
  }

  if (normalizedName === '10k' || normalizedName === '10km' || normalizedName === '10000') {
    return 10000
  }

  if (
    normalizedName === 'halfmarathon'
    || normalizedName === '21k'
    || normalizedName === '21km'
    || normalizedName === '211km'
    || normalizedName === '21097'
    || normalizedName === '210975'
    || normalizedName === '21097km'
  ) {
    return 21097
  }

  if (
    normalizedName === 'marathon'
    || normalizedName === '42k'
    || normalizedName === '42km'
    || normalizedName === '422km'
    || normalizedName === '42195'
    || normalizedName === '421950'
    || normalizedName === '42195km'
  ) {
    return 42195
  }

  return null
}

function matchSupportedFullRunDistance(value: unknown): SupportedPersonalRecordDistance | null {
  const normalizedValue = Number(value)

  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return null
  }

  for (const supportedDistance of SUPPORTED_PERSONAL_RECORD_DISTANCES) {
    const toleranceMeters = LOCAL_FULL_RUN_PERSONAL_RECORD_TOLERANCES[supportedDistance]

    if (Math.abs(normalizedValue - supportedDistance) <= toleranceMeters) {
      return supportedDistance
    }
  }

  return null
}

function toIsoDateValue(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return null
  }

  return parsedDate.toISOString().slice(0, 10)
}

function toNullableTrimmedString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function buildBestEffortMetadata(bestEffort: Record<string, unknown>) {
  const metadataEntries = Object.entries({
    name: toNullableTrimmedString(bestEffort.name),
    pr_rank: toPositiveInteger(bestEffort.pr_rank),
    elapsed_time: toPositiveInteger(bestEffort.elapsed_time),
    moving_time: toPositiveInteger(bestEffort.moving_time),
    start_index: toNonNegativeInteger(bestEffort.start_index),
    end_index: toNonNegativeInteger(bestEffort.end_index),
  }).filter(([, value]) => value !== null)

  if (metadataEntries.length === 0) {
    return null
  }

  return Object.fromEntries(metadataEntries)
}

export function extractStravaPersonalRecordCandidates(
  rawStravaPayload: Record<string, unknown> | null | undefined
): PersonalRecordCandidate[] {
  const payloadRecord = asRecord(rawStravaPayload)
  const bestEfforts = Array.isArray(payloadRecord?.best_efforts) ? payloadRecord.best_efforts : []
  const candidatesByDistance = new Map<SupportedPersonalRecordDistance, PersonalRecordCandidate>()

  for (const bestEffortValue of bestEfforts) {
    const bestEffort = asRecord(bestEffortValue)

    if (!bestEffort) {
      continue
    }

    const distanceMeters = resolveSupportedBestEffortDistance(bestEffort)
    const durationSeconds = toPositiveInteger(bestEffort.elapsed_time ?? bestEffort.moving_time)

    if (!distanceMeters || !durationSeconds) {
      continue
    }

    const activityRecord = asRecord(bestEffort.activity)
    const candidate: PersonalRecordCandidate = {
      distance_meters: distanceMeters,
      duration_seconds: durationSeconds,
      pace_seconds_per_km: Math.round(durationSeconds / (distanceMeters / 1000)),
      record_date: (
        toIsoDateValue(bestEffort.start_date)
        ?? toIsoDateValue(bestEffort.start_date_local)
        ?? toIsoDateValue(payloadRecord?.start_date)
        ?? toIsoDateValue(payloadRecord?.start_date_local)
      ),
      strava_activity_id: toPositiveInteger(activityRecord?.id ?? bestEffort.activity_id ?? payloadRecord?.id),
      source: 'strava_best_effort',
      metadata: buildBestEffortMetadata(bestEffort),
    }

    const existingCandidate = candidatesByDistance.get(distanceMeters)

    if (!existingCandidate || candidate.duration_seconds < existingCandidate.duration_seconds) {
      candidatesByDistance.set(distanceMeters, candidate)
    }
  }

  return SUPPORTED_PERSONAL_RECORD_DISTANCES
    .map((distanceMeters) => candidatesByDistance.get(distanceMeters) ?? null)
    .filter((candidate): candidate is PersonalRecordCandidate => candidate !== null)
}

export function extractLocalFullRunPersonalRecordCandidate(rawRun: {
  distance_meters: unknown
  moving_time_seconds: unknown
  created_at: unknown
  external_source?: unknown
}): PersonalRecordCandidate | null {
  const externalSource = toNullableTrimmedString(rawRun.external_source)

  if (externalSource === 'strava') {
    return null
  }

  const distanceMeters = matchSupportedFullRunDistance(rawRun.distance_meters)
  const durationSeconds = toPositiveInteger(rawRun.moving_time_seconds)

  if (!distanceMeters || !durationSeconds) {
    return null
  }

  return {
    distance_meters: distanceMeters,
    duration_seconds: durationSeconds,
    pace_seconds_per_km: Math.round(durationSeconds / (distanceMeters / 1000)),
    record_date: toIsoDateValue(rawRun.created_at),
    strava_activity_id: null,
    source: 'local_full_run',
    metadata: externalSource && externalSource !== 'manual'
      ? { external_source: externalSource }
      : null,
  }
}

async function upsertPersonalRecordCandidate(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>
  userId: string
  runId?: string | null
  fallbackRecordDate?: string | null
  fallbackStravaActivityId?: number | string | null
  candidate: PersonalRecordCandidate
}) {
  const nextStravaActivityId =
    params.candidate.strava_activity_id
    ?? toPositiveInteger(params.fallbackStravaActivityId)
  const nextRecordDate = params.candidate.record_date ?? toIsoDateValue(params.fallbackRecordDate)
  const { data, error } = await params.supabase.rpc('upsert_personal_record_if_better', {
    p_user_id: params.userId,
    p_distance_meters: params.candidate.distance_meters,
    p_duration_seconds: params.candidate.duration_seconds,
    p_pace_seconds_per_km: params.candidate.pace_seconds_per_km,
    p_run_id: params.runId ?? null,
    p_strava_activity_id: nextStravaActivityId,
    p_record_date: nextRecordDate ? `${nextRecordDate}T00:00:00.000Z` : null,
    p_source: params.candidate.source,
    p_metadata: params.candidate.metadata,
  })

  if (error) {
    throw new Error(error.message)
  }

  return Boolean(data)
}

async function recomputePersonalRecordWinner(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>
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
  supabase: ReturnType<typeof createSupabaseAdminClient>
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

  const normalized = normalizePersonalRecordCanonicalRow((data as PersonalRecordCanonicalRow | null) ?? null)
  return normalized
}

function shouldAttemptHistoricalPersonalRecordHydration(record: PersonalRecordCanonicalView) {
  if (record.run_id || !record.strava_activity_id || !toSupportedDistance(record.distance_meters)) {
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
  supabase: ReturnType<typeof createSupabaseAdminClient>
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

  let query = baseQuery
  if (params.record.hydration_attempted_at) {
    query = query.lt('hydration_attempted_at', cooldownThreshold)
  } else {
    query = query.is('hydration_attempted_at', null)
  }

  const { data, error } = await query.maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return Boolean(data)
}

async function markHistoricalPersonalRecordHydrationFailure(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>
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
  supabase: ReturnType<typeof createSupabaseAdminClient>
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
  supabase: ReturnType<typeof createSupabaseAdminClient>
  userId: string
  distanceMeters: SupportedPersonalRecordDistance
  record?: PersonalRecordCanonicalView | null
}) {
  const record = params.record ?? await loadCanonicalPersonalRecord({
    supabase: params.supabase,
    userId: params.userId,
    distanceMeters: params.distanceMeters,
  })

  if (!record || !shouldAttemptHistoricalPersonalRecordHydration(record)) {
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

    const { importHistoricalStravaActivityByIdForUser } = await import('@/lib/strava/strava-sync')
    const importedRunId = await importHistoricalStravaActivityByIdForUser(
      params.userId,
      record.strava_activity_id
    )

    if (!importedRunId) {
      await markHistoricalPersonalRecordHydrationFailure({
        supabase: params.supabase,
        userId: params.userId,
        distanceMeters: params.distanceMeters,
        stravaActivityId: record.strava_activity_id,
      }).catch((error) => {
        console.warn('Failed to persist historical personal record hydration failure', {
          userId: params.userId,
          distanceMeters: params.distanceMeters,
          stravaActivityId: record.strava_activity_id,
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
      .eq('strava_activity_id', record.strava_activity_id)
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
    await markHistoricalPersonalRecordHydrationFailure({
      supabase: params.supabase,
      userId: params.userId,
      distanceMeters: params.distanceMeters,
      stravaActivityId: record.strava_activity_id,
    }).catch((failureError) => {
      console.warn('Failed to persist historical personal record hydration failure', {
        userId: params.userId,
        distanceMeters: params.distanceMeters,
        stravaActivityId: record.strava_activity_id,
        error: failureError instanceof Error ? failureError.message : 'unknown_error',
      })
    })

    console.warn('Historical personal record hydration failed', {
      userId: params.userId,
      distanceMeters: params.distanceMeters,
      stravaActivityId: record.strava_activity_id,
      error: error instanceof Error ? error.message : 'unknown_error',
    })

    return record
  }
}

async function hydratePersonalRecordViews(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>
  userId: string
  records: PersonalRecordView[]
}) {
  const hydratedRecords: PersonalRecordView[] = []

  for (const record of params.records) {
    if (record.run_id || !record.strava_activity_id) {
      hydratedRecords.push(record)
      continue
    }

    const hydratedRecord = await maybeHydrateCanonicalPersonalRecordRun({
      supabase: params.supabase,
      userId: params.userId,
      distanceMeters: record.distance_meters,
    })

    hydratedRecords.push(hydratedRecord ?? record)
  }

  return hydratedRecords
}

function getPersonalRecordSourceKey(record: PersonalRecordCanonicalView) {
  if (record.run_id) {
    if (record.source === 'local_full_run') {
      return `run:${record.run_id}`
    }

    if (record.source === 'strava_best_effort') {
      return `run:${record.run_id}:distance:${record.distance_meters}`
    }
  }

  if (record.strava_activity_id) {
    return `strava_activity:${record.strava_activity_id}:distance:${record.distance_meters}`
  }

  return `legacy:${record.distance_meters}:${record.duration_seconds}`
}

async function maybeEmitPersonalRecordEvent(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>
  userId: string
  distanceMeters: SupportedPersonalRecordDistance
  before: PersonalRecordCanonicalView | null
}) {
  const after = await loadCanonicalPersonalRecord({
    supabase: params.supabase,
    userId: params.userId,
    distanceMeters: params.distanceMeters,
  })

  if (!after) {
    return false
  }

  if (after.source === 'historical_strava_best_effort') {
    return false
  }

  if (params.before && params.before.duration_seconds <= after.duration_seconds) {
    return false
  }

  const createdEvent = await createAppEvent(
    buildPersonalRecordAchievedEvent({
      actorUserId: params.userId,
      targetUserId: params.userId,
      distanceMeters: after.distance_meters,
      durationSeconds: after.duration_seconds,
      recordDate: after.record_date,
      runId: after.run_id,
      sourceKey: getPersonalRecordSourceKey(after),
    })
  ).catch((error) => {
    if (
      error
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: string }).code === '23505'
    ) {
      return null
    }

    throw error
  })

  if (!createdEvent) {
    return false
  }

  await processAppEventPushDeliveries({
    appEventIds: [createdEvent.id],
  })

  return true
}

export async function upsertPersonalRecordsFromStravaPayload(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>
  userId: string
  runId?: string | null
  rawStravaPayload: Record<string, unknown> | null
  fallbackRecordDate?: string | null
  fallbackStravaActivityId?: number | string | null
}) {
  const candidates = extractStravaPersonalRecordCandidates(params.rawStravaPayload)

  if (candidates.length === 0) {
    return {
      checked: 0,
      updated: 0,
    }
  }

  let updated = 0
  let eventsCreated = 0

  for (const candidate of candidates) {
    const previousRecord = await loadCanonicalPersonalRecord({
      supabase: params.supabase,
      userId: params.userId,
      distanceMeters: candidate.distance_meters,
    })
    const wasUpdated = await upsertPersonalRecordCandidate({
      supabase: params.supabase,
      userId: params.userId,
      runId: params.runId,
      fallbackRecordDate: params.fallbackRecordDate,
      fallbackStravaActivityId: params.fallbackStravaActivityId,
      candidate,
    })

    if (wasUpdated) {
      updated += 1
      const eventCreated = await maybeEmitPersonalRecordEvent({
        supabase: params.supabase,
        userId: params.userId,
        distanceMeters: candidate.distance_meters,
        before: previousRecord,
      })

      if (eventCreated) {
        eventsCreated += 1
      }

      await maybeHydrateCanonicalPersonalRecordRun({
        supabase: params.supabase,
        userId: params.userId,
        distanceMeters: candidate.distance_meters,
      })
    }
  }

  return {
    checked: candidates.length,
    updated,
    eventsCreated,
  }
}

export async function upsertPersonalRecordForLocalRunIfEligible(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>
  userId: string
  runId: string
  distanceMeters: unknown
  movingTimeSeconds: unknown
  createdAt: unknown
  externalSource?: unknown
}) {
  const candidate = extractLocalFullRunPersonalRecordCandidate({
    distance_meters: params.distanceMeters,
    moving_time_seconds: params.movingTimeSeconds,
    created_at: params.createdAt,
    external_source: params.externalSource,
  })

  if (!candidate) {
    return {
      checked: 0,
      updated: 0,
      eventsCreated: 0,
    }
  }

  const previousRecord = await loadCanonicalPersonalRecord({
    supabase: params.supabase,
    userId: params.userId,
    distanceMeters: candidate.distance_meters,
  })
  const wasUpdated = await upsertPersonalRecordCandidate({
    supabase: params.supabase,
    userId: params.userId,
    runId: params.runId,
    candidate,
  })

  const eventCreated = wasUpdated
    ? await maybeEmitPersonalRecordEvent({
        supabase: params.supabase,
        userId: params.userId,
        distanceMeters: candidate.distance_meters,
        before: previousRecord,
      })
    : false

  if (wasUpdated) {
    await maybeHydrateCanonicalPersonalRecordRun({
      supabase: params.supabase,
      userId: params.userId,
      distanceMeters: candidate.distance_meters,
    })
  }

  return {
    checked: 1,
    updated: wasUpdated ? 1 : 0,
    eventsCreated: eventCreated ? 1 : 0,
  }
}

export async function recomputePersonalRecordForUserDistance(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>
  userId: string
  distanceMeters: SupportedPersonalRecordDistance
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
    })
  }

  return {
    updated: hasWinner,
    deleted: !hasWinner,
  }
}

function normalizePersonalRecordRow(row: PersonalRecordRow): PersonalRecordView | null {
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

export async function loadCurrentUserPersonalRecords(): Promise<PersonalRecordView[]> {
  const { user, error, supabase } = await getAuthenticatedUser()

  if (error || !user) {
    return []
  }

  const { data, error: recordsError } = await supabase
    .from('personal_records')
    .select('distance_meters, duration_seconds, pace_seconds_per_km, record_date, run_id, strava_activity_id')
    .eq('user_id', user.id)
    .order('distance_meters', { ascending: true })

  if (recordsError) {
    throw new Error(recordsError.message)
  }

  const normalizedRecords = ((data as PersonalRecordRow[] | null) ?? [])
    .map(normalizePersonalRecordRow)
    .filter((record): record is PersonalRecordView => record !== null)

  const supabaseAdmin = createSupabaseAdminClient()
  return hydratePersonalRecordViews({
    supabase: supabaseAdmin,
    userId: user.id,
    records: normalizedRecords,
  })
}

export async function loadPublicUserPersonalRecords(userId: string): Promise<PersonalRecordView[]> {
  const normalizedUserId = userId.trim()

  if (!normalizedUserId) {
    return []
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const { data, error } = await supabaseAdmin
    .from('personal_records')
    .select('distance_meters, duration_seconds, pace_seconds_per_km, record_date, run_id, strava_activity_id')
    .eq('user_id', normalizedUserId)
    .order('distance_meters', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  const normalizedRecords = ((data as PersonalRecordRow[] | null) ?? [])
    .map(normalizePersonalRecordRow)
    .filter((record): record is PersonalRecordView => record !== null)

  return hydratePersonalRecordViews({
    supabase: supabaseAdmin,
    userId: normalizedUserId,
    records: normalizedRecords,
  })
}
