import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  recomputePersonalRecordForUserDistance,
  type SupportedPersonalRecordDistance,
} from '../lib/personal-records-recompute'

const DEFAULT_BATCH_SIZE = 100
const TARGET_DISTANCES = [5000, 10000, 21097, 42195] as const satisfies readonly SupportedPersonalRecordDistance[]
let cachedSupabaseAdminClient: SupabaseClient | null = null

type ScriptArgs = {
  batchSize: number
  afterUserId: string | null
  afterDistanceMeters: SupportedPersonalRecordDistance | null
  help: boolean
}

type Pair = {
  userId: string
  distanceMeters: SupportedPersonalRecordDistance
}

type Failure = Pair & {
  error: string
}

type Totals = {
  batches: number
  usersLoaded: number
  processedPairs: number
  updatedPairs: number
  deletedPairs: number
  failedPairs: number
}

function parsePositiveInteger(value: string, flagName: string) {
  const normalizedValue = Number(value)

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new Error(`${flagName} must be a positive integer`)
  }

  return normalizedValue
}

function isSupportedDistance(value: number): value is SupportedPersonalRecordDistance {
  return (TARGET_DISTANCES as readonly number[]).includes(value)
}

function parseDistanceMeters(value: string, flagName: string) {
  const distanceMeters = parsePositiveInteger(value, flagName)

  if (!isSupportedDistance(distanceMeters)) {
    throw new Error(`${flagName} must be one of: ${TARGET_DISTANCES.join(', ')}`)
  }

  return distanceMeters
}

function parseArgs(argv: string[]): ScriptArgs {
  const args: ScriptArgs = {
    batchSize: DEFAULT_BATCH_SIZE,
    afterUserId: null,
    afterDistanceMeters: null,
    help: false,
  }

  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') {
      args.help = true
      continue
    }

    if (argument.startsWith('--batch-size=')) {
      args.batchSize = parsePositiveInteger(argument.slice('--batch-size='.length), '--batch-size')
      continue
    }

    if (argument.startsWith('--after-user-id=')) {
      args.afterUserId = argument.slice('--after-user-id='.length).trim() || null
      continue
    }

    if (argument.startsWith('--after-distance-meters=')) {
      args.afterDistanceMeters = parseDistanceMeters(
        argument.slice('--after-distance-meters='.length),
        '--after-distance-meters'
      )
      continue
    }

    throw new Error(`Unknown argument: ${argument}`)
  }

  if (args.afterDistanceMeters !== null && !args.afterUserId) {
    throw new Error('--after-distance-meters requires --after-user-id')
  }

  if (args.afterUserId && args.afterDistanceMeters === null) {
    throw new Error('--after-user-id requires --after-distance-meters')
  }

  return args
}

function printUsage() {
  console.log(`
Recompute personal records for every user across all supported PR distances.

Usage:
  npx tsx scripts/recompute-all-user-personal-records.ts
  npx tsx scripts/recompute-all-user-personal-records.ts --batch-size=100
  npx tsx scripts/recompute-all-user-personal-records.ts --after-user-id=<uuid> --after-distance-meters=10000

Environment variables:
  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`)
}

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

function formatPair(pair: Pair) {
  return `user_id=${pair.userId} distance_meters=${pair.distanceMeters}`
}

function buildResumeArgs(pair: Pair | null) {
  if (!pair) {
    return 'none'
  }

  return `--after-user-id=${pair.userId} --after-distance-meters=${pair.distanceMeters}`
}

function createTotals(): Totals {
  return {
    batches: 0,
    usersLoaded: 0,
    processedPairs: 0,
    updatedPairs: 0,
    deletedPairs: 0,
    failedPairs: 0,
  }
}

async function fetchUserBatch(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>
  batchSize: number
  afterUserId: string | null
  includeAfterUser: boolean
}) {
  let query = params.supabase
    .from('profiles')
    .select('id')
    .order('id', { ascending: true })
    .limit(params.batchSize)

  if (params.afterUserId) {
    query = params.includeAfterUser
      ? query.gte('id', params.afterUserId)
      : query.gt('id', params.afterUserId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return ((data as Array<{ id: string | null }> | null) ?? [])
    .map((row) => row.id?.trim() ?? '')
    .filter((id): id is string => Boolean(id))
}

function buildPairsForUsers(userIds: string[], resumeAfter: Pair | null) {
  const pairs: Pair[] = []

  for (const userId of userIds) {
    const distances = resumeAfter && userId === resumeAfter.userId
      ? TARGET_DISTANCES.filter((distanceMeters) => distanceMeters > resumeAfter.distanceMeters)
      : TARGET_DISTANCES

    for (const distanceMeters of distances) {
      pairs.push({
        userId,
        distanceMeters,
      })
    }
  }

  return pairs
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printUsage()
    return
  }

  process.env.NEXT_PUBLIC_SUPABASE_URL ??= process.env.SUPABASE_URL

  const supabase = createSupabaseAdminClient()
  const startedAt = Date.now()
  const totals = createTotals()
  const failures: Failure[] = []
  let lastProcessedPair: Pair | null = args.afterUserId && args.afterDistanceMeters !== null
    ? {
        userId: args.afterUserId,
        distanceMeters: args.afterDistanceMeters,
      }
    : null

  console.log('Starting full personal record recompute', {
    batchSize: args.batchSize,
    distances: [...TARGET_DISTANCES],
    resumeAfter: lastProcessedPair ? formatPair(lastProcessedPair) : null,
    processingMode: 'sequential',
  })

  try {
    for (;;) {
      const includeAfterUser = lastProcessedPair !== null
        && lastProcessedPair.distanceMeters !== TARGET_DISTANCES[TARGET_DISTANCES.length - 1]

      const userIds = await fetchUserBatch({
        supabase,
        batchSize: args.batchSize,
        afterUserId: lastProcessedPair?.userId ?? null,
        includeAfterUser,
      })

      if (userIds.length === 0) {
        console.log('No more users to process.')
        break
      }

      const batchPairs = buildPairsForUsers(userIds, lastProcessedPair)
      if (batchPairs.length === 0) {
        lastProcessedPair = {
          userId: userIds[userIds.length - 1],
          distanceMeters: TARGET_DISTANCES[TARGET_DISTANCES.length - 1],
        }
        continue
      }

      totals.batches += 1
      totals.usersLoaded += userIds.length

      const batchFirstPair = batchPairs[0]
      const batchLastPair = batchPairs[batchPairs.length - 1]
      let batchUpdated = 0
      let batchDeleted = 0
      let batchFailures = 0

      console.log('Loaded batch', {
        batchNumber: totals.batches,
        userCount: userIds.length,
        pairCount: batchPairs.length,
        firstUserId: userIds[0],
        lastUserId: userIds[userIds.length - 1],
        firstPair: formatPair(batchFirstPair),
        lastPair: formatPair(batchLastPair),
      })

      for (const pair of batchPairs) {
        try {
          const result = await recomputePersonalRecordForUserDistance({
            supabase,
            userId: pair.userId,
            distanceMeters: pair.distanceMeters,
          })

          if (result.updated) {
            batchUpdated += 1
            totals.updatedPairs += 1
          }

          if (result.deleted) {
            batchDeleted += 1
            totals.deletedPairs += 1
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown_error'
          batchFailures += 1
          totals.failedPairs += 1
          failures.push({
            userId: pair.userId,
            distanceMeters: pair.distanceMeters,
            error: message,
          })

          console.error('Failed pair', {
            user_id: pair.userId,
            distance_meters: pair.distanceMeters,
            error: message,
          })
        }

        totals.processedPairs += 1
        lastProcessedPair = pair

        if (totals.processedPairs % 25 === 0) {
          console.log('Progress checkpoint', {
            processedPairs: totals.processedPairs,
            updatedPairs: totals.updatedPairs,
            deletedPairs: totals.deletedPairs,
            failedPairs: totals.failedPairs,
            lastProcessedPair: formatPair(pair),
            resumeArgs: buildResumeArgs(pair),
          })
        }
      }

      console.log('Batch complete', {
        batchNumber: totals.batches,
        batchUsersProcessed: userIds.length,
        batchPairsProcessed: batchPairs.length,
        batchUpdated,
        batchDeleted,
        batchFailures,
        processedPairsSoFar: totals.processedPairs,
        updatedPairsSoFar: totals.updatedPairs,
        deletedPairsSoFar: totals.deletedPairs,
        failedPairsSoFar: totals.failedPairs,
        lastProcessedPair: formatPair(batchLastPair),
        resumeArgs: buildResumeArgs(batchLastPair),
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error'

    console.error('Full personal record recompute aborted', {
      error: message,
      lastProcessedPair: lastProcessedPair ? formatPair(lastProcessedPair) : null,
      resumeArgs: buildResumeArgs(lastProcessedPair),
    })

    throw error
  }

  const elapsedMs = Date.now() - startedAt

  console.log('Full personal record recompute finished', {
    batches: totals.batches,
    usersLoaded: totals.usersLoaded,
    processedPairs: totals.processedPairs,
    updatedPairs: totals.updatedPairs,
    deletedPairs: totals.deletedPairs,
    failedPairs: totals.failedPairs,
    lastProcessedPair: lastProcessedPair ? formatPair(lastProcessedPair) : null,
    resumeArgs: buildResumeArgs(lastProcessedPair),
    elapsedMs,
  })

  if (failures.length === 0) {
    console.log('Failed pairs: none')
    return
  }

  console.log('Failed pairs:')
  for (const failure of failures) {
    console.log(
      `  user_id=${failure.userId} distance_meters=${failure.distanceMeters} error=${failure.error}`
    )
  }
}

const isDirectExecution = Boolean(
  process.argv[1]
  && new URL(import.meta.url).pathname === process.argv[1]
)

if (isDirectExecution) {
  main().catch((error) => {
    console.error('Full personal record recompute failed', {
      error: error instanceof Error ? error.message : 'unknown_error',
    })
    process.exitCode = 1
  })
}
