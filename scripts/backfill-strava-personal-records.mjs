import { createClient } from '@supabase/supabase-js'

const HISTORICAL_CUTOFF_ISO = '2026-01-01T00:00:00Z'
const HISTORICAL_CUTOFF_UNIX_SECONDS = Math.floor(new Date(HISTORICAL_CUTOFF_ISO).getTime() / 1000)
const STRAVA_ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities'
const STRAVA_ACTIVITY_URL = 'https://www.strava.com/api/v3/activities'
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token'
const STRAVA_PAGE_SIZE = 200
const SUPABASE_PAGE_SIZE = 200
const STRAVA_TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000
const SUPPORTED_PERSONAL_RECORD_DISTANCES = [5000, 10000]
const DETAILED_ACTIVITY_PROGRESS_INTERVAL = 10
const STRAVA_FETCH_SLOW_LOG_THRESHOLD_MS = 5000
const STRAVA_RATE_LIMIT_BACKOFF_MS = [15000, 30000, 60000]
const STRAVA_DETAILED_ACTIVITY_REQUEST_DELAY_MS = 1000

function getRequiredEnv(name) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

function getSupabaseUrl() {
  return process.env.SUPABASE_URL ?? getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL')
}

function createSupabaseAdminClient() {
  return createClient(getSupabaseUrl(), getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function parseArgs(argv) {
  const args = {
    userId: null,
    dryRun: false,
  }

  for (const argument of argv) {
    if (argument === '--dry-run') {
      args.dryRun = true
      continue
    }

    if (argument.startsWith('--user-id=')) {
      args.userId = argument.slice('--user-id='.length).trim() || null
    }
  }

  return args
}

function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null
}

function toPositiveInteger(value) {
  const normalizedValue = Number(value)

  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return null
  }

  return Math.round(normalizedValue)
}

function toSupportedDistance(value) {
  const normalizedValue = toPositiveInteger(value)
  return normalizedValue === 5000 || normalizedValue === 10000 ? normalizedValue : null
}

function normalizeBestEffortName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, '') : ''
}

function resolveHistoricalBestEffortDistance(bestEffort) {
  const exactDistance = toSupportedDistance(bestEffort.distance)

  if (exactDistance) {
    return exactDistance
  }

  const normalizedName = normalizeBestEffortName(bestEffort.name)

  if (!normalizedName) {
    return null
  }

  if (normalizedName === '5k' || normalizedName === '5km' || normalizedName.includes('5000')) {
    return 5000
  }

  if (normalizedName === '10k' || normalizedName === '10km' || normalizedName.includes('10000')) {
    return 10000
  }

  return null
}

function toIsoDateValue(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return null
  }

  return parsedDate.toISOString().slice(0, 10)
}

function toNullableTrimmedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isOnOrAfterHistoricalCutoff(value) {
  if (typeof value !== 'string') {
    return false
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp >= new Date(HISTORICAL_CUTOFF_ISO).getTime()
}

function buildBestEffortMetadata(bestEffort) {
  const metadataEntries = Object.entries({
    name: toNullableTrimmedString(bestEffort.name),
    pr_rank: toPositiveInteger(bestEffort.pr_rank),
    elapsed_time: toPositiveInteger(bestEffort.elapsed_time),
    moving_time: toPositiveInteger(bestEffort.moving_time),
    start_index: toPositiveInteger(bestEffort.start_index),
    end_index: toPositiveInteger(bestEffort.end_index),
  }).filter(([, value]) => value !== null)

  return metadataEntries.length > 0 ? Object.fromEntries(metadataEntries) : null
}

function extractStravaPersonalRecordCandidates(rawStravaPayload) {
  const payloadRecord = asRecord(rawStravaPayload)
  const bestEfforts = Array.isArray(payloadRecord?.best_efforts) ? payloadRecord.best_efforts : []
  const candidatesByDistance = new Map()

  for (const bestEffortValue of bestEfforts) {
    const bestEffort = asRecord(bestEffortValue)

    if (!bestEffort) {
      continue
    }

    const distanceMeters = resolveHistoricalBestEffortDistance(bestEffort)
    const durationSeconds = toPositiveInteger(bestEffort.elapsed_time ?? bestEffort.moving_time)

    if (!distanceMeters || !durationSeconds) {
      continue
    }

    const activityRecord = asRecord(bestEffort.activity)
    const candidate = {
      distance_meters: distanceMeters,
      duration_seconds: durationSeconds,
      pace_seconds_per_km: Math.round(durationSeconds / (distanceMeters / 1000)),
      record_date:
        toIsoDateValue(bestEffort.start_date)
        ?? toIsoDateValue(bestEffort.start_date_local)
        ?? toIsoDateValue(payloadRecord?.start_date)
        ?? toIsoDateValue(payloadRecord?.start_date_local),
      strava_activity_id: toPositiveInteger(activityRecord?.id ?? bestEffort.activity_id ?? payloadRecord?.id),
      source: 'historical_strava_best_effort',
      metadata: buildBestEffortMetadata(bestEffort),
    }

    const existingCandidate = candidatesByDistance.get(distanceMeters)

    if (!existingCandidate || candidate.duration_seconds < existingCandidate.duration_seconds) {
      candidatesByDistance.set(distanceMeters, candidate)
    }
  }

  return SUPPORTED_PERSONAL_RECORD_DISTANCES
    .map((distanceMeters) => candidatesByDistance.get(distanceMeters) ?? null)
    .filter(Boolean)
}

function isValidHistoricalRun(activity) {
  if (typeof activity?.start_date !== 'string') {
    return false
  }

  const activityTimestamp = new Date(activity.start_date).getTime()

  return (
    activity?.type === 'Run'
    && Number.isFinite(Number(activity?.distance))
    && Number(activity.distance) > 0
    && Number.isFinite(Number(activity?.moving_time))
    && Number(activity.moving_time) > 0
    && Number.isFinite(activityTimestamp)
    && activityTimestamp < new Date(HISTORICAL_CUTOFF_ISO).getTime()
  )
}

function hasSupportedHistoricalBestEffort(bestEfforts) {
  for (const bestEffortValue of bestEfforts) {
    const bestEffort = asRecord(bestEffortValue)

    if (bestEffort && resolveHistoricalBestEffortDistance(bestEffort)) {
      return true
    }
  }

  return false
}

async function withSlowStravaFetchLog(label, metadata, request) {
  const startedAt = Date.now()
  let slowLogEmitted = false
  const timer = setTimeout(() => {
    slowLogEmitted = true
    console.info(`${label} still in progress`, {
      ...metadata,
      elapsedMs: Date.now() - startedAt,
    })
  }, STRAVA_FETCH_SLOW_LOG_THRESHOLD_MS)

  timer.unref?.()

  try {
    const result = await request()

    if (slowLogEmitted) {
      console.info(`${label} completed`, {
        ...metadata,
        elapsedMs: Date.now() - startedAt,
      })
    }

    return result
  } finally {
    clearTimeout(timer)
  }
}

function getStravaRateLimitHeaders(response) {
  const limit = response.headers.get('X-RateLimit-Limit')
  const usage = response.headers.get('X-RateLimit-Usage')

  if (!limit && !usage) {
    return null
  }

  return {
    limit,
    usage,
  }
}

function logStravaRateLimitHeaders(response, metadata) {
  const rateLimit = getStravaRateLimitHeaders(response)

  if (!rateLimit) {
    return
  }

  console.info('Strava rate limit', {
    ...metadata,
    limit: rateLimit.limit,
    usage: rateLimit.usage,
  })
}

async function fetchStravaApiWithRateLimitRetry(url, init, options) {
  for (let attempt = 0; attempt <= STRAVA_RATE_LIMIT_BACKOFF_MS.length; attempt += 1) {
    const response = await fetch(url, init)

    if (response.status !== 429) {
      return response
    }

    logStravaRateLimitHeaders(response, {
      request: options.requestName,
      ...options.metadata,
      status: response.status,
    })

    const retryDelayMs = STRAVA_RATE_LIMIT_BACKOFF_MS[attempt]

    if (!retryDelayMs) {
      return response
    }

    console.warn('Strava rate limited, entering retry', {
      request: options.requestName,
      ...options.metadata,
      retryAttempt: attempt + 1,
      retryDelayMs,
      status: response.status,
    })

    await sleep(retryDelayMs)
  }
}

async function refreshStravaAccessToken(refreshToken) {
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
  })

  if (!response.ok) {
    throw new Error(`Strava token refresh failed with status ${response.status}`)
  }

  return response.json()
}

function isTokenExpiringSoon(expiresAt) {
  const expiresAtMs = new Date(expiresAt).getTime()

  if (Number.isNaN(expiresAtMs)) {
    return true
  }

  return expiresAtMs <= Date.now() + STRAVA_TOKEN_REFRESH_BUFFER_MS
}

async function ensureFreshConnection(supabase, connection) {
  if (!isTokenExpiringSoon(connection.expires_at)) {
    return connection
  }

  const refreshedToken = await refreshStravaAccessToken(connection.refresh_token)
  const nextConnection = {
    ...connection,
    access_token: refreshedToken.access_token,
    refresh_token: refreshedToken.refresh_token,
    expires_at: new Date(refreshedToken.expires_at * 1000).toISOString(),
    strava_athlete_id: refreshedToken.athlete?.id ?? connection.strava_athlete_id,
    status: 'connected',
  }

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

async function fetchStravaActivitiesPage(accessToken, page) {
  const params = new URLSearchParams({
    before: String(HISTORICAL_CUTOFF_UNIX_SECONDS),
    page: String(page),
    per_page: String(STRAVA_PAGE_SIZE),
  })

  const response = await fetchStravaApiWithRateLimitRetry(
    `${STRAVA_ACTIVITIES_URL}?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    },
    {
      requestName: 'activities_page',
      metadata: {
        page,
      },
    }
  )

  if (!response.ok) {
    const error = new Error(`Strava activities fetch failed with status ${response.status}`)
    error.status = response.status
    throw error
  }

  return response.json()
}

async function fetchStravaDetailedActivity(accessToken, activityId) {
  const response = await fetchStravaApiWithRateLimitRetry(
    `${STRAVA_ACTIVITY_URL}/${activityId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    },
    {
      requestName: 'detailed_activity',
      metadata: {
        activityId,
      },
    }
  )

  if (!response.ok) {
    const error = new Error(`Strava activity fetch failed with status ${response.status}`)
    error.status = response.status
    throw error
  }

  return response.json()
}

async function withStravaAuthRetry(supabase, connection, request) {
  let activeConnection = connection

  try {
    return {
      connection: activeConnection,
      data: await request(activeConnection.access_token),
    }
  } catch (error) {
    if (error?.status !== 401) {
      throw error
    }
  }

  activeConnection = await ensureFreshConnection(supabase, {
    ...connection,
    expires_at: new Date(0).toISOString(),
  })

  return {
    connection: activeConnection,
    data: await request(activeConnection.access_token),
  }
}

async function loadConnections(supabase, userId) {
  const rows = []

  for (let offset = 0; ; offset += SUPABASE_PAGE_SIZE) {
    let query = supabase
      .from('strava_connections')
      .select('id, user_id, strava_athlete_id, access_token, refresh_token, expires_at, status')
      .eq('status', 'connected')
      .order('user_id', { ascending: true })
      .range(offset, offset + SUPABASE_PAGE_SIZE - 1)

    if (userId) {
      query = query.eq('user_id', userId)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(error.message)
    }

    const page = data ?? []
    rows.push(...page)

    if (page.length < SUPABASE_PAGE_SIZE) {
      break
    }
  }

  return rows
}

async function loadExistingRecordsByDistance(supabase, userId) {
  const { data, error } = await supabase
    .from('personal_records')
    .select('distance_meters, duration_seconds')
    .eq('user_id', userId)

  if (error) {
    throw new Error(error.message)
  }

  const recordsByDistance = new Map()

  for (const row of data ?? []) {
    const distanceMeters = toSupportedDistance(row.distance_meters)
    const durationSeconds = toPositiveInteger(row.duration_seconds)

    if (!distanceMeters || !durationSeconds) {
      continue
    }

    recordsByDistance.set(distanceMeters, {
      duration_seconds: durationSeconds,
    })
  }

  return recordsByDistance
}

async function upsertPersonalRecordIfBetter(params) {
  if (params.dryRun) {
    const existingRecord = params.existingRecordsByDistance.get(params.candidate.distance_meters)

    if (existingRecord && existingRecord.duration_seconds <= params.candidate.duration_seconds) {
      return false
    }

    params.existingRecordsByDistance.set(params.candidate.distance_meters, {
      duration_seconds: params.candidate.duration_seconds,
    })

    return true
  }

  const { data, error } = await params.supabase.rpc('upsert_personal_record_if_better', {
    p_user_id: params.userId,
    p_distance_meters: params.candidate.distance_meters,
    p_duration_seconds: params.candidate.duration_seconds,
    p_pace_seconds_per_km: params.candidate.pace_seconds_per_km,
    p_run_id: null,
    p_strava_activity_id: params.candidate.strava_activity_id,
    p_record_date: params.candidate.record_date ? `${params.candidate.record_date}T00:00:00.000Z` : null,
    p_source: params.candidate.source,
    p_metadata: params.candidate.metadata,
  })

  if (error) {
    throw new Error(error.message)
  }

  return Boolean(data)
}

async function processConnection(supabase, connection, options) {
  let activeConnection = await ensureFreshConnection(supabase, connection)
  const existingRecordsByDistance = options.dryRun
    ? await loadExistingRecordsByDistance(supabase, connection.user_id)
    : new Map()
  let page = 1
  let activitiesListed = 0
  let activitiesScanned = 0
  let activitiesWithBestEfforts = 0
  let fiveKilometerCandidates = 0
  let tenKilometerCandidates = 0
  let detailedActivitiesFetched = 0
  let recordsUpdated = 0
  let skipped = 0
  let candidatesFound = 0
  const skipReasons = {
    noBestEfforts: 0,
    unsupportedPrDistance: 0,
    cutoffMismatch: 0,
  }

  function logDetailedActivityProgress(force = false) {
    if (!force && detailedActivitiesFetched % DETAILED_ACTIVITY_PROGRESS_INTERVAL !== 0) {
      return
    }

    console.info('Detailed activity progress', {
      userId: connection.user_id,
      athleteId: connection.strava_athlete_id,
      processed: detailedActivitiesFetched,
      candidatesFound,
      skipReasons,
    })
  }

  while (true) {
    const activitiesPageResult = await withStravaAuthRetry(
      supabase,
      activeConnection,
      (accessToken) => withSlowStravaFetchLog(
        'Strava activities page fetch',
        {
          userId: connection.user_id,
          athleteId: connection.strava_athlete_id,
          page,
        },
        () => fetchStravaActivitiesPage(accessToken, page)
      )
    )
    activeConnection = activitiesPageResult.connection
    const activities = Array.isArray(activitiesPageResult.data) ? activitiesPageResult.data : []

    console.info('Fetched Strava activities page', {
      userId: connection.user_id,
      athleteId: connection.strava_athlete_id,
      page,
      activitiesReturned: activities.length,
    })

    if (activities.length === 0) {
      break
    }

    activitiesListed += activities.length

    for (const activity of activities) {
      if (!isValidHistoricalRun(activity)) {
        if (isOnOrAfterHistoricalCutoff(activity?.start_date)) {
          skipReasons.cutoffMismatch += 1
        }

        continue
      }

      activitiesScanned += 1

      if (detailedActivitiesFetched > 0) {
        await sleep(STRAVA_DETAILED_ACTIVITY_REQUEST_DELAY_MS)
      }

      const detailedActivityResult = await withStravaAuthRetry(
        supabase,
        activeConnection,
        (accessToken) => withSlowStravaFetchLog(
          'Strava detailed activity fetch',
          {
            userId: connection.user_id,
            athleteId: connection.strava_athlete_id,
            activityId: activity.id,
          },
          () => fetchStravaDetailedActivity(accessToken, activity.id)
        )
      )
      activeConnection = detailedActivityResult.connection
      detailedActivitiesFetched += 1

      const detailedActivity = asRecord(detailedActivityResult.data)

      if (!detailedActivity) {
        skipped += 1
        continue
      }

      const bestEfforts = Array.isArray(detailedActivity.best_efforts) ? detailedActivity.best_efforts : []

      if (bestEfforts.length === 0) {
        skipReasons.noBestEfforts += 1
        skipped += 1
        logDetailedActivityProgress()
        continue
      }

      activitiesWithBestEfforts += 1
      const candidates = extractStravaPersonalRecordCandidates(detailedActivity).map((candidate) => ({
        ...candidate,
        strava_activity_id: candidate.strava_activity_id ?? toPositiveInteger(detailedActivity.id),
        record_date: candidate.record_date ?? toIsoDateValue(detailedActivity.start_date),
      }))
      candidatesFound += candidates.length

      if (candidates.length === 0) {
        if (hasSupportedHistoricalBestEffort(bestEfforts)) {
          if (isOnOrAfterHistoricalCutoff(detailedActivity.start_date)) {
            skipReasons.cutoffMismatch += 1
          }
        } else {
          skipReasons.unsupportedPrDistance += 1
        }

        skipped += 1
        logDetailedActivityProgress()
        continue
      }

      for (const candidate of candidates) {
        if (candidate.distance_meters === 5000) {
          fiveKilometerCandidates += 1
        }

        if (candidate.distance_meters === 10000) {
          tenKilometerCandidates += 1
        }

        const wasUpdated = await upsertPersonalRecordIfBetter({
          supabase,
          userId: connection.user_id,
          existingRecordsByDistance,
          candidate,
          dryRun: options.dryRun,
        })

        if (wasUpdated) {
          recordsUpdated += 1
        } else {
          skipped += 1
        }
      }

      logDetailedActivityProgress()
    }

    page += 1
  }

  if (skipReasons.noBestEfforts > 0 || skipReasons.unsupportedPrDistance > 0 || skipReasons.cutoffMismatch > 0) {
    console.info('Detailed activity skip reasons', {
      userId: connection.user_id,
      athleteId: connection.strava_athlete_id,
      skipReasons,
    })
  }

  if (detailedActivitiesFetched % DETAILED_ACTIVITY_PROGRESS_INTERVAL !== 0) {
    logDetailedActivityProgress(true)
  }

  return {
    userId: connection.user_id,
    athleteId: connection.strava_athlete_id,
    activitiesListed,
    activitiesScanned,
    activitiesWithBestEfforts,
    fiveKilometerCandidates,
    tenKilometerCandidates,
    detailedActivitiesFetched,
    recordsUpdated,
    skipped,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const supabase = createSupabaseAdminClient()
  const connections = await loadConnections(supabase, args.userId)

  if (connections.length === 0) {
    console.info('No connected Strava users found for personal record backfill.')
    return
  }

  console.info('Starting personal record backfill', {
    historicalCutoff: HISTORICAL_CUTOFF_ISO,
    users: connections.length,
    dryRun: args.dryRun,
    targetUserId: args.userId,
  })

  const summaries = []

  for (const connection of connections) {
    console.info('Processing user', {
      userId: connection.user_id,
      athleteId: connection.strava_athlete_id,
      dryRun: args.dryRun,
    })

    const summary = await processConnection(supabase, connection, {
      dryRun: args.dryRun,
    })
    summaries.push(summary)

    console.info('Finished user', summary)
  }

  const totals = summaries.reduce(
    (accumulator, summary) => {
      accumulator.users += 1
      accumulator.activitiesListed += summary.activitiesListed
      accumulator.activitiesScanned += summary.activitiesScanned
      accumulator.activitiesWithBestEfforts += summary.activitiesWithBestEfforts
      accumulator.fiveKilometerCandidates += summary.fiveKilometerCandidates
      accumulator.tenKilometerCandidates += summary.tenKilometerCandidates
      accumulator.detailedActivitiesFetched += summary.detailedActivitiesFetched
      accumulator.recordsUpdated += summary.recordsUpdated
      accumulator.skipped += summary.skipped
      return accumulator
    },
    {
      users: 0,
      activitiesListed: 0,
      activitiesScanned: 0,
      activitiesWithBestEfforts: 0,
      fiveKilometerCandidates: 0,
      tenKilometerCandidates: 0,
      detailedActivitiesFetched: 0,
      recordsUpdated: 0,
      skipped: 0,
    }
  )

  console.info('Personal record backfill complete', totals)
}

main().catch((error) => {
  console.error('Personal record backfill failed', {
    error: error instanceof Error ? error.message : 'unknown_error',
  })
  process.exitCode = 1
})
