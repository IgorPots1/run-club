import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export const SUPPORTED_PERSONAL_RECORD_DISTANCES = [5000, 10000] as const

export type SupportedPersonalRecordDistance = (typeof SUPPORTED_PERSONAL_RECORD_DISTANCES)[number]

type PersonalRecordCandidate = {
  distance_meters: SupportedPersonalRecordDistance
  duration_seconds: number
  pace_seconds_per_km: number
  record_date: string | null
  strava_activity_id: number | null
  source: 'strava_best_effort'
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

export type PersonalRecordView = {
  distance_meters: SupportedPersonalRecordDistance
  duration_seconds: number
  pace_seconds_per_km: number | null
  record_date: string | null
  run_id: string | null
  strava_activity_id: number | null
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

  if (normalizedValue === 5000 || normalizedValue === 10000) {
    return normalizedValue
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

    const distanceMeters = toSupportedDistance(bestEffort.distance)
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

  for (const candidate of candidates) {
    const nextStravaActivityId =
      candidate.strava_activity_id
      ?? toPositiveInteger(params.fallbackStravaActivityId)
    const nextRecordDate = candidate.record_date ?? toIsoDateValue(params.fallbackRecordDate)
    const { data, error } = await params.supabase
      .from('personal_records')
      .select('duration_seconds')
      .eq('user_id', params.userId)
      .eq('distance_meters', candidate.distance_meters)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    const existingRecord = (data as { duration_seconds: number } | null) ?? null

    if (existingRecord && existingRecord.duration_seconds <= candidate.duration_seconds) {
      continue
    }

    const { error: upsertError } = await params.supabase
      .from('personal_records')
      .upsert(
        {
          user_id: params.userId,
          distance_meters: candidate.distance_meters,
          duration_seconds: candidate.duration_seconds,
          pace_seconds_per_km: candidate.pace_seconds_per_km,
          run_id: params.runId ?? null,
          strava_activity_id: nextStravaActivityId,
          record_date: nextRecordDate,
          source: candidate.source,
          metadata: candidate.metadata,
        },
        {
          onConflict: 'user_id,distance_meters',
        }
      )

    if (upsertError) {
      throw new Error(upsertError.message)
    }

    updated += 1
  }

  return {
    checked: candidates.length,
    updated,
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

  return ((data as PersonalRecordRow[] | null) ?? [])
    .map(normalizePersonalRecordRow)
    .filter((record): record is PersonalRecordView => record !== null)
}
