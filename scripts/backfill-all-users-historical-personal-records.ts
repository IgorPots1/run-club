import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  upsertPersonalRecordsForDistancesFromStravaPayload,
} from '../lib/personal-records-backfill-shared'
import { recomputePersonalRecordForUserDistance } from '../lib/personal-records-recompute'

const DEFAULT_BATCH_SIZE = 20
const DEFAULT_SOURCE_PAGE_SIZE = 500
const RECOVERY_DISTANCES = [21097, 42195] as const
const STRAVA_RECOVERY_FETCH_RETRY_DELAYS_MS = [15000, 30000, 60000]

type Args = {
  batchSize: number
  sourcePageSize: number
  afterUserId: string | null
  help: boolean
}

type ConnectionRow = {
  id: string
  user_id: string | null
}

type RunRow = {
  external_id: string | null
}

type RecoveryRunRow = {
  id: string
  created_at: string | null
  raw_strava_payload: unknown
  distance_meters: number | null
  moving_time_seconds: number | null
}

type UserBatch = {
  userIds: string[]
  sourceRowsScanned: number
  sourcePagesRead: number
  exhausted: boolean
}

type Totals = {
  batches: number
  processedUsers: number
  processedActivities: number
  successActivities: number
  failedActivities: number
  sourceRowsScanned: number
  sourcePagesRead: number
}

type Failure = {
  userId: string
  activityId: number
  status: number | null
  error: string
}

type PersonalRecordSupabase = Parameters<
  typeof upsertPersonalRecordsForDistancesFromStravaPayload
>[0]['supabase']

let cachedSupabaseAdminClient: SupabaseClient | null = null

function getRequiredEnv(name: string) {
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
  if (cachedSupabaseAdminClient) {
    return cachedSupabaseAdminClient
  }

  cachedSupabaseAdminClient = createClient(
    getSupabaseUrl(),
    getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )

  return cachedSupabaseAdminClient
}

function parsePositiveInteger(value: string, flagName: string) {
  const normalizedValue = Number(value)

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new Error(`${flagName} must be a positive integer`)
  }

  return normalizedValue
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    batchSize: DEFAULT_BATCH_SIZE,
    sourcePageSize: DEFAULT_SOURCE_PAGE_SIZE,
    afterUserId: null,
    help: false,
  }

  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') {
      args.help = true
      continue
    }

    if (argument.startsWith('--batch-size=')) {
      args.batchSize = parsePositiveInteger(
        argument.slice('--batch-size='.length),
        '--batch-size'
      )
      continue
    }

    if (argument.startsWith('--source-page-size=')) {
      args.sourcePageSize = parsePositiveInteger(
        argument.slice('--source-page-size='.length),
        '--source-page-size'
      )
      continue
    }

    if (argument.startsWith('--after-user-id=')) {
      args.afterUserId = argument.slice('--after-user-id='.length).trim() || null
      continue
    }

    throw new Error(`Unknown argument: ${argument}`)
  }

  return args
}

function printUsage() {
  console.log(`
Backfill historical personal records for all users via service-role recovery logic.

Usage:
  npx tsx --env-file=.env.local scripts/backfill-all-users-historical-personal-records.ts
  npx tsx --env-file=.env.local scripts/backfill-all-users-historical-personal-records.ts --batch-size=20 --after-user-id=<uuid>

Optional:
  --source-page-size=500

Environment variables:
  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`)
}

function createTotals(): Totals {
  return {
    batches: 0,
    processedUsers: 0,
    processedActivities: 0,
    successActivities: 0,
    failedActivities: 0,
    sourceRowsScanned: 0,
    sourcePagesRead: 0,
  }
}

function buildResumeArgs(userId: string | null) {
  return userId ? `--after-user-id=${userId}` : 'none'
}

function toPositiveInteger(value: unknown) {
  const normalizedValue = Number(value)

  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return null
  }

  return Math.round(normalizedValue)
}

async function fetchDistinctConnectedUserBatch(
  supabase: SupabaseClient,
  options: {
    batchSize: number
    sourcePageSize: number
    afterUserId: string | null
  }
): Promise<UserBatch> {
  const userIds: string[] = []
  let sourceRowsScanned = 0
  let sourcePagesRead = 0
  let exhausted = false
  let lastUserId: string | null = null

  for (let offset = 0; userIds.length < options.batchSize; offset += options.sourcePageSize) {
    let query = supabase
      .from('strava_connections')
      .select('id, user_id')
      .eq('status', 'connected')
      .order('user_id', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + options.sourcePageSize - 1)

    if (options.afterUserId) {
      query = query.gt('user_id', options.afterUserId)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(error.message)
    }

    const rows = (data as ConnectionRow[] | null) ?? []
    sourcePagesRead += 1
    sourceRowsScanned += rows.length

    for (const row of rows) {
      if (!row.user_id || row.user_id === lastUserId) {
        continue
      }

      lastUserId = row.user_id
      userIds.push(row.user_id)

      if (userIds.length === options.batchSize) {
        break
      }
    }

    if (rows.length < options.sourcePageSize) {
      exhausted = true
      break
    }
  }

  return {
    userIds,
    sourceRowsScanned,
    sourcePagesRead,
    exhausted,
  }
}

async function fetchUserStravaActivityIds(supabase: SupabaseClient, userId: string) {
  const activityIds = new Set<number>()
  const pageSize = 1000

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('runs')
      .select('external_id')
      .eq('user_id', userId)
      .eq('external_source', 'strava')
      .order('external_id', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) {
      throw new Error(error.message)
    }

    const rows = (data as RunRow[] | null) ?? []

    for (const row of rows) {
      const activityId = toPositiveInteger(row.external_id)
      if (activityId) {
        activityIds.add(activityId)
      }
    }

    if (rows.length < pageSize) {
      break
    }
  }

  return [...activityIds]
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRateLimitError(error: unknown) {
  if (!error || typeof error !== 'object' || !('status' in error)) {
    return false
  }

  return Number((error as { status?: unknown }).status) === 429
}

type FetchStravaActivityError = Error & { status?: number }

function buildFetchStravaActivityError(message: string, status: number) {
  const error = new Error(message) as FetchStravaActivityError
  error.status = status
  return error
}

async function fetchStravaAccessTokenForUser(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from('strava_connections')
    .select('access_token')
    .eq('user_id', userId)
    .eq('status', 'connected')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (!data?.access_token || !data.access_token.trim()) {
    return null
  }

  return data.access_token.trim()
}

async function fetchStravaActivityPayload(accessToken: string, activityId: number) {
  const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    throw buildFetchStravaActivityError(
      `Strava activity fetch failed with status ${response.status}${bodyText ? `: ${bodyText}` : ''}`,
      response.status
    )
  }

  return await response.json()
}

async function recoverHistoricalActivityForUser(params: {
  supabase: SupabaseClient
  userId: string
  activityId: number
}) {
  const externalId = String(params.activityId)
  const { data: existingRun, error: existingRunError } = await params.supabase
    .from('runs')
    .select('id, created_at, raw_strava_payload, distance_meters, moving_time_seconds')
    .eq('user_id', params.userId)
    .eq('external_source', 'strava')
    .eq('external_id', externalId)
    .maybeSingle()

  if (existingRunError) {
    throw new Error(existingRunError.message)
  }

  const run = (existingRun as RecoveryRunRow | null) ?? null

  if (!run?.id) {
    return {
      ok: false,
      error: 'missing_existing_run_for_activity',
    }
  }

  if (!run.raw_strava_payload) {
    const accessToken = await fetchStravaAccessTokenForUser(params.supabase, params.userId)

    if (!accessToken) {
      return {
        ok: false,
        error: 'missing_connected_strava_access_token',
      }
    }

    const totalAttempts = STRAVA_RECOVERY_FETCH_RETRY_DELAYS_MS.length + 1
    let updatedPayload: unknown = null

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      try {
        updatedPayload = await fetchStravaActivityPayload(accessToken, params.activityId)
        break
      } catch (error) {
        if (!isRateLimitError(error)) {
          throw error
        }

        if (attempt >= totalAttempts) {
          throw new Error('Strava activity fetch rate-limited after 3 retries')
        }

        const retryDelayMs = STRAVA_RECOVERY_FETCH_RETRY_DELAYS_MS[attempt - 1]
        console.warn('Historical activity recovery hit Strava rate limit; retrying', {
          userId: params.userId,
          activityId: params.activityId,
          attempt,
          totalAttempts,
          retryDelayMs,
        })
        await sleep(retryDelayMs)
      }
    }

    if (!updatedPayload || typeof updatedPayload !== 'object' || Array.isArray(updatedPayload)) {
      return {
        ok: false,
        error: 'invalid_strava_activity_payload',
      }
    }

    const { error: updateError } = await params.supabase
      .from('runs')
      .update({
        raw_strava_payload: updatedPayload,
        strava_synced_at: new Date().toISOString(),
      })
      .eq('id', run.id)
      .eq('user_id', params.userId)

    if (updateError) {
      throw new Error(updateError.message)
    }

    run.raw_strava_payload = updatedPayload
  }

  const personalRecordSupabase = params.supabase as PersonalRecordSupabase

  await upsertPersonalRecordsForDistancesFromStravaPayload({
    supabase: personalRecordSupabase,
    userId: params.userId,
    runId: run.id,
    rawStravaPayload: run.raw_strava_payload,
    distanceMeters: [...RECOVERY_DISTANCES],
    fallbackRecordDate: run.created_at,
    fallbackStravaActivityId: params.activityId,
    fallbackDistanceMeters: run.distance_meters,
    fallbackMovingTimeSeconds: run.moving_time_seconds,
  })

  for (const distanceMeters of RECOVERY_DISTANCES) {
    await recomputePersonalRecordForUserDistance({
      supabase: personalRecordSupabase,
      userId: params.userId,
      distanceMeters,
    })
  }

  return {
    ok: true,
    error: null,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printUsage()
    return
  }

  const supabase = createSupabaseAdminClient()
  const startedAt = Date.now()
  const totals = createTotals()
  const failures: Failure[] = []
  let lastProcessedUserId: string | null = args.afterUserId

  console.log('Starting all-users historical personal record recovery', {
    batchSize: args.batchSize,
    sourcePageSize: args.sourcePageSize,
    resumeAfterUserId: args.afterUserId,
  })

  for (;;) {
    const batch = await fetchDistinctConnectedUserBatch(supabase, {
      batchSize: args.batchSize,
      sourcePageSize: args.sourcePageSize,
      afterUserId: lastProcessedUserId,
    })

    if (batch.userIds.length === 0) {
      console.log('No more connected Strava users to process.')
      break
    }

    totals.batches += 1
    totals.sourceRowsScanned += batch.sourceRowsScanned
    totals.sourcePagesRead += batch.sourcePagesRead

    const firstUserId = batch.userIds[0]
    const lastUserId = batch.userIds[batch.userIds.length - 1]

    console.log('Loaded user batch', {
      batchNumber: totals.batches,
      userCount: batch.userIds.length,
      firstUserId,
      lastUserId,
      sourceRowsScanned: batch.sourceRowsScanned,
      sourcePagesRead: batch.sourcePagesRead,
      exhausted: batch.exhausted,
    })

    for (const userId of batch.userIds) {
      totals.processedUsers += 1
      lastProcessedUserId = userId

      let userSuccesses = 0
      let userFailures = 0

      console.log('Processing user', {
        userId,
        processedUsersSoFar: totals.processedUsers,
      })

      try {
        const activityIds = await fetchUserStravaActivityIds(supabase, userId)

        console.log('Loaded user Strava activities', {
          userId,
          activities: activityIds.length,
        })

        let userActivityIndex = 0
        for (const activityId of activityIds) {
          userActivityIndex += 1
          totals.processedActivities += 1

          console.log('Recovering activity', {
            userId,
            activityId,
            userActivityProgress: `${userActivityIndex}/${activityIds.length}`,
            totalActivitiesProcessed: totals.processedActivities,
          })

          try {
            const result = await recoverHistoricalActivityForUser({
              supabase,
              userId,
              activityId,
            })

            if (result.ok) {
              totals.successActivities += 1
              userSuccesses += 1
            } else {
              totals.failedActivities += 1
              userFailures += 1
              failures.push({
                userId,
                activityId,
                status: null,
                error: result.error ?? 'recovery_failed',
              })

              console.error('Historical recovery returned unsuccessful result', {
                userId,
                activityId,
                error: result.error,
              })
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown_error'
            totals.failedActivities += 1
            userFailures += 1
            failures.push({
              userId,
              activityId,
              status: null,
              error: message,
            })

            console.error('Historical recovery failed', {
              userId,
              activityId,
              error: message,
            })
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown_error'
        console.error('Failed loading user activities', {
          userId,
          error: message,
        })
      }

      console.log('Finished user', {
        userId,
        userSuccesses,
        userFailures,
      })
    }

    console.log('Batch complete', {
      batchNumber: totals.batches,
      processedUsersSoFar: totals.processedUsers,
      processedActivitiesSoFar: totals.processedActivities,
      successActivitiesSoFar: totals.successActivities,
      failedActivitiesSoFar: totals.failedActivities,
      lastProcessedUserId,
      resumeArgs: buildResumeArgs(lastProcessedUserId),
    })
  }

  console.log('All-users historical personal record recovery finished', {
    ...totals,
    lastProcessedUserId,
    resumeArgs: buildResumeArgs(lastProcessedUserId),
    elapsedMs: Date.now() - startedAt,
  })

  if (failures.length === 0) {
    console.log('Failures: none')
    return
  }

  console.log('Failures:')
  for (const failure of failures) {
    console.log(
      `  user_id=${failure.userId} activity_id=${failure.activityId} status=${failure.status ?? 'none'} error=${failure.error}`
    )
  }
}

main().catch((error) => {
  console.error('All-users historical personal record recovery failed', {
    error: error instanceof Error ? error.message : 'unknown_error',
  })
  process.exitCode = 1
})
