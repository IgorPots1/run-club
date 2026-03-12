import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { fetchStravaActivities, refreshStravaAccessToken } from './strava-client'
import type { StravaActivitySummary, StravaActivityType, StravaInitialSyncResult } from './strava-types'

const STRAVA_EXTERNAL_SOURCE = 'strava'
const FALLBACK_RUN_NAME = 'Бег'
const STRAVA_INITIAL_SYNC_WINDOW_DAYS = 30
const MAX_SYNC_ERROR_DETAILS = 10
const MOJIBAKE_PATTERN = /(?:Ð.|Ñ.|Ã.|Â.)/
const ALLOWED_STRAVA_RUN_TYPES: StravaActivityType[] = ['Run']
const STRAVA_TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000

type StravaRunInsertPayload = {
  user_id: string
  name: string
  title: string
  distance_km: number
  distance_meters: number
  duration_minutes: number
  duration_seconds: number
  moving_time_seconds: number
  elapsed_time_seconds: number
  average_pace_seconds: number
  elevation_gain_meters: number
  created_at: string
  external_source: string
  external_id: string
  xp: number
}

type StravaConnectionRow = {
  id: string
  user_id: string
  strava_athlete_id: number
  access_token: string
  refresh_token: string
  expires_at: string
  last_synced_at: string | null
  status: string
}

type StravaSyncRowErrorDetail = {
  activityId: string
  field?: string
  value?: number | string | null
  error: string
}

type StravaImportOutcome = 'imported' | 'updated' | 'skipped_existing' | 'skipped_invalid'

type StravaImportResult = {
  status: StravaImportOutcome
  activityId: string
}

type ImportStravaActivityOptions = {
  updateExisting?: boolean
}

class StravaSyncRowError extends Error {
  field?: string
  value?: number | string | null

  constructor(message: string, detail: Omit<StravaSyncRowErrorDetail, 'activityId' | 'error'> = {}) {
    super(message)
    this.name = 'StravaSyncRowError'
    this.field = detail.field
    this.value = detail.value
  }
}

function toDistanceKm(distanceMeters: number) {
  return Number((distanceMeters / 1000).toFixed(3))
}

function toDurationMinutes(movingTimeSeconds: number) {
  return Math.max(1, normalizeIntegerField('duration_minutes', movingTimeSeconds / 60))
}

function toDurationSeconds(movingTimeSeconds: number) {
  return Math.max(1, normalizeIntegerField('duration_seconds', movingTimeSeconds))
}

function toDistanceMeters(distanceMeters: number) {
  return Math.max(1, normalizeIntegerField('distance_meters', distanceMeters))
}

function toMovingTimeSeconds(movingTimeSeconds: number) {
  return Math.max(1, normalizeIntegerField('moving_time_seconds', movingTimeSeconds))
}

function toElapsedTimeSeconds(elapsedTimeSeconds: number, fallbackMovingTimeSeconds: number) {
  const safeElapsedTime = Number.isFinite(elapsedTimeSeconds) && elapsedTimeSeconds > 0
    ? elapsedTimeSeconds
    : fallbackMovingTimeSeconds

  return Math.max(1, normalizeIntegerField('elapsed_time_seconds', safeElapsedTime))
}

function toAveragePaceSeconds(movingTimeSeconds: number, distanceMeters: number) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    throw new StravaSyncRowError('Invalid numeric value for average_pace_seconds', {
      field: 'distance_meters',
      value: distanceMeters,
    })
  }

  return Math.max(
    1,
    normalizeIntegerField('average_pace_seconds', movingTimeSeconds / (distanceMeters / 1000))
  )
}

function toElevationGainMeters(totalElevationGain: number) {
  const safeElevationGain = Number.isFinite(totalElevationGain) ? totalElevationGain : 0
  return Math.max(0, normalizeIntegerField('elevation_gain_meters', safeElevationGain))
}

function normalizeIntegerField(field: string, value: number) {
  if (!Number.isFinite(value)) {
    throw new StravaSyncRowError(`Invalid numeric value for ${field}`, {
      field,
      value: String(value),
    })
  }

  return Math.round(value)
}

function toXp(distanceKm: number) {
  return Math.max(0, normalizeIntegerField('xp', 50 + distanceKm * 10))
}

function normalizeImportedRunName(rawName: string) {
  const trimmedName = rawName.trim()

  if (!trimmedName) {
    return FALLBACK_RUN_NAME
  }

  if (!MOJIBAKE_PATTERN.test(trimmedName)) {
    return trimmedName
  }

  try {
    const decodedName = Buffer.from(trimmedName, 'latin1').toString('utf8').trim()
    return decodedName && !decodedName.includes('\uFFFD') ? decodedName : trimmedName
  } catch {
    return trimmedName
  }
}

export function isValidStravaRun(activity: StravaActivitySummary) {
  return (
    ALLOWED_STRAVA_RUN_TYPES.includes(activity.type as StravaActivityType) &&
    Number.isFinite(activity.distance) &&
    activity.distance > 0 &&
    Number.isFinite(activity.moving_time) &&
    activity.moving_time > 0 &&
    Boolean(activity.start_date)
  )
}

function buildRunInsertPayload(userId: string, activity: StravaActivitySummary): StravaRunInsertPayload {
  const normalizedName = normalizeImportedRunName(activity.name)
  const distanceMeters = toDistanceMeters(activity.distance)
  const distanceKm = toDistanceKm(distanceMeters)
  const movingTimeSeconds = toMovingTimeSeconds(activity.moving_time)
  const durationSeconds = toDurationSeconds(movingTimeSeconds)
  const elapsedTimeSeconds = toElapsedTimeSeconds(activity.elapsed_time, movingTimeSeconds)

  return {
    user_id: userId,
    name: normalizedName,
    title: normalizedName,
    distance_km: distanceKm,
    distance_meters: distanceMeters,
    duration_minutes: toDurationMinutes(durationSeconds),
    duration_seconds: durationSeconds,
    moving_time_seconds: movingTimeSeconds,
    elapsed_time_seconds: elapsedTimeSeconds,
    average_pace_seconds: toAveragePaceSeconds(movingTimeSeconds, distanceMeters),
    elevation_gain_meters: toElevationGainMeters(activity.total_elevation_gain),
    created_at: new Date(activity.start_date).toISOString(),
    external_source: STRAVA_EXTERNAL_SOURCE,
    external_id: String(activity.id),
    xp: toXp(distanceKm),
  }
}

function findLikelyInvalidIntegerField(payload: StravaRunInsertPayload) {
  const integerFields: Array<
    keyof Pick<
      StravaRunInsertPayload,
      | 'distance_meters'
      | 'duration_minutes'
      | 'duration_seconds'
      | 'moving_time_seconds'
      | 'elapsed_time_seconds'
      | 'average_pace_seconds'
      | 'elevation_gain_meters'
      | 'xp'
    >
  > = [
    'distance_meters',
    'duration_minutes',
    'duration_seconds',
    'moving_time_seconds',
    'elapsed_time_seconds',
    'average_pace_seconds',
    'elevation_gain_meters',
    'xp',
  ]

  for (const field of integerFields) {
    if (!Number.isInteger(payload[field])) {
      return {
        field,
        value: payload[field],
      }
    }
  }

  return null
}

function isStravaTokenExpiringSoon(expiresAt: string) {
  const expiresAtMs = new Date(expiresAt).getTime()

  if (Number.isNaN(expiresAtMs)) {
    return true
  }

  return expiresAtMs <= Date.now() + STRAVA_TOKEN_REFRESH_BUFFER_MS
}

export async function touchStravaConnection(connectionId: string) {
  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('strava_connections')
    .update({
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', connectionId)

  if (error) {
    throw new Error(error.message)
  }
}

async function getStravaConnectionByColumn(
  column: 'user_id' | 'strava_athlete_id',
  value: string | number
): Promise<StravaConnectionRow | null> {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('strava_connections')
    .select('id, user_id, strava_athlete_id, access_token, refresh_token, expires_at, last_synced_at, status')
    .eq(column, value)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return (data as StravaConnectionRow | null) ?? null
}

async function ensureFreshStravaConnection(connection: StravaConnectionRow): Promise<StravaConnectionRow> {
  if (!isStravaTokenExpiringSoon(connection.expires_at)) {
    return connection
  }

  const refreshedToken = await refreshStravaAccessToken(connection.refresh_token)
  const nextConnection: StravaConnectionRow = {
    ...connection,
    access_token: refreshedToken.access_token,
    refresh_token: refreshedToken.refresh_token,
    expires_at: new Date(refreshedToken.expires_at * 1000).toISOString(),
    strava_athlete_id: refreshedToken.athlete?.id ?? connection.strava_athlete_id,
    status: 'connected',
  }

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('strava_connections')
    .update({
      access_token: nextConnection.access_token,
      refresh_token: nextConnection.refresh_token,
      expires_at: nextConnection.expires_at,
      strava_athlete_id: nextConnection.strava_athlete_id,
      status: nextConnection.status,
    })
    .eq('id', connection.id)

  if (error) {
    throw new Error(error.message)
  }

  return nextConnection
}

export async function getStravaConnectionForUser(userId: string) {
  const connection = await getStravaConnectionByColumn('user_id', userId)
  return connection ? ensureFreshStravaConnection(connection) : null
}

export async function getStravaConnectionForAthlete(stravaAthleteId: number) {
  const connection = await getStravaConnectionByColumn('strava_athlete_id', stravaAthleteId)
  return connection ? ensureFreshStravaConnection(connection) : null
}

export async function importStravaActivityForUser(
  userId: string,
  activity: StravaActivitySummary,
  options: ImportStravaActivityOptions = {}
): Promise<StravaImportResult> {
  if (!isValidStravaRun(activity)) {
    return {
      status: 'skipped_invalid',
      activityId: String(activity.id),
    }
  }

  const supabase = createSupabaseAdminClient()
  const payload = buildRunInsertPayload(userId, activity)
  const { data: existingRun, error: existingRunError } = await supabase
    .from('runs')
    .select('id, user_id')
    .eq('external_source', STRAVA_EXTERNAL_SOURCE)
    .eq('external_id', payload.external_id)
    .maybeSingle()

  if (existingRunError) {
    throw new Error(existingRunError.message)
  }

  if (!existingRun) {
    const { error: insertError } = await supabase.from('runs').insert(payload)

    if (insertError) {
      throw new Error(insertError.message)
    }

    return {
      status: 'imported',
      activityId: payload.external_id,
    }
  }

  const requiresOwnerRepair = existingRun.user_id !== userId

  if (!options.updateExisting && !requiresOwnerRepair) {
    return {
      status: 'skipped_existing',
      activityId: payload.external_id,
    }
  }

  const { error: updateError } = await supabase
    .from('runs')
    .update({
      user_id: payload.user_id,
      name: payload.name,
      title: payload.title,
      distance_km: payload.distance_km,
      distance_meters: payload.distance_meters,
      duration_minutes: payload.duration_minutes,
      duration_seconds: payload.duration_seconds,
      moving_time_seconds: payload.moving_time_seconds,
      elapsed_time_seconds: payload.elapsed_time_seconds,
      average_pace_seconds: payload.average_pace_seconds,
      elevation_gain_meters: payload.elevation_gain_meters,
      created_at: payload.created_at,
      xp: payload.xp,
    })
    .eq('id', existingRun.id)

  if (updateError) {
    throw new Error(updateError.message)
  }

  return {
    status: 'updated',
    activityId: payload.external_id,
  }
}

export async function syncStravaRuns(userId: string): Promise<StravaInitialSyncResult> {
  const connection = await getStravaConnectionForUser(userId)

  if (!connection) {
    return {
      ok: false,
      step: 'missing_connection',
    }
  }

  const supabase = createSupabaseAdminClient()
  const { data: latestImportedRun, error: latestImportedRunError } = await supabase
    .from('runs')
    .select('created_at')
    .eq('user_id', userId)
    .eq('external_source', STRAVA_EXTERNAL_SOURCE)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestImportedRunError) {
    throw new Error(latestImportedRunError.message)
  }

  const latestImportedRunTimestamp = latestImportedRun?.created_at
    ? Math.floor(new Date(latestImportedRun.created_at).getTime() / 1000)
    : null
  const afterUnixSeconds = latestImportedRunTimestamp
    ? Math.max(0, latestImportedRunTimestamp - 1)
    : Math.floor(
        (Date.now() - STRAVA_INITIAL_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000) / 1000
      )

  const activities = await fetchStravaActivities(connection.access_token, afterUnixSeconds)
  const runActivities = activities.filter(isValidStravaRun)
  let imported = 0
  let skipped = 0
  const errors: StravaSyncRowErrorDetail[] = []

  for (const activity of runActivities) {
    let payload: StravaRunInsertPayload | null = null

    try {
      payload = buildRunInsertPayload(userId, activity)
      const result = await importStravaActivityForUser(userId, activity)

      if (result.status === 'imported') {
        imported += 1
      } else if (result.status === 'skipped_existing') {
        skipped += 1
      }
    } catch (caughtError) {
      const errorDetail: StravaSyncRowErrorDetail = {
        activityId: String(activity.id),
        error: caughtError instanceof Error ? caughtError.message : 'Unknown row insert error',
      }

      if (caughtError instanceof StravaSyncRowError) {
        errorDetail.field = caughtError.field
        errorDetail.value = caughtError.value
      } else if (payload) {
        const likelyInvalidField = findLikelyInvalidIntegerField(payload)

        if (likelyInvalidField) {
          errorDetail.field = likelyInvalidField.field
          errorDetail.value = likelyInvalidField.value
        }
      }

      if (errors.length < MAX_SYNC_ERROR_DETAILS) {
        errors.push(errorDetail)
      }

      console.error('Strava sync row failed', {
        activityId: activity.id,
        error: errorDetail.error,
        field: errorDetail.field ?? null,
        value: errorDetail.value ?? null,
      })
    }
  }

  await touchStravaConnection(connection.id)

  return {
    ok: true,
    imported,
    skipped,
    failed: runActivities.length - imported - skipped,
    totalRunsFetched: runActivities.length,
    errors,
  }
}
