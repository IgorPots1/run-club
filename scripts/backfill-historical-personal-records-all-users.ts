import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ensureHistoricalPersonalRecordBackfillForUser } from './backfill-strava-personal-records.mjs'

const DEFAULT_BATCH_SIZE = 50
const DEFAULT_SOURCE_PAGE_SIZE = 500

type ScriptArgs = {
  batchSize: number
  sourcePageSize: number
  afterUserId: string | null
  ignoreCooldown: boolean
  help: boolean
}

type ConnectionRow = {
  id: string
  user_id: string | null
}

type UserBatch = {
  userIds: string[]
  sourceRowsScanned: number
  sourcePagesRead: number
  exhausted: boolean
}

type Failure = {
  userId: string
  error: string
}

type Totals = {
  batches: number
  processedUsers: number
  succeededUsers: number
  failedUsers: number
  triggeredUsers: number
  skippedUsers: number
  sourceRowsScanned: number
  sourcePagesRead: number
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

function parseArgs(argv: string[]): ScriptArgs {
  const args: ScriptArgs = {
    batchSize: DEFAULT_BATCH_SIZE,
    sourcePageSize: DEFAULT_SOURCE_PAGE_SIZE,
    afterUserId: null,
    ignoreCooldown: false,
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

    if (argument === '--ignore-cooldown') {
      args.ignoreCooldown = true
      continue
    }

    throw new Error(`Unknown argument: ${argument}`)
  }

  return args
}

function printUsage() {
  console.log(`
Run historical personal record backfill for all connected Strava users.

Usage:
  npx tsx --env-file=.env.local scripts/backfill-historical-personal-records-all-users.ts
  npx tsx --env-file=.env.local scripts/backfill-historical-personal-records-all-users.ts --batch-size=50
  npx tsx --env-file=.env.local scripts/backfill-historical-personal-records-all-users.ts --after-user-id=<uuid>
  npx tsx --env-file=.env.local scripts/backfill-historical-personal-records-all-users.ts --ignore-cooldown

Environment variables:
  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`)
}

function buildResumeArgs(userId: string | null) {
  return userId ? `--after-user-id=${userId}` : 'none'
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
      if (!row.user_id) {
        continue
      }

      if (row.user_id === lastUserId) {
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

function createTotals(): Totals {
  return {
    batches: 0,
    processedUsers: 0,
    succeededUsers: 0,
    failedUsers: 0,
    triggeredUsers: 0,
    skippedUsers: 0,
    sourceRowsScanned: 0,
    sourcePagesRead: 0,
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

  console.log('Starting global historical personal record backfill', {
    batchSize: args.batchSize,
    sourcePageSize: args.sourcePageSize,
    resumeAfterUserId: args.afterUserId,
    ignoreCooldown: args.ignoreCooldown,
  })

  try {
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
      let batchSucceeded = 0
      let batchFailed = 0
      let batchTriggered = 0
      let batchSkipped = 0

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
        console.log('Processing user historical PR backfill', {
          userId,
          ignoreCooldown: args.ignoreCooldown,
        })

        try {
          const result = await ensureHistoricalPersonalRecordBackfillForUser(userId, {
            ignoreCooldown: args.ignoreCooldown,
          })

          const triggered = Boolean(result?.triggered)
          const success = Boolean(result?.ok)

          if (success) {
            totals.succeededUsers += 1
            batchSucceeded += 1
          } else {
            totals.failedUsers += 1
            batchFailed += 1
          }

          if (triggered) {
            totals.triggeredUsers += 1
            batchTriggered += 1
          } else {
            totals.skippedUsers += 1
            batchSkipped += 1
          }

          console.log('Finished user historical PR backfill', {
            userId,
            ok: result?.ok ?? false,
            reason: result?.reason ?? null,
            triggered,
            jobStatus: result?.jobStatus ?? null,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown_error'
          totals.failedUsers += 1
          batchFailed += 1
          failures.push({
            userId,
            error: message,
          })

          console.error('Failed user historical PR backfill', {
            userId,
            error: message,
          })
        }

        totals.processedUsers += 1
        lastProcessedUserId = userId
      }

      console.log('User batch complete', {
        batchNumber: totals.batches,
        batchUsersProcessed: batch.userIds.length,
        batchSucceeded,
        batchFailed,
        batchTriggered,
        batchSkipped,
        processedUsersSoFar: totals.processedUsers,
        succeededUsersSoFar: totals.succeededUsers,
        failedUsersSoFar: totals.failedUsers,
        lastProcessedUserId,
        resumeArgs: buildResumeArgs(lastProcessedUserId),
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error'

    console.error('Global historical personal record backfill aborted', {
      error: message,
      lastProcessedUserId,
      resumeArgs: buildResumeArgs(lastProcessedUserId),
    })

    throw error
  }

  console.log('Global historical personal record backfill finished', {
    ...totals,
    lastProcessedUserId,
    resumeArgs: buildResumeArgs(lastProcessedUserId),
    elapsedMs: Date.now() - startedAt,
  })

  if (failures.length === 0) {
    console.log('Failed users: none')
    return
  }

  console.log('Failed users:')
  for (const failure of failures) {
    console.log(`  user_id=${failure.userId} error=${failure.error}`)
  }
}

main().catch((error) => {
  console.error('Global historical personal record backfill failed', {
    error: error instanceof Error ? error.message : 'unknown_error',
  })
  process.exitCode = 1
})
