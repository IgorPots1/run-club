import type { SupabaseClient } from '@supabase/supabase-js'

import type { SupportedPersonalRecordDistance } from './personal-records-recompute'

const STRAVA_FULL_RUN_FALLBACK_WINDOWS = {
  21097: {
    minimumDistanceMeters: 20597,
    maximumDistanceMeters: 21597,
  },
  42195: {
    minimumDistanceMeters: 42000,
    maximumDistanceMeters: 43000,
  },
} as const satisfies Record<
  21097 | 42195,
  {
    minimumDistanceMeters: number
    maximumDistanceMeters: number
  }
>

type PersonalRecordCandidate = {
  distance_meters: SupportedPersonalRecordDistance
  duration_seconds: number
  pace_seconds_per_km: number
  record_date: string | null
  strava_activity_id: number | null
  source: 'strava_best_effort' | 'local_full_run'
  metadata: Record<string, unknown> | null
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

function resolveSupportedBestEffortDistance(
  bestEffort: Record<string, unknown>
): SupportedPersonalRecordDistance | null {
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

function isDistanceWithinStravaFullRunFallbackWindow(
  value: unknown,
  distanceMeters: 21097 | 42195
) {
  const normalizedValue = Number(value)

  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return false
  }

  const window = STRAVA_FULL_RUN_FALLBACK_WINDOWS[distanceMeters]
  return normalizedValue >= window.minimumDistanceMeters && normalizedValue <= window.maximumDistanceMeters
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

function extractStravaPersonalRecordCandidates(
  rawStravaPayload: unknown,
  options?: {
    fallbackDistanceMeters?: unknown
    fallbackMovingTimeSeconds?: unknown
    fallbackRecordDate?: unknown
    fallbackStravaActivityId?: unknown
  }
): PersonalRecordCandidate[] {
  const payloadRecord = asRecord(rawStravaPayload)
  if (!payloadRecord) {
    console.warn(
      'extractStravaPersonalRecordCandidates received non-object raw_strava_payload; using run-level fallback metrics',
      {
        fallbackDistanceMeters: options?.fallbackDistanceMeters,
      }
    )
  }

  const activityId = toPositiveInteger(
    payloadRecord?.id ?? options?.fallbackStravaActivityId ?? null
  )
  const fallbackRecordDate = toIsoDateValue(
    payloadRecord?.start_date_local ?? payloadRecord?.start_date ?? options?.fallbackRecordDate
  )
  const fallbackDistanceMeters = payloadRecord?.distance ?? options?.fallbackDistanceMeters
  const fallbackMovingTime = payloadRecord?.moving_time ?? options?.fallbackMovingTimeSeconds

  const candidates: PersonalRecordCandidate[] = []
  const bestEfforts = Array.isArray(payloadRecord?.best_efforts)
    ? (payloadRecord.best_efforts as unknown[])
    : []

  for (const rawBestEffort of bestEfforts) {
    const bestEffort = asRecord(rawBestEffort)
    if (!bestEffort) {
      continue
    }

    const distanceMeters = resolveSupportedBestEffortDistance(bestEffort)
    const elapsedTime = toPositiveInteger(bestEffort.elapsed_time)

    if (!distanceMeters || !elapsedTime) {
      continue
    }

    candidates.push({
      distance_meters: distanceMeters,
      duration_seconds: elapsedTime,
      pace_seconds_per_km: Math.round(elapsedTime / (distanceMeters / 1000)),
      record_date: fallbackRecordDate,
      strava_activity_id: activityId,
      source: 'strava_best_effort',
      metadata: buildBestEffortMetadata(bestEffort),
    })
  }

  const fallbackDurationSeconds = toPositiveInteger(fallbackMovingTime)
  const fallbackHalfEligible = isDistanceWithinStravaFullRunFallbackWindow(
    fallbackDistanceMeters,
    21097
  )
  const fallbackMarathonEligible = isDistanceWithinStravaFullRunFallbackWindow(
    fallbackDistanceMeters,
    42195
  )

  if (fallbackDurationSeconds && fallbackHalfEligible) {
    candidates.push({
      distance_meters: 21097,
      duration_seconds: fallbackDurationSeconds,
      pace_seconds_per_km: Math.round(fallbackDurationSeconds / (21097 / 1000)),
      record_date: fallbackRecordDate,
      strava_activity_id: activityId,
      source: 'strava_best_effort',
      metadata: {
        fallback: 'full_run_window',
        source_distance_meters: toPositiveInteger(fallbackDistanceMeters),
      },
    })
  }

  if (fallbackDurationSeconds && fallbackMarathonEligible) {
    candidates.push({
      distance_meters: 42195,
      duration_seconds: fallbackDurationSeconds,
      pace_seconds_per_km: Math.round(fallbackDurationSeconds / (42195 / 1000)),
      record_date: fallbackRecordDate,
      strava_activity_id: activityId,
      source: 'strava_best_effort',
      metadata: {
        fallback: 'full_run_window',
        source_distance_meters: toPositiveInteger(fallbackDistanceMeters),
      },
    })
  }

  return candidates
}

async function upsertPersonalRecordCandidate(params: {
  supabase: SupabaseClient
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
    throw new Error(
      [
        `upsert_personal_record_if_better failed: ${error.message}`,
        `code=${error.code ?? 'unknown'}`,
        `details=${error.details ?? 'none'}`,
        `hint=${error.hint ?? 'none'}`,
        `distance_meters=${params.candidate.distance_meters}`,
        `source=${params.candidate.source}`,
        `run_id=${params.runId ?? 'none'}`,
        `strava_activity_id=${nextStravaActivityId ?? 'none'}`,
        `record_date=${nextRecordDate ?? 'none'}`,
      ].join(' | ')
    )
  }

  return Boolean(data)
}

export async function upsertPersonalRecordsForDistancesFromStravaPayload(params: {
  supabase: SupabaseClient
  userId: string
  runId?: string | null
  rawStravaPayload: unknown
  distanceMeters: SupportedPersonalRecordDistance[]
  fallbackRecordDate?: string | null
  fallbackStravaActivityId?: number | string | null
  fallbackDistanceMeters?: unknown
  fallbackMovingTimeSeconds?: unknown
}) {
  const targetDistances = new Set(params.distanceMeters)
  const candidates = extractStravaPersonalRecordCandidates(params.rawStravaPayload, {
    fallbackDistanceMeters: params.fallbackDistanceMeters,
    fallbackMovingTimeSeconds: params.fallbackMovingTimeSeconds,
    fallbackRecordDate: params.fallbackRecordDate,
    fallbackStravaActivityId: params.fallbackStravaActivityId,
  })
    .filter((candidate) => targetDistances.has(candidate.distance_meters))

  if (candidates.length === 0) {
    return {
      checked: 0,
      updated: 0,
      eventsCreated: 0,
    }
  }

  let updated = 0

  for (const candidate of candidates) {
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
    }
  }

  return {
    checked: candidates.length,
    updated,
    eventsCreated: 0,
  }
}
