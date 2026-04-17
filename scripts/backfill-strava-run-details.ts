import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const STRAVA_EXTERNAL_SOURCE = 'strava'
const DEFAULT_BATCH_SIZE = 100
const SCAN_PAGE_SIZE = 500
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token'
const STRAVA_ACTIVITY_URL = 'https://www.strava.com/api/v3/activities'
const STRAVA_ACTIVITY_STREAM_KEYS = 'time,distance,heartrate,cadence,altitude,velocity_smooth'
const STRAVA_REQUEST_THROTTLE_MS = 350
const STRAVA_TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000
const STRAVA_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000
const MAX_SERIES_POINTS = 48
const MIN_SERIES_POINTS = 4

type Args = {
  batchSize: number
  dryRun: boolean
  userId: string | null
}

type CandidateRunRow = {
  id: string
  user_id: string
  external_id: string | null
  created_at: string
  run_detail_series:
    | {
        pace_points: unknown
        heartrate_points: unknown
      }
    | Array<{
        pace_points: unknown
        heartrate_points: unknown
      }>
    | null
}

type StravaConnectionRow = {
  id: string
  user_id: string
  strava_athlete_id: number
  access_token: string
  refresh_token: string
  expires_at: string
  rate_limited_until: string | null
  status: string
}

type StravaTokenExchangeResponse = {
  access_token: string
  refresh_token: string
  expires_at: number
  athlete?: {
    id?: number
  }
}

type StravaActivityStreams = {
  time?: number[]
  distance?: number[]
  heartrate?: number[]
  cadence?: number[]
  altitude?: number[]
  velocity_smooth?: number[]
}

type StravaActivityStreamEnvelope = {
  data?: unknown
}

type ExistingRunDetailSeriesStatusRow = {
  run_id: string
  pace_points: unknown | null
  heartrate_points: unknown | null
  cadence_points: unknown | null
  altitude_points: unknown | null
}

type RunDetailSeriesPoint = {
  time: number
  value: number
}

type RunDetailDistanceSeriesPoint = {
  distance: number
  value: number
}

let cachedSupabaseAdminClient: SupabaseClient | null = null
let stravaRequestThrottleQueue: Promise<void> = Promise.resolve()
let nextStravaRequestAllowedAt = 0

class StravaApiError extends Error {
  status: number
  responseBody: string | null
  authFailure: boolean

  constructor(message: string, status: number, responseBody: string | null, authFailure: boolean) {
    super(message)
    this.name = 'StravaApiError'
    this.status = status
    this.responseBody = responseBody
    this.authFailure = authFailure
  }
}

class StravaReconnectRequiredError extends Error {
  constructor(message = 'Strava reconnect required') {
    super(message)
    this.name = 'StravaReconnectRequiredError'
  }
}

function getSupabaseUrl() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!supabaseUrl) {
    throw new Error(
      'Missing Supabase URL. Set SUPABASE_URL for scripts, or fall back to NEXT_PUBLIC_SUPABASE_URL if needed.'
    )
  }

  return supabaseUrl
}

function getSupabaseServiceRoleKey() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!serviceRoleKey) {
    throw new Error(
      'Missing Supabase service role key. Set SUPABASE_SERVICE_ROLE_KEY before running this script.'
    )
  }

  return serviceRoleKey
}

function createSupabaseAdminClient() {
  if (cachedSupabaseAdminClient) {
    return cachedSupabaseAdminClient
  }

  cachedSupabaseAdminClient = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return cachedSupabaseAdminClient
}

function getRequiredEnv(name: 'STRAVA_CLIENT_ID' | 'STRAVA_CLIENT_SECRET') {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

function detectStravaAuthFailure(status: number, responseBody: string | null) {
  if (status === 401) {
    return true
  }

  if (!responseBody) {
    return false
  }

  return /invalid_grant|unauthorized|invalid token/i.test(responseBody)
}

function buildStravaApiError(messagePrefix: string, status: number, responseBody: string | null) {
  const authFailure = detectStravaAuthFailure(status, responseBody)
  return new StravaApiError(`${messagePrefix} with status ${status}`, status, responseBody, authFailure)
}

async function readErrorBody(response: Response) {
  try {
    return await response.text()
  } catch {
    return null
  }
}

function isStravaAuthError(error: unknown): error is StravaApiError {
  return error instanceof StravaApiError && error.authFailure
}

function isStravaNotFoundError(error: unknown): error is StravaApiError {
  return error instanceof StravaApiError && error.status === 404
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function withStravaRequestThrottle<T>(request: () => Promise<T>) {
  const previousRequest = stravaRequestThrottleQueue
  let releaseCurrentRequest: (() => void) | undefined

  stravaRequestThrottleQueue = new Promise<void>((resolve) => {
    releaseCurrentRequest = resolve
  })

  await previousRequest

  const waitMs = Math.max(0, nextStravaRequestAllowedAt - Date.now())

  if (waitMs > 0) {
    await sleep(waitMs)
  }

  nextStravaRequestAllowedAt = Date.now() + STRAVA_REQUEST_THROTTLE_MS

  try {
    return await request()
  } finally {
    releaseCurrentRequest?.()
  }
}

async function fetchStravaApi(url: string, init: RequestInit) {
  return withStravaRequestThrottle(() => fetch(url, init))
}

async function refreshStravaAccessToken(refreshToken: string): Promise<StravaTokenExchangeResponse> {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: getRequiredEnv('STRAVA_CLIENT_ID'),
      client_secret: getRequiredEnv('STRAVA_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw buildStravaApiError('Strava token refresh failed', response.status, await readErrorBody(response))
  }

  return response.json() as Promise<StravaTokenExchangeResponse>
}

function isStravaTokenExpiringSoon(expiresAt: string) {
  const expiresAtMs = new Date(expiresAt).getTime()

  if (Number.isNaN(expiresAtMs)) {
    return true
  }

  return expiresAtMs <= Date.now() + STRAVA_TOKEN_REFRESH_BUFFER_MS
}

async function markStravaConnectionReconnectRequired(connectionId: string) {
  const { error } = await createSupabaseAdminClient()
    .from('strava_connections')
    .update({
      status: 'reconnect_required',
    })
    .eq('id', connectionId)

  if (error) {
    throw new Error(error.message)
  }
}

function getStravaRateLimitCooldownRemainingMs(rateLimitedUntil: string | null | undefined) {
  if (!rateLimitedUntil) {
    return 0
  }

  const untilMs = new Date(rateLimitedUntil).getTime()

  if (!Number.isFinite(untilMs)) {
    return 0
  }

  return Math.max(0, untilMs - Date.now())
}

function hasActiveStravaRateLimitCooldown(connection: Pick<StravaConnectionRow, 'rate_limited_until'>) {
  return getStravaRateLimitCooldownRemainingMs(connection.rate_limited_until) > 0
}

function buildStravaRateLimitCooldownUntilIso(nowMs = Date.now()) {
  return new Date(nowMs + STRAVA_RATE_LIMIT_COOLDOWN_MS).toISOString()
}

async function recordStravaRateLimitCooldown(connectionId: string) {
  const rateLimitedUntil = buildStravaRateLimitCooldownUntilIso()
  const { error } = await createSupabaseAdminClient()
    .from('strava_connections')
    .update({
      rate_limited_until: rateLimitedUntil,
    })
    .eq('id', connectionId)

  if (error) {
    throw new Error(error.message)
  }

  return rateLimitedUntil
}

async function ensureFreshStravaConnection(connection: StravaConnectionRow): Promise<StravaConnectionRow> {
  if (connection.status === 'reconnect_required') {
    throw new StravaReconnectRequiredError()
  }

  if (!isStravaTokenExpiringSoon(connection.expires_at)) {
    return connection
  }

  let refreshedToken: StravaTokenExchangeResponse

  try {
    refreshedToken = await refreshStravaAccessToken(connection.refresh_token)
  } catch (error) {
    if (isStravaAuthError(error)) {
      await markStravaConnectionReconnectRequired(connection.id)
      throw new StravaReconnectRequiredError()
    }

    throw error
  }

  const nextConnection: StravaConnectionRow = {
    ...connection,
    access_token: refreshedToken.access_token,
    refresh_token: refreshedToken.refresh_token,
    expires_at: new Date(refreshedToken.expires_at * 1000).toISOString(),
    strava_athlete_id: refreshedToken.athlete?.id ?? connection.strava_athlete_id,
    status: 'connected',
  }

  const { error } = await createSupabaseAdminClient()
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

async function getStravaConnectionForUser(userId: string) {
  const { data, error } = await createSupabaseAdminClient()
    .from('strava_connections')
    .select('id, user_id, strava_athlete_id, access_token, refresh_token, expires_at, rate_limited_until, status')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  const connection = (data as StravaConnectionRow | null) ?? null
  return connection ? ensureFreshStravaConnection(connection) : null
}

async function fetchActivityStreams(
  activityId: number,
  accessToken: string
): Promise<StravaActivityStreams> {
  const params = new URLSearchParams({
    keys: STRAVA_ACTIVITY_STREAM_KEYS,
    key_by_type: 'true',
  })

  const response = await fetchStravaApi(`${STRAVA_ACTIVITY_URL}/${activityId}/streams?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw buildStravaApiError('Strava activity streams fetch failed', response.status, await readErrorBody(response))
  }

  const responseText = new TextDecoder('utf-8').decode(await response.arrayBuffer())
  const parsed = JSON.parse(responseText) as Record<string, StravaActivityStreamEnvelope> | null

  return {
    time: Array.isArray(parsed?.time?.data)
      ? parsed.time.data.filter((value): value is number => typeof value === 'number')
      : undefined,
    distance: Array.isArray(parsed?.distance?.data)
      ? parsed.distance.data.filter((value): value is number => typeof value === 'number')
      : undefined,
    heartrate: Array.isArray(parsed?.heartrate?.data)
      ? parsed.heartrate.data.filter((value): value is number => typeof value === 'number')
      : undefined,
    cadence: Array.isArray(parsed?.cadence?.data)
      ? parsed.cadence.data.filter((value): value is number => typeof value === 'number')
      : undefined,
    altitude: Array.isArray(parsed?.altitude?.data)
      ? parsed.altitude.data.filter((value): value is number => typeof value === 'number')
      : undefined,
    velocity_smooth: Array.isArray(parsed?.velocity_smooth?.data)
      ? parsed.velocity_smooth.data.filter((value): value is number => typeof value === 'number')
      : undefined,
  }
}

function buildBucketedTimeSeries(
  timeValues: number[] | undefined,
  values: number[] | undefined,
  toYValue: (value: number) => number | null
): RunDetailSeriesPoint[] | null {
  if (
    !Array.isArray(timeValues)
    || !Array.isArray(values)
    || timeValues.length === 0
    || values.length === 0
    || timeValues.length !== values.length
  ) {
    return null
  }

  const bucketCount = Math.min(MAX_SERIES_POINTS, values.length)
  const points: RunDetailSeriesPoint[] = []

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const start = Math.floor((bucketIndex * values.length) / bucketCount)
    const end = Math.floor(((bucketIndex + 1) * values.length) / bucketCount)
    const bucketPoints = values
      .slice(start, Math.max(start + 1, end))
      .map((value, indexOffset) => ({
        time: Number(timeValues[start + indexOffset]),
        value: toYValue(value),
      }))
      .filter(
        (point): point is { time: number; value: number } =>
          Number.isFinite(point.time) && Number.isFinite(point.value)
      )

    if (bucketPoints.length === 0) {
      continue
    }

    const averageTime = bucketPoints.reduce((sum, point) => sum + point.time, 0) / bucketPoints.length
    const averageValue = bucketPoints.reduce((sum, point) => sum + point.value, 0) / bucketPoints.length

    points.push({
      time: Math.round(averageTime),
      value: Math.round(averageValue),
    })
  }

  return points.length >= MIN_SERIES_POINTS ? points : null
}

function buildBucketedDistanceSeries(
  distanceValues: number[] | undefined,
  values: number[] | undefined,
  toYValue: (value: number) => number | null
): RunDetailDistanceSeriesPoint[] | null {
  if (
    !Array.isArray(distanceValues)
    || !Array.isArray(values)
    || distanceValues.length === 0
    || values.length === 0
    || distanceValues.length !== values.length
  ) {
    return null
  }

  const bucketCount = Math.min(MAX_SERIES_POINTS, values.length)
  const points: RunDetailDistanceSeriesPoint[] = []

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const start = Math.floor((bucketIndex * values.length) / bucketCount)
    const end = Math.floor(((bucketIndex + 1) * values.length) / bucketCount)
    const bucketPoints = values
      .slice(start, Math.max(start + 1, end))
      .map((value, indexOffset) => ({
        distance: Number(distanceValues[start + indexOffset]),
        value: toYValue(value),
      }))
      .filter(
        (point): point is { distance: number; value: number } =>
          Number.isFinite(point.distance) && point.distance >= 0 && Number.isFinite(point.value)
      )

    if (bucketPoints.length === 0) {
      continue
    }

    const averageDistance = bucketPoints.reduce((sum, point) => sum + point.distance, 0) / bucketPoints.length
    const averageValue = bucketPoints.reduce((sum, point) => sum + point.value, 0) / bucketPoints.length

    points.push({
      distance: Math.round(averageDistance),
      value: Math.round(averageValue),
    })
  }

  return points.length >= MIN_SERIES_POINTS ? points : null
}

function buildPaceSeriesPoints(streams: StravaActivityStreams) {
  return buildBucketedTimeSeries(streams.time, streams.velocity_smooth, (velocityMetersPerSecond) => {
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
  return buildBucketedTimeSeries(streams.time, streams.heartrate, (heartrate) => {
    if (!Number.isFinite(heartrate) || heartrate < 40 || heartrate > 240) {
      return null
    }

    return heartrate
  })
}

function buildCadenceSeriesPoints(streams: StravaActivityStreams) {
  return buildBucketedTimeSeries(streams.time, streams.cadence, (cadence) => {
    if (!Number.isFinite(cadence) || cadence < 30 || cadence > 260) {
      return null
    }

    return cadence
  })
}

function buildAltitudeSeriesPoints(streams: StravaActivityStreams) {
  return buildBucketedDistanceSeries(streams.distance, streams.altitude, (altitudeMeters) => {
    if (!Number.isFinite(altitudeMeters) || altitudeMeters < -1000 || altitudeMeters > 10000) {
      return null
    }

    return altitudeMeters
  })
}

function getMissingRunDetailSeriesState(row: ExistingRunDetailSeriesStatusRow | null) {
  return {
    pace: row == null || isSeriesMissingOrEmpty(row.pace_points),
    heartrate: row == null || isSeriesMissingOrEmpty(row.heartrate_points),
    cadence: row == null || isSeriesMissingOrEmpty(row.cadence_points),
    altitude: row == null || isSeriesMissingOrEmpty(row.altitude_points),
  }
}

async function syncRunDetailSeriesForActivity(
  runId: string,
  activityId: number,
  accessToken: string,
  connectionId?: string
) {
  try {
    const { data: existingSeriesStatus, error: existingSeriesStatusError } = await createSupabaseAdminClient()
      .from('run_detail_series')
      .select('run_id, pace_points, heartrate_points, cadence_points, altitude_points')
      .eq('run_id', runId)
      .maybeSingle()

    if (existingSeriesStatusError) {
      throw new Error(existingSeriesStatusError.message)
    }

    const missing = getMissingRunDetailSeriesState(
      (existingSeriesStatus as ExistingRunDetailSeriesStatusRow | null) ?? null
    )

    if (!missing.pace && !missing.heartrate && !missing.cadence && !missing.altitude) {
      console.info('Strava run detail series backfill skipped', {
        runId,
        activityId,
        reason: 'all_detail_series_fields_present',
      })
      return false
    }

    const streams = await fetchActivityStreams(activityId, accessToken)
    const payload: {
      run_id: string
      source: string
      pace_points?: RunDetailSeriesPoint[] | null
      heartrate_points?: RunDetailSeriesPoint[] | null
      cadence_points?: RunDetailSeriesPoint[] | null
      altitude_points?: RunDetailDistanceSeriesPoint[] | null
    } = {
      run_id: runId,
      source: STRAVA_EXTERNAL_SOURCE,
    }

    if (missing.pace) {
      payload.pace_points = buildPaceSeriesPoints(streams)
    }

    if (missing.heartrate) {
      payload.heartrate_points = buildHeartrateSeriesPoints(streams)
    }

    if (missing.cadence) {
      payload.cadence_points = buildCadenceSeriesPoints(streams)
    }

    if (missing.altitude) {
      payload.altitude_points = buildAltitudeSeriesPoints(streams)
    }

    const { error } = await createSupabaseAdminClient()
      .from('run_detail_series')
      .upsert(payload, {
        onConflict: 'run_id',
      })

    if (error) {
      throw new Error(error.message)
    }

    return true
  } catch (error) {
    if (isStravaNotFoundError(error)) {
      console.info('Strava activity streams not ready yet', {
        runId,
        activityId,
        status: error.status,
      })
      return false
    }

    if (error instanceof StravaApiError && error.status === 429) {
      if (connectionId) {
        await recordStravaRateLimitCooldown(connectionId)
      }

      console.warn('Strava supplemental sync deferred due to rate pressure', {
        runId,
        activityId,
        request: 'activities/{id}/streams',
      })
      return false
    }

    console.warn('Strava run detail series sync skipped', {
      runId,
      activityId,
      error: error instanceof Error ? error.message : 'Unknown streams sync error',
    })
    return false
  }
}

async function backfillStravaRunDetailSeriesForRun(
  userId: string,
  runId: string,
  externalId: string | null
) {
  const connection = await getStravaConnectionForUser(userId)

  if (!connection) {
    console.warn('Strava run detail series backfill skipped', {
      runId,
      userId,
      reason: 'missing_connection',
    })
    return false
  }

  if (hasActiveStravaRateLimitCooldown(connection)) {
    console.info('Strava cooldown active', {
      connectionId: connection.id,
      userId: connection.user_id,
      rateLimitedUntil: connection.rate_limited_until,
      remainingMs: getStravaRateLimitCooldownRemainingMs(connection.rate_limited_until),
    })
    return false
  }

  const activityId = Number(externalId)

  if (!Number.isFinite(activityId) || activityId <= 0) {
    console.warn('Strava run detail series backfill skipped invalid external id', {
      runId,
      userId,
      externalId,
    })
    return false
  }

  return syncRunDetailSeriesForActivity(runId, activityId, connection.access_token, connection.id)
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    batchSize: DEFAULT_BATCH_SIZE,
    dryRun: false,
    userId: null,
  }

  for (const argument of argv) {
    if (argument === '--dry-run') {
      args.dryRun = true
      continue
    }

    if (argument.startsWith('--batch-size=')) {
      const batchSize = Number(argument.slice('--batch-size='.length))

      if (!Number.isInteger(batchSize) || batchSize <= 0) {
        throw new Error(`Invalid --batch-size value: ${argument}`)
      }

      args.batchSize = Math.min(200, batchSize)
      continue
    }

    if (argument.startsWith('--user-id=')) {
      const userId = argument.slice('--user-id='.length).trim()
      args.userId = userId || null
    }
  }

  return args
}

function normalizeRunDetailSeries(
  value: CandidateRunRow['run_detail_series']
): { pace_points: unknown; heartrate_points: unknown } | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value
}

function isSeriesMissingOrEmpty(value: unknown) {
  return !Array.isArray(value) || value.length === 0
}

function isCandidateRun(row: CandidateRunRow) {
  const series = normalizeRunDetailSeries(row.run_detail_series)

  return (
    series == null
    || isSeriesMissingOrEmpty(series.pace_points)
    || isSeriesMissingOrEmpty(series.heartrate_points)
  )
}

async function fetchCandidateRuns(batchSize: number, userId: string | null) {
  const supabase = createSupabaseAdminClient()
  const candidates: CandidateRunRow[] = []

  for (let offset = 0; ; offset += SCAN_PAGE_SIZE) {
    let query = supabase
      .from('runs')
      .select('id, user_id, external_id, created_at, run_detail_series(pace_points, heartrate_points)')
      .eq('external_source', STRAVA_EXTERNAL_SOURCE)
      .order('created_at', { ascending: true })
      .range(offset, offset + SCAN_PAGE_SIZE - 1)

    if (userId) {
      query = query.eq('user_id', userId)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(error.message)
    }

    const page = (data as CandidateRunRow[] | null) ?? []

    for (const row of page) {
      if (isCandidateRun(row)) {
        candidates.push(row)
      }

      if (candidates.length >= batchSize) {
        return candidates
      }
    }

    if (page.length < SCAN_PAGE_SIZE) {
      break
    }
  }

  return candidates
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const candidateRuns = await fetchCandidateRuns(args.batchSize, args.userId)

  if (candidateRuns.length === 0) {
    console.info('No Strava runs found with missing or empty detail series.')
    return
  }

  console.info('Starting Strava run detail series backfill', {
    batchSize: args.batchSize,
    selectedRuns: candidateRuns.length,
    dryRun: args.dryRun,
    targetUserId: args.userId,
  })

  const summary = {
    selected: candidateRuns.length,
    updated: 0,
    skipped: 0,
    failed: 0,
    stoppedDueToCooldown: false,
  }

  for (const run of candidateRuns) {
    if (args.dryRun) {
      console.info('Dry run candidate', {
        runId: run.id,
        userId: run.user_id,
        createdAt: run.created_at,
        externalId: run.external_id,
      })
      continue
    }

    const success = await backfillStravaRunDetailSeriesForRun(run.user_id, run.id, run.external_id)

    console.info('Run detail backfill result', {
      runId: run.id,
      success,
      activityId: run.external_id,
    })

    if (success) {
      summary.updated += 1
      continue
    }

    summary.failed += 1
  }

  console.info('Strava run detail series backfill complete', summary)
}

main().catch((error) => {
  console.error('Strava run detail series backfill failed', {
    error: error instanceof Error ? error.message : 'unknown_error',
  })
  process.exitCode = 1
})
