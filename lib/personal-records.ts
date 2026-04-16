import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export const SUPPORTED_PERSONAL_RECORD_DISTANCES = [5000, 10000, 21097, 42195] as const

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
    }
  }

  const wasUpdated = await upsertPersonalRecordCandidate({
    supabase: params.supabase,
    userId: params.userId,
    runId: params.runId,
    candidate,
  })

  return {
    checked: 1,
    updated: wasUpdated ? 1 : 0,
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
