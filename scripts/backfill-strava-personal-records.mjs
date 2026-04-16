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
const MAX_PAGES_PER_RUN = 5
const MAX_DETAILED_ACTIVITIES_PER_RUN = 200
const DETAILED_ACTIVITY_PROGRESS_INTERVAL = 10
const STRAVA_FETCH_SLOW_LOG_THRESHOLD_MS = 5000
const STRAVA_DETAILED_ACTIVITY_REQUEST_DELAY_MS = 1000
const PERSONAL_RECORD_BACKFILL_JOB_COLUMNS = [
  'user_id',
  'status',
  'next_page',
  'processed_activities_count',
  'scanned_pages_count',
  'candidates_found_count',
  'inserted_or_updated_count',
  'skipped_count',
  'last_error',
  'started_at',
  'finished_at',
  'updated_at',
  'created_at',
].join(', ')

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

class StravaRateLimitError extends Error {
  constructor(requestName, metadata, rateLimit) {
    super(`Strava rate limited during ${requestName}`)
    this.name = 'StravaRateLimitError'
    this.status = 429
    this.requestName = requestName
    this.metadata = metadata
    this.rateLimit = rateLimit
  }
}

function isStravaRateLimitError(error) {
  return error instanceof StravaRateLimitError || error?.status === 429
}

function toNonNegativeInteger(value, fallback = 0) {
  const normalizedValue = Number(value)

  if (!Number.isFinite(normalizedValue) || normalizedValue < 0) {
    return fallback
  }

  return Math.round(normalizedValue)
}

function buildDefaultBackfillJob(userId) {
  return {
    user_id: userId,
    status: 'pending',
    next_page: 1,
    processed_activities_count: 0,
    scanned_pages_count: 0,
    candidates_found_count: 0,
    inserted_or_updated_count: 0,
    skipped_count: 0,
    last_error: null,
    started_at: null,
    finished_at: null,
    updated_at: null,
    created_at: null,
  }
}

function normalizeBackfillJob(row, userId) {
  const defaultJob = buildDefaultBackfillJob(userId)

  if (!row) {
    return defaultJob
  }

  return {
    ...defaultJob,
    ...row,
    next_page: Math.max(1, toNonNegativeInteger(row.next_page, 1)),
    processed_activities_count: toNonNegativeInteger(row.processed_activities_count),
    scanned_pages_count: toNonNegativeInteger(row.scanned_pages_count),
    candidates_found_count: toNonNegativeInteger(row.candidates_found_count),
    inserted_or_updated_count: toNonNegativeInteger(row.inserted_or_updated_count),
    skipped_count: toNonNegativeInteger(row.skipped_count),
  }
}

function formatBackfillJobStateForLog(job) {
  return {
    userId: job.user_id,
    status: job.status,
    nextPage: job.next_page,
    processedActivitiesCount: job.processed_activities_count,
    scannedPagesCount: job.scanned_pages_count,
    candidatesFoundCount: job.candidates_found_count,
    insertedOrUpdatedCount: job.inserted_or_updated_count,
    skippedCount: job.skipped_count,
    lastError: job.last_error,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    updatedAt: job.updated_at,
    createdAt: job.created_at,
  }
}

function formatRateLimitLastError(error) {
  const details = [`request=${error.requestName}`]

  if (typeof error.metadata?.page === 'number') {
    details.push(`page=${error.metadata.page}`)
  }

  if (typeof error.metadata?.activityId === 'number') {
    details.push(`activity_id=${error.metadata.activityId}`)
  }

  if (error.rateLimit?.limit) {
    details.push(`limit=${error.rateLimit.limit}`)
  }

  if (error.rateLimit?.usage) {
    details.push(`usage=${error.rateLimit.usage}`)
  }

  return details.join(' ')
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
  const response = await fetch(url, init)

  if (response.status === 429) {
    logStravaRateLimitHeaders(response, {
      request: options.requestName,
      ...options.metadata,
      status: response.status,
    })
  }

  return response
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

  if (response.status === 429) {
    throw new StravaRateLimitError(
      'activities_page',
      { page },
      getStravaRateLimitHeaders(response)
    )
  }

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

  if (response.status === 429) {
    throw new StravaRateLimitError(
      'detailed_activity',
      { activityId },
      getStravaRateLimitHeaders(response)
    )
  }

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

async function loadBackfillJob(supabase, userId) {
  const { data, error } = await supabase
    .from('personal_record_backfill_jobs')
    .select(PERSONAL_RECORD_BACKFILL_JOB_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return normalizeBackfillJob(data, userId)
}

async function loadOrCreateBackfillJob(supabase, userId) {
  const existingJob = await loadBackfillJob(supabase, userId)

  if (existingJob.created_at) {
    return existingJob
  }

  const { data, error } = await supabase
    .from('personal_record_backfill_jobs')
    .insert({
      user_id: userId,
      status: 'pending',
    })
    .select(PERSONAL_RECORD_BACKFILL_JOB_COLUMNS)
    .single()

  if (error) {
    if (error.code === '23505') {
      return loadBackfillJob(supabase, userId)
    }

    throw new Error(error.message)
  }

  return normalizeBackfillJob(data, userId)
}

async function updateBackfillJob(supabase, userId, patch) {
  const { data, error } = await supabase
    .from('personal_record_backfill_jobs')
    .update(patch)
    .eq('user_id', userId)
    .select(PERSONAL_RECORD_BACKFILL_JOB_COLUMNS)
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return normalizeBackfillJob(data, userId)
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

async function processActivitiesPage(params) {
  let activeConnection = params.activeConnection
  const summary = {
    activitiesListed: params.activities.length,
    activitiesScanned: 0,
    activitiesWithBestEfforts: 0,
    fiveKilometerCandidates: 0,
    tenKilometerCandidates: 0,
    detailedActivitiesFetched: 0,
    recordsUpdated: 0,
    skipped: 0,
    candidatesFound: 0,
    skipReasons: {
      noBestEfforts: 0,
      unsupportedPrDistance: 0,
      cutoffMismatch: 0,
    },
  }
  const candidatesToUpsert = []

  function logDetailedActivityProgress(force = false) {
    const processed = params.startingDetailedActivitiesFetched + summary.detailedActivitiesFetched

    if (processed === 0) {
      return
    }

    if (!force && processed % DETAILED_ACTIVITY_PROGRESS_INTERVAL !== 0) {
      return
    }

    console.info('Detailed activity progress', {
      userId: params.connection.user_id,
      athleteId: params.connection.strava_athlete_id,
      page: params.page,
      processed,
      candidatesFound: params.startingCandidatesFound + summary.candidatesFound,
      skipReasons: {
        noBestEfforts: params.aggregateSkipReasons.noBestEfforts + summary.skipReasons.noBestEfforts,
        unsupportedPrDistance:
          params.aggregateSkipReasons.unsupportedPrDistance + summary.skipReasons.unsupportedPrDistance,
        cutoffMismatch: params.aggregateSkipReasons.cutoffMismatch + summary.skipReasons.cutoffMismatch,
      },
    })
  }

  for (const activity of params.activities) {
    if (!isValidHistoricalRun(activity)) {
      if (isOnOrAfterHistoricalCutoff(activity?.start_date)) {
        summary.skipReasons.cutoffMismatch += 1
      }

      continue
    }

    summary.activitiesScanned += 1

    if (params.startingDetailedActivitiesFetched + summary.detailedActivitiesFetched > 0) {
      await sleep(STRAVA_DETAILED_ACTIVITY_REQUEST_DELAY_MS)
    }

    const detailedActivityResult = await withStravaAuthRetry(
      params.supabase,
      activeConnection,
      (accessToken) => withSlowStravaFetchLog(
        'Strava detailed activity fetch',
        {
          userId: params.connection.user_id,
          athleteId: params.connection.strava_athlete_id,
          page: params.page,
          activityId: activity.id,
        },
        () => fetchStravaDetailedActivity(accessToken, activity.id)
      )
    )
    activeConnection = detailedActivityResult.connection
    summary.detailedActivitiesFetched += 1

    const detailedActivity = asRecord(detailedActivityResult.data)

    if (!detailedActivity) {
      summary.skipped += 1
      continue
    }

    const bestEfforts = Array.isArray(detailedActivity.best_efforts) ? detailedActivity.best_efforts : []

    if (bestEfforts.length === 0) {
      summary.skipReasons.noBestEfforts += 1
      summary.skipped += 1
      logDetailedActivityProgress()
      continue
    }

    summary.activitiesWithBestEfforts += 1
    const candidates = extractStravaPersonalRecordCandidates(detailedActivity).map((candidate) => ({
      ...candidate,
      strava_activity_id: candidate.strava_activity_id ?? toPositiveInteger(detailedActivity.id),
      record_date: candidate.record_date ?? toIsoDateValue(detailedActivity.start_date),
    }))
    summary.candidatesFound += candidates.length

    if (candidates.length === 0) {
      if (hasSupportedHistoricalBestEffort(bestEfforts)) {
        if (isOnOrAfterHistoricalCutoff(detailedActivity.start_date)) {
          summary.skipReasons.cutoffMismatch += 1
        }
      } else {
        summary.skipReasons.unsupportedPrDistance += 1
      }

      summary.skipped += 1
      logDetailedActivityProgress()
      continue
    }

    for (const candidate of candidates) {
      if (candidate.distance_meters === 5000) {
        summary.fiveKilometerCandidates += 1
      }

      if (candidate.distance_meters === 10000) {
        summary.tenKilometerCandidates += 1
      }

      candidatesToUpsert.push(candidate)
    }

    logDetailedActivityProgress()
  }

  for (const candidate of candidatesToUpsert) {
    const wasUpdated = await upsertPersonalRecordIfBetter({
      supabase: params.supabase,
      userId: params.connection.user_id,
      existingRecordsByDistance: params.existingRecordsByDistance,
      candidate,
      dryRun: params.dryRun,
    })

    if (wasUpdated) {
      summary.recordsUpdated += 1
    } else {
      summary.skipped += 1
    }
  }

  if (
    summary.detailedActivitiesFetched > 0
    && (params.startingDetailedActivitiesFetched + summary.detailedActivitiesFetched)
      % DETAILED_ACTIVITY_PROGRESS_INTERVAL !== 0
  ) {
    logDetailedActivityProgress(true)
  }

  return {
    connection: activeConnection,
    summary,
  }
}

async function processConnection(supabase, connection, options) {
  let activeConnection = await ensureFreshConnection(supabase, connection)
  const existingRecordsByDistance = options.dryRun
    ? await loadExistingRecordsByDistance(supabase, connection.user_id)
    : new Map()
  let job = options.dryRun
    ? await loadBackfillJob(supabase, connection.user_id)
    : await loadOrCreateBackfillJob(supabase, connection.user_id)
  let page = job.next_page
  let pagesProcessedThisRun = 0
  const summary = {
    userId: connection.user_id,
    athleteId: connection.strava_athlete_id,
    activitiesListed: 0,
    activitiesScanned: 0,
    activitiesWithBestEfforts: 0,
    fiveKilometerCandidates: 0,
    tenKilometerCandidates: 0,
    detailedActivitiesFetched: 0,
    recordsUpdated: 0,
    skipped: 0,
    jobStatus: job.status,
  }
  const aggregateSkipReasons = {
    noBestEfforts: 0,
    unsupportedPrDistance: 0,
    cutoffMismatch: 0,
  }

  console.info('Current job state at start', formatBackfillJobStateForLog(job))

  if (options.dryRun && !job.created_at) {
    console.info('Dry run would create backfill job', {
      userId: connection.user_id,
      initialStatus: 'pending',
      nextPage: 1,
    })
  }

  if (job.status === 'completed') {
    console.info('Backfill already completed', {
      userId: connection.user_id,
      athleteId: connection.strava_athlete_id,
    })
    console.info('Final job state', formatBackfillJobStateForLog(job))
    return summary
  }

  if (!options.dryRun) {
    job = await updateBackfillJob(supabase, connection.user_id, {
      status: 'running',
      last_error: null,
      started_at: job.started_at ?? new Date().toISOString(),
      finished_at: null,
    })
  }

  console.info('Resuming historical personal record backfill', {
    userId: connection.user_id,
    athleteId: connection.strava_athlete_id,
    page,
    maxPagesPerRun: MAX_PAGES_PER_RUN,
    maxDetailedActivitiesPerRun: MAX_DETAILED_ACTIVITIES_PER_RUN,
    dryRun: options.dryRun,
  })

  let completed = false

  try {
    while (
      pagesProcessedThisRun < MAX_PAGES_PER_RUN
      && summary.detailedActivitiesFetched < MAX_DETAILED_ACTIVITIES_PER_RUN
    ) {
      const currentPage = page
      const activitiesPageResult = await withStravaAuthRetry(
        supabase,
        activeConnection,
        (accessToken) => withSlowStravaFetchLog(
          'Strava activities page fetch',
          {
            userId: connection.user_id,
            athleteId: connection.strava_athlete_id,
            page: currentPage,
          },
          () => fetchStravaActivitiesPage(accessToken, currentPage)
        )
      )
      activeConnection = activitiesPageResult.connection
      const activities = Array.isArray(activitiesPageResult.data) ? activitiesPageResult.data : []

      console.info('Fetched Strava activities page', {
        userId: connection.user_id,
        athleteId: connection.strava_athlete_id,
        page: currentPage,
        activitiesReturned: activities.length,
      })

      if (activities.length === 0) {
        completed = true
        break
      }

      const validHistoricalRunsInPage = activities.filter((activity) => isValidHistoricalRun(activity)).length

      if (
        summary.detailedActivitiesFetched > 0
        && summary.detailedActivitiesFetched + validHistoricalRunsInPage > MAX_DETAILED_ACTIVITIES_PER_RUN
      ) {
        console.info('Deferring page to keep run within detailed activity limit', {
          userId: connection.user_id,
          athleteId: connection.strava_athlete_id,
          page: currentPage,
          currentDetailedActivitiesFetched: summary.detailedActivitiesFetched,
          validHistoricalRunsInPage,
          maxDetailedActivitiesPerRun: MAX_DETAILED_ACTIVITIES_PER_RUN,
        })
        break
      }

      const pageResult = await processActivitiesPage({
        supabase,
        connection,
        activeConnection,
        activities,
        page: currentPage,
        dryRun: options.dryRun,
        existingRecordsByDistance,
        startingDetailedActivitiesFetched: summary.detailedActivitiesFetched,
        startingCandidatesFound:
          job.candidates_found_count
          + summary.fiveKilometerCandidates
          + summary.tenKilometerCandidates,
        aggregateSkipReasons,
      })
      activeConnection = pageResult.connection
      pagesProcessedThisRun += 1
      page = currentPage + 1

      summary.activitiesListed += pageResult.summary.activitiesListed
      summary.activitiesScanned += pageResult.summary.activitiesScanned
      summary.activitiesWithBestEfforts += pageResult.summary.activitiesWithBestEfforts
      summary.fiveKilometerCandidates += pageResult.summary.fiveKilometerCandidates
      summary.tenKilometerCandidates += pageResult.summary.tenKilometerCandidates
      summary.detailedActivitiesFetched += pageResult.summary.detailedActivitiesFetched
      summary.recordsUpdated += pageResult.summary.recordsUpdated
      summary.skipped += pageResult.summary.skipped
      aggregateSkipReasons.noBestEfforts += pageResult.summary.skipReasons.noBestEfforts
      aggregateSkipReasons.unsupportedPrDistance += pageResult.summary.skipReasons.unsupportedPrDistance
      aggregateSkipReasons.cutoffMismatch += pageResult.summary.skipReasons.cutoffMismatch

      console.info('Processed Strava activities page', {
        userId: connection.user_id,
        athleteId: connection.strava_athlete_id,
        page: currentPage,
        nextPage: page,
        detailedActivitiesFetched: pageResult.summary.detailedActivitiesFetched,
        candidatesFound: pageResult.summary.candidatesFound,
        insertedOrUpdated: pageResult.summary.recordsUpdated,
        skipped: pageResult.summary.skipped,
      })

      if (!options.dryRun) {
        job = await updateBackfillJob(supabase, connection.user_id, {
          status: 'running',
          next_page: page,
          processed_activities_count: job.processed_activities_count + pageResult.summary.detailedActivitiesFetched,
          scanned_pages_count: job.scanned_pages_count + 1,
          candidates_found_count: job.candidates_found_count + pageResult.summary.candidatesFound,
          inserted_or_updated_count: job.inserted_or_updated_count + pageResult.summary.recordsUpdated,
          skipped_count: job.skipped_count + pageResult.summary.skipped,
          last_error: null,
        })

        console.info('Checkpoint saved', formatBackfillJobStateForLog(job))
      } else {
        console.info('Dry run checkpoint', {
          userId: connection.user_id,
          page: currentPage,
          nextPage: page,
          processedActivitiesCountWouldBe:
            job.processed_activities_count + summary.detailedActivitiesFetched,
          scannedPagesCountWouldBe:
            job.scanned_pages_count + pagesProcessedThisRun,
          candidatesFoundCountWouldBe:
            job.candidates_found_count + summary.fiveKilometerCandidates + summary.tenKilometerCandidates,
          insertedOrUpdatedCountWouldBe:
            job.inserted_or_updated_count + summary.recordsUpdated,
          skippedCountWouldBe:
            job.skipped_count + summary.skipped,
        })
      }

      if (activities.length < STRAVA_PAGE_SIZE) {
        completed = true
        break
      }
    }
  } catch (error) {
    if (isStravaRateLimitError(error)) {
      const lastError = formatRateLimitLastError(error)

      console.warn('Paused due to Strava rate limit', {
        userId: connection.user_id,
        athleteId: connection.strava_athlete_id,
        nextPage: page,
        lastError,
      })

      if (!options.dryRun) {
        job = await updateBackfillJob(supabase, connection.user_id, {
          status: 'paused_rate_limited',
          last_error: lastError,
          finished_at: null,
        })

        console.info('Checkpoint saved', formatBackfillJobStateForLog(job))
        console.info('Final job state', formatBackfillJobStateForLog(job))
      } else {
        console.info('Final job state', formatBackfillJobStateForLog(job))
      }

      summary.jobStatus = 'paused_rate_limited'
      return summary
    }

    if (!options.dryRun) {
      job = await updateBackfillJob(supabase, connection.user_id, {
        status: 'failed',
        last_error: error instanceof Error ? error.message : 'unknown_error',
        finished_at: null,
      })

      console.info('Final job state', formatBackfillJobStateForLog(job))
    }

    throw error
  }

  if (aggregateSkipReasons.noBestEfforts > 0
    || aggregateSkipReasons.unsupportedPrDistance > 0
    || aggregateSkipReasons.cutoffMismatch > 0) {
    console.info('Detailed activity skip reasons', {
      userId: connection.user_id,
      athleteId: connection.strava_athlete_id,
      skipReasons: aggregateSkipReasons,
    })
  }

  if (completed) {
    if (!options.dryRun) {
      job = await updateBackfillJob(supabase, connection.user_id, {
        status: 'completed',
        last_error: null,
        finished_at: new Date().toISOString(),
      })
    }

    console.info('Completed historical personal record backfill', {
      userId: connection.user_id,
      athleteId: connection.strava_athlete_id,
      nextPage: page,
      dryRun: options.dryRun,
    })
  } else {
    if (!options.dryRun) {
      job = await updateBackfillJob(supabase, connection.user_id, {
        status: 'pending',
        last_error: null,
        finished_at: null,
      })
    }

    console.info('Backfill batch ended before history completion; another run is needed', {
      userId: connection.user_id,
      athleteId: connection.strava_athlete_id,
      nextPage: page,
      pagesProcessedThisRun,
      detailedActivitiesFetchedThisRun: summary.detailedActivitiesFetched,
      dryRun: options.dryRun,
    })
  }

  console.info('Final job state', formatBackfillJobStateForLog(job))
  summary.jobStatus = completed ? 'completed' : 'pending'
  return summary
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
