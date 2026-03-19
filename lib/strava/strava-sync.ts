import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { fetchActivityStreams, fetchStravaActivities, isStravaAuthError, refreshStravaAccessToken } from './strava-client'
import type { StravaActivityStreams, StravaActivitySummary, StravaActivityType, StravaInitialSyncResult } from './strava-types'

const STRAVA_EXTERNAL_SOURCE = 'strava'
const FALLBACK_RUN_NAME = 'Бег'
const INITIAL_SYNC_CUTOFF = '2026-01-01T00:00:00Z'
const INITIAL_SYNC_CUTOFF_MS = new Date(INITIAL_SYNC_CUTOFF).getTime()
const INITIAL_SYNC_CUTOFF_UNIX_SECONDS = Math.floor(INITIAL_SYNC_CUTOFF_MS / 1000)
const MAX_SYNC_ERROR_DETAILS = 10
const RUN_DETAIL_SERIES_BACKFILL_BATCH_SIZE = 5
const MOJIBAKE_PATTERN = /(?:Ð.|Ñ.|Ã.|Â.)/
const ALLOWED_STRAVA_RUN_TYPES: StravaActivityType[] = ['Run']
const STRAVA_TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000
const MAX_SERIES_POINTS = 48
const MIN_SERIES_POINTS = 4

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
  average_heartrate: number | null
  max_heartrate: number | null
  map_polyline: string | null
  calories: number | null
  average_cadence: number | null
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

type MissingRunDetailSeriesRow = {
  id: string
  external_id: string | null
}

type StravaImportOutcome = 'imported' | 'updated' | 'skipped_existing' | 'skipped_invalid'

type StravaImportResult = {
  status: StravaImportOutcome
  activityId: string
}

type ImportStravaActivityOptions = {
  updateExisting?: boolean
  debugRunId?: string
  accessToken?: string
}

type StravaSyncMode = 'incremental' | 'backfill'

type SyncStravaRunsOptions = {
  mode?: StravaSyncMode
}

type RunDetailSeriesPoint = {
  x: number
  y: number
}

export class StravaReconnectRequiredError extends Error {
  constructor(message = 'Strava reconnect required') {
    super(message)
    this.name = 'StravaReconnectRequiredError'
  }
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

function toNullableIntegerField(field: string, value: number | null | undefined) {
  if (value == null) {
    return null
  }

  if (!Number.isFinite(value)) {
    throw new StravaSyncRowError(`Invalid numeric value for ${field}`, {
      field,
      value: String(value),
    })
  }

  return Math.round(value)
}

function toMapPolyline(activity: Pick<StravaActivitySummary, 'map'>) {
  const polyline = activity.map?.summary_polyline?.trim() || activity.map?.polyline?.trim() || null
  return polyline && polyline.length > 0 ? polyline : null
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

function buildBucketedSeries(
  values: number[] | undefined,
  toYValue: (value: number) => number | null
): RunDetailSeriesPoint[] | null {
  if (!Array.isArray(values) || values.length === 0) {
    return null
  }

  const bucketCount = Math.min(MAX_SERIES_POINTS, values.length)
  const points: RunDetailSeriesPoint[] = []

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const start = Math.floor((bucketIndex * values.length) / bucketCount)
    const end = Math.floor(((bucketIndex + 1) * values.length) / bucketCount)
    const bucketValues = values
      .slice(start, Math.max(start + 1, end))
      .map(toYValue)
      .filter((value): value is number => Number.isFinite(value))

    if (bucketValues.length === 0) {
      continue
    }

    const averageValue = bucketValues.reduce((sum, value) => sum + value, 0) / bucketValues.length
    points.push({
      x: points.length,
      y: Math.round(averageValue),
    })
  }

  return points.length >= MIN_SERIES_POINTS ? points : null
}

function buildPaceSeriesPoints(streams: StravaActivityStreams) {
  return buildBucketedSeries(streams.velocity_smooth, (velocityMetersPerSecond) => {
    if (!Number.isFinite(velocityMetersPerSecond) || velocityMetersPerSecond <= 0) {
      return null
    }

    const paceSecondsPerKm = 1000 / velocityMetersPerSecond

    if (paceSecondsPerKm < 120 || paceSecondsPerKm > 1200) {
      return null
    }

    return paceSecondsPerKm
  })
}

function buildHeartrateSeriesPoints(streams: StravaActivityStreams) {
  return buildBucketedSeries(streams.heartrate, (heartrate) => {
    if (!Number.isFinite(heartrate) || heartrate < 40 || heartrate > 240) {
      return null
    }

    return heartrate
  })
}

async function syncRunDetailSeriesForActivity(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: string,
  activityId: number,
  accessToken: string
) {
  try {
    const streams = await fetchActivityStreams(activityId, accessToken)
    const pacePoints = buildPaceSeriesPoints(streams)
    const heartratePoints = buildHeartrateSeriesPoints(streams)

    const { error } = await supabase
      .from('run_detail_series')
      .upsert(
        {
          run_id: runId,
          pace_points: pacePoints,
          heartrate_points: heartratePoints,
          source: STRAVA_EXTERNAL_SOURCE,
        },
        {
          onConflict: 'run_id',
        }
      )

    if (error) {
      throw new Error(error.message)
    }
  } catch (caughtError) {
    console.warn('Strava run detail series sync skipped', {
      runId,
      activityId,
      error: caughtError instanceof Error ? caughtError.message : 'Unknown streams sync error',
    })
  }
}

async function backfillMissingRunDetailSeriesForUser(userId: string, accessToken: string) {
  const supabase = createSupabaseAdminClient()
  const { data: stravaRuns, error: runsError } = await supabase
    .from('runs')
    .select('id, external_id')
    .eq('user_id', userId)
    .eq('external_source', STRAVA_EXTERNAL_SOURCE)
    .order('created_at', { ascending: false })

  if (runsError) {
    console.warn('Strava run detail series batch lookup failed', {
      userId,
      error: runsError.message,
    })
    return
  }

  const candidateRuns = ((stravaRuns as MissingRunDetailSeriesRow[] | null) ?? [])
    .filter((run) => typeof run.id === 'string' && run.id.length > 0)

  if (candidateRuns.length === 0) {
    return
  }

  const { data: existingSeriesRows, error: existingSeriesError } = await supabase
    .from('run_detail_series')
    .select('run_id')
    .in('run_id', candidateRuns.map((run) => run.id))

  if (existingSeriesError) {
    console.warn('Strava run detail series existing rows lookup failed', {
      userId,
      error: existingSeriesError.message,
    })
    return
  }

  const existingRunIds = new Set(
    (existingSeriesRows ?? [])
      .map((row) => row.run_id)
      .filter((runId): runId is string => typeof runId === 'string' && runId.length > 0)
  )

  const missingRuns = candidateRuns
    .filter((run) => !existingRunIds.has(run.id))
    .slice(0, RUN_DETAIL_SERIES_BACKFILL_BATCH_SIZE)

  if (missingRuns.length === 0) {
    return
  }

  console.info('Strava run detail series historical backfill queued', {
    userId,
    batchSize: missingRuns.length,
  })

  for (const run of missingRuns) {
    const activityId = Number(run.external_id)

    if (!Number.isFinite(activityId) || activityId <= 0) {
      console.warn('Strava run detail series historical backfill skipped invalid external id', {
        userId,
        runId: run.id,
        externalId: run.external_id,
      })
      continue
    }

    console.info('Strava run detail series fallback sync triggered', {
      runId: run.id,
      activityId,
      fallback_reason: 'historical_missing_detail_series',
    })

    await syncRunDetailSeriesForActivity(supabase, run.id, activityId, accessToken)
  }
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

function isOnOrAfterInitialSyncCutoff(startDate: string | null | undefined) {
  if (!startDate) {
    return false
  }

  const activityStartDateMs = new Date(startDate).getTime()

  if (Number.isNaN(activityStartDateMs) || Number.isNaN(INITIAL_SYNC_CUTOFF_MS)) {
    return false
  }

  return activityStartDateMs >= INITIAL_SYNC_CUTOFF_MS
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
    average_heartrate: toNullableIntegerField('average_heartrate', activity.average_heartrate),
    max_heartrate: toNullableIntegerField('max_heartrate', activity.max_heartrate),
    map_polyline: toMapPolyline(activity),
    calories: toNullableIntegerField('calories', activity.calories),
    average_cadence: toNullableIntegerField('average_cadence', activity.average_cadence),
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

function isUniqueViolationError(error: { code?: string | null } | null | undefined) {
  return error?.code === '23505'
}

function isStravaTokenExpiringSoon(expiresAt: string) {
  const expiresAtMs = new Date(expiresAt).getTime()

  if (Number.isNaN(expiresAtMs)) {
    return true
  }

  return expiresAtMs <= Date.now() + STRAVA_TOKEN_REFRESH_BUFFER_MS
}

async function markStravaConnectionReconnectRequired(connectionId: string) {
  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('strava_connections')
    .update({
      status: 'reconnect_required',
    })
    .eq('id', connectionId)

  if (error) {
    throw new Error(error.message)
  }
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
  if (connection.status === 'reconnect_required') {
    throw new StravaReconnectRequiredError()
  }

  if (!isStravaTokenExpiringSoon(connection.expires_at)) {
    return connection
  }

  let refreshedToken

  try {
    // #region agent log
    fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: `refresh-${connection.id}`, hypothesisId: 'H5', location: 'lib/strava/strava-sync.ts:ensureFreshStravaConnection:refresh_attempt', message: 'Refreshing Strava token', data: { connectionId: connection.id, athleteId: connection.strava_athlete_id, expiresAt: connection.expires_at }, timestamp: Date.now() }) }).catch(() => {})
    // #endregion
    refreshedToken = await refreshStravaAccessToken(connection.refresh_token)
  } catch (caughtError) {
    if (isStravaAuthError(caughtError)) {
      // #region agent log
      fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: `refresh-${connection.id}`, hypothesisId: 'H5', location: 'lib/strava/strava-sync.ts:ensureFreshStravaConnection:refresh_auth_failure', message: 'Strava token refresh auth failure', data: { connectionId: connection.id, athleteId: connection.strava_athlete_id }, timestamp: Date.now() }) }).catch(() => {})
      // #endregion
      await markStravaConnectionReconnectRequired(connection.id)
      throw new StravaReconnectRequiredError()
    }

    throw caughtError
  }

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
    const { data: insertedRun, error: insertError } = await supabase
      .from('runs')
      .insert(payload)
      .select('id')
      .single()

    if (insertError) {
      // #region agent log
      options.debugRunId
        ? fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: options.debugRunId, hypothesisId: 'H4', location: 'lib/strava/strava-sync.ts:importStravaActivityForUser:insert_error', message: 'Run insert failed', data: { userId, externalId: payload.external_id, errorCode: insertError.code ?? null, errorMessage: insertError.message }, timestamp: Date.now() }) }).catch(() => {})
        : undefined
      // #endregion
      if (isUniqueViolationError(insertError)) {
        // #region agent log
        options.debugRunId
          ? fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: options.debugRunId, hypothesisId: 'H3', location: 'lib/strava/strava-sync.ts:importStravaActivityForUser:unique_violation', message: 'Run insert hit unique constraint', data: { userId, externalId: payload.external_id, updateExisting: Boolean(options.updateExisting) }, timestamp: Date.now() }) }).catch(() => {})
          : undefined
        // #endregion
        return {
          status: options.updateExisting ? 'updated' : 'skipped_existing',
          activityId: payload.external_id,
        }
      }

      throw new Error(insertError.message)
    }

    if (insertedRun?.id && options.accessToken) {
      await syncRunDetailSeriesForActivity(supabase, insertedRun.id, activity.id, options.accessToken)
    }

    return {
      status: 'imported',
      activityId: payload.external_id,
    }
  }

  const requiresOwnerRepair = existingRun.user_id !== userId

  if (!options.updateExisting && !requiresOwnerRepair) {
    // #region agent log
    options.debugRunId
      ? fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: options.debugRunId, hypothesisId: 'H3', location: 'lib/strava/strava-sync.ts:importStravaActivityForUser:duplicate_skip', message: 'Skipping existing Strava run', data: { userId, externalId: payload.external_id, existingRunUserId: existingRun.user_id }, timestamp: Date.now() }) }).catch(() => {})
      : undefined
    // #endregion
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
      average_heartrate: payload.average_heartrate,
      max_heartrate: payload.max_heartrate,
      map_polyline: payload.map_polyline,
      calories: payload.calories,
      average_cadence: payload.average_cadence,
      created_at: payload.created_at,
      xp: payload.xp,
    })
    .eq('id', existingRun.id)

  if (updateError) {
    throw new Error(updateError.message)
  }

  if (options.accessToken) {
    const { data: existingSeriesRow, error: existingSeriesError } = await supabase
      .from('run_detail_series')
      .select('run_id')
      .eq('run_id', existingRun.id)
      .maybeSingle()

    if (existingSeriesError) {
      console.warn('Strava run detail series existence check failed', {
        runId: existingRun.id,
        activityId: activity.id,
        error: existingSeriesError.message,
      })
    } else if (!existingSeriesRow) {
      console.info('Strava run detail series fallback sync triggered', {
        runId: existingRun.id,
        activityId: activity.id,
        fallback_reason: 'missing_detail_series',
      })
    }

    await syncRunDetailSeriesForActivity(supabase, existingRun.id, activity.id, options.accessToken)
  }

  return {
    status: 'updated',
    activityId: payload.external_id,
  }
}

export async function syncStravaRuns(
  userId: string,
  options: SyncStravaRunsOptions = {}
): Promise<StravaInitialSyncResult> {
  const debugRunId = `sync-${Date.now()}-${userId.slice(0, 8)}`
  const syncMode: StravaSyncMode = options.mode ?? 'incremental'
  let connection: StravaConnectionRow | null = null

  try {
    connection = await getStravaConnectionForUser(userId)
  } catch (caughtError) {
    if (caughtError instanceof StravaReconnectRequiredError) {
      return {
        ok: false,
        step: 'reconnect_required',
      }
    }

    throw caughtError
  }

  if (!connection) {
    return {
      ok: false,
      step: 'missing_connection',
      debug: {
        step: 'missing_connection',
        userId,
        athleteId: null,
        connectionId: null,
        totalActivitiesFetched: 0,
        firstFetchedActivityId: null,
        firstFetchedActivityType: null,
        runActivitiesCount: 0,
        imported: 0,
        skipped: 0,
        failed: 0,
        firstFailure: null,
        afterParamUsed: null,
        latestExistingStravaRunAt: null,
      },
    }
  }

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: debugRunId, hypothesisId: 'H5', location: 'lib/strava/strava-sync.ts:syncStravaRuns:connection_loaded', message: 'Loaded Strava connection for user', data: { userId, connectionId: connection.id, connectionUserId: connection.user_id, athleteId: connection.strava_athlete_id, status: connection.status, expiresAt: connection.expires_at }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  if (connection.status === 'reconnect_required') {
    return {
      ok: false,
      step: 'reconnect_required',
      debug: {
        step: 'reconnect_required',
        userId,
        athleteId: connection.strava_athlete_id,
        connectionId: connection.id,
        totalActivitiesFetched: 0,
        firstFetchedActivityId: null,
        firstFetchedActivityType: null,
        runActivitiesCount: 0,
        imported: 0,
        skipped: 0,
        failed: 0,
        firstFailure: null,
        afterParamUsed: null,
        latestExistingStravaRunAt: null,
      },
    }
  }

  let latestImportedRun: { created_at: string } | null = null

  if (syncMode === 'incremental') {
    const supabase = createSupabaseAdminClient()
    const { data: latestImportedRunData, error: latestImportedRunError } = await supabase
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

    latestImportedRun = latestImportedRunData
  }

  const latestImportedRunTimestamp = latestImportedRun?.created_at
    ? Math.floor(new Date(latestImportedRun.created_at).getTime() / 1000)
    : null
  const afterUnixSeconds = syncMode === 'backfill'
    ? INITIAL_SYNC_CUTOFF_UNIX_SECONDS
    : latestImportedRunTimestamp
      ? Math.max(0, latestImportedRunTimestamp - 1)
      : INITIAL_SYNC_CUTOFF_UNIX_SECONDS

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: debugRunId, hypothesisId: 'H1', location: 'lib/strava/strava-sync.ts:syncStravaRuns:after_param', message: 'Computed Strava activities after parameter', data: { userId, connectionId: connection.id, latestExistingStravaRunAt: latestImportedRun?.created_at ?? null, afterParamUsed: afterUnixSeconds }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  let activities: StravaActivitySummary[] = []

  try {
    activities = await fetchStravaActivities(connection.access_token, afterUnixSeconds)
  } catch (caughtError) {
    if (isStravaAuthError(caughtError)) {
      await markStravaConnectionReconnectRequired(connection.id)
      return {
        ok: false,
        step: 'reconnect_required',
      }
    }

    throw caughtError
  }

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: debugRunId, hypothesisId: 'H1', location: 'lib/strava/strava-sync.ts:syncStravaRuns:activities_fetched', message: 'Fetched Strava activities list', data: { userId, connectionId: connection.id, totalActivitiesFetched: activities.length, firstFetchedActivityId: activities[0] ? String(activities[0].id) : null, firstFetchedActivityType: activities[0]?.type ?? null, firstFiveFetchedActivities: activities.slice(0, 5).map((activity) => ({ id: String(activity.id), type: activity.type ?? null })) }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  const runActivities = activities.filter(
    (activity) => isValidStravaRun(activity) && isOnOrAfterInitialSyncCutoff(activity.start_date)
  )

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: debugRunId, hypothesisId: 'H2', location: 'lib/strava/strava-sync.ts:syncStravaRuns:activities_filtered', message: 'Filtered Strava activities to valid runs', data: { userId, connectionId: connection.id, totalActivitiesFetched: activities.length, runActivitiesCount: runActivities.length, firstFetchedActivityId: activities[0] ? String(activities[0].id) : null, firstFetchedActivityType: activities[0]?.type ?? null }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  let imported = 0
  let skipped = 0
  const errors: StravaSyncRowErrorDetail[] = []

  for (const activity of runActivities) {
    let payload: StravaRunInsertPayload | null = null

    try {
      payload = buildRunInsertPayload(userId, activity)
      const result = await importStravaActivityForUser(userId, activity, {
        updateExisting: true,
        debugRunId,
        accessToken: connection.access_token,
      })

      if (result.status === 'imported') {
        imported += 1
      } else if (result.status === 'skipped_existing' || result.status === 'updated') {
        skipped += 1
      }

      // #region agent log
      fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: debugRunId, hypothesisId: 'H3', location: 'lib/strava/strava-sync.ts:syncStravaRuns:activity_outcome', message: 'Filtered activity processed', data: { userId, connectionId: connection.id, activityId: String(activity.id), activityType: activity.type ?? null, outcome: result.status }, timestamp: Date.now() }) }).catch(() => {})
      // #endregion
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

      // #region agent log
      fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: debugRunId, hypothesisId: 'H4', location: 'lib/strava/strava-sync.ts:syncStravaRuns:activity_failed', message: 'Filtered activity failed during import', data: { userId, connectionId: connection.id, activityId: String(activity.id), activityType: activity.type ?? null, outcome: 'failed', error: errorDetail.error }, timestamp: Date.now() }) }).catch(() => {})
      // #endregion
    }
  }

  await backfillMissingRunDetailSeriesForUser(userId, connection.access_token)

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: debugRunId, hypothesisId: 'H5', location: 'lib/strava/strava-sync.ts:syncStravaRuns:before_touch_connection', message: 'About to update last_synced_at', data: { userId, connectionId: connection.id, imported, skipped, filteredActivitiesCount: runActivities.length, importedIsZero: imported === 0 }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  await touchStravaConnection(connection.id)

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: debugRunId, hypothesisId: 'H5', location: 'lib/strava/strava-sync.ts:syncStravaRuns:after_touch_connection', message: 'Updated last_synced_at', data: { userId, connectionId: connection.id, imported, skipped, filteredActivitiesCount: runActivities.length, importedIsZero: imported === 0 }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  const failed = runActivities.length - imported - skipped
  const firstFailure = errors[0] ?? null

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: debugRunId, hypothesisId: 'H4', location: 'lib/strava/strava-sync.ts:syncStravaRuns:summary', message: 'Completed Strava sync summary', data: { userId, athleteId: connection.strava_athlete_id, connectionId: connection.id, totalActivitiesFetched: activities.length, firstFetchedActivityId: activities[0] ? String(activities[0].id) : null, firstFetchedActivityType: activities[0]?.type ?? null, runActivitiesCount: runActivities.length, imported, skipped, failed, firstFailure, afterParamUsed: afterUnixSeconds, latestExistingStravaRunAt: latestImportedRun?.created_at ?? null }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  return {
    ok: true,
    imported,
    skipped,
    failed,
    totalRunsFetched: runActivities.length,
    errors,
    debug: {
      step: 'initial_sync_complete',
      userId,
      athleteId: connection.strava_athlete_id,
      connectionId: connection.id,
      totalActivitiesFetched: activities.length,
      firstFetchedActivityId: activities[0] ? String(activities[0].id) : null,
      firstFetchedActivityType: activities[0]?.type ?? null,
      runActivitiesCount: runActivities.length,
      imported,
      skipped,
      failed,
      firstFailure,
      afterParamUsed: afterUnixSeconds,
      latestExistingStravaRunAt: latestImportedRun?.created_at ?? null,
    },
  }
}
