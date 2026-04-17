import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_BATCH_SIZE = 20
const DEFAULT_SOURCE_PAGE_SIZE = 500
const DEFAULT_BASE_URL = 'http://localhost:3000'

type Args = {
  batchSize: number
  sourcePageSize: number
  afterUserId: string | null
  baseUrl: string
  adminCookie: string | null
  help: boolean
}

type ConnectionRow = {
  id: string
  user_id: string | null
}

type RunRow = {
  external_id: string | null
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
    baseUrl: process.env.INTERNAL_API_BASE_URL?.trim() || DEFAULT_BASE_URL,
    adminCookie: process.env.ADMIN_SESSION_COOKIE?.trim() || null,
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

    if (argument.startsWith('--base-url=')) {
      args.baseUrl = argument.slice('--base-url='.length).trim() || DEFAULT_BASE_URL
      continue
    }

    if (argument.startsWith('--admin-cookie=')) {
      args.adminCookie = argument.slice('--admin-cookie='.length).trim() || null
      continue
    }

    throw new Error(`Unknown argument: ${argument}`)
  }

  return args
}

function printUsage() {
  console.log(`
Backfill historical personal records for all users by calling:
  POST /api/admin/personal-records/recover-historical-activity

Usage:
  npx tsx --env-file=.env.local scripts/backfill-all-users-historical-personal-records.ts --admin-cookie="sb-...=..."
  npx tsx --env-file=.env.local scripts/backfill-all-users-historical-personal-records.ts --batch-size=20 --after-user-id=<uuid> --admin-cookie="sb-...=..."

Required auth:
  --admin-cookie=<raw Cookie header value>
  or ADMIN_SESSION_COOKIE env var

Optional:
  --base-url=http://localhost:3000
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

async function callRecoveryApi(params: {
  baseUrl: string
  adminCookie: string
  userId: string
  activityId: number
}) {
  const response = await fetch(
    `${params.baseUrl.replace(/\/$/, '')}/api/admin/personal-records/recover-historical-activity`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: params.adminCookie,
      },
      body: JSON.stringify({
        userId: params.userId,
        stravaActivityId: params.activityId,
      }),
    }
  )

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printUsage()
    return
  }

  if (!args.adminCookie) {
    throw new Error(
      'Missing admin auth cookie. Set --admin-cookie or ADMIN_SESSION_COOKIE.'
    )
  }

  const supabase = createSupabaseAdminClient()
  const startedAt = Date.now()
  const totals = createTotals()
  const failures: Failure[] = []
  let lastProcessedUserId: string | null = args.afterUserId

  console.log('Starting all-users historical personal record recovery', {
    baseUrl: args.baseUrl,
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
            const result = await callRecoveryApi({
              baseUrl: args.baseUrl,
              adminCookie: args.adminCookie,
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
                status: result.status,
                error:
                  typeof (result.body as { error?: unknown } | null)?.error === 'string'
                    ? (result.body as { error: string }).error
                    : `http_${result.status}`,
              })

              console.error('Recovery API returned non-2xx', {
                userId,
                activityId,
                status: result.status,
                body: result.body,
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

            console.error('Recovery API request failed', {
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
