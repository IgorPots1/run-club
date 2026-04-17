import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_BATCH_SIZE = 200
const DEFAULT_SOURCE_PAGE_SIZE = 1000
const SUPPORTED_DISTANCES = [5000, 10000, 21097, 42195] as const

type SupportedDistance = (typeof SUPPORTED_DISTANCES)[number]

type ScriptArgs = {
  batchSize: number
  sourcePageSize: number
  afterUserId: string | null
  afterDistanceMeters: SupportedDistance | null
  help: boolean
}

type Pair = {
  userId: string
  distanceMeters: SupportedDistance
}

type Failure = Pair & {
  error: string
}

type SourceRow = {
  id: string
  user_id: string | null
  distance_meters: number | string
}

type FetchDistinctPairBatchOptions = {
  batchSize: number
  sourcePageSize: number
  afterUserId: string | null
  afterDistanceMeters: SupportedDistance | null
}

type FetchDistinctPairBatchResult = {
  pairs: Pair[]
  sourceRowsScanned: number
  sourcePagesRead: number
  exhausted: boolean
}

type Totals = {
  batches: number
  processedPairs: number
  successfulPairs: number
  failedPairs: number
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

function isSupportedDistance(value: number): value is SupportedDistance {
  return (SUPPORTED_DISTANCES as readonly number[]).includes(value)
}

function parseDistanceMeters(value: string, flagName: string) {
  const distanceMeters = parsePositiveInteger(value, flagName)

  if (!isSupportedDistance(distanceMeters)) {
    throw new Error(`${flagName} must be one of: ${SUPPORTED_DISTANCES.join(', ')}`)
  }

  return distanceMeters
}

function parseArgs(argv: string[]): ScriptArgs {
  const args: ScriptArgs = {
    batchSize: DEFAULT_BATCH_SIZE,
    sourcePageSize: DEFAULT_SOURCE_PAGE_SIZE,
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
Recompute canonical personal records from personal_record_sources in small batches.

Usage:
  npx tsx scripts/recompute-canonical-personal-records.ts
  npx tsx scripts/recompute-canonical-personal-records.ts --batch-size=200
  npx tsx scripts/recompute-canonical-personal-records.ts --after-user-id=<uuid> --after-distance-meters=10000

Environment variables:
  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`)
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

function buildCursorFilter(
  afterUserId: string | null,
  afterDistanceMeters: SupportedDistance | null
) {
  if (!afterUserId || afterDistanceMeters === null) {
    return null
  }

  return `user_id.gt.${afterUserId},and(user_id.eq.${afterUserId},distance_meters.gt.${afterDistanceMeters})`
}

async function fetchDistinctPairBatch(
  supabase: SupabaseClient,
  options: FetchDistinctPairBatchOptions
): Promise<FetchDistinctPairBatchResult> {
  const pairs: Pair[] = []
  let lastPairKey: string | null = null
  let sourceRowsScanned = 0
  let sourcePagesRead = 0
  let exhausted = false

  for (let offset = 0; pairs.length < options.batchSize; offset += options.sourcePageSize) {
    let query = supabase
      .from('personal_record_sources')
      .select('id, user_id, distance_meters')
      .in('distance_meters', [...SUPPORTED_DISTANCES])
      .order('user_id', { ascending: true })
      .order('distance_meters', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + options.sourcePageSize - 1)

    const cursorFilter = buildCursorFilter(options.afterUserId, options.afterDistanceMeters)
    if (cursorFilter) {
      query = query.or(cursorFilter)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(error.message)
    }

    const rows = (data as SourceRow[] | null) ?? []
    sourcePagesRead += 1
    sourceRowsScanned += rows.length

    for (const row of rows) {
      if (!row.user_id) {
        continue
      }

      const distanceMeters = Number(row.distance_meters)
      if (!isSupportedDistance(distanceMeters)) {
        continue
      }

      const pairKey = `${row.user_id}:${distanceMeters}`
      if (pairKey === lastPairKey) {
        continue
      }

      lastPairKey = pairKey
      pairs.push({
        userId: row.user_id,
        distanceMeters,
      })

      if (pairs.length === options.batchSize) {
        break
      }
    }

    if (rows.length < options.sourcePageSize) {
      exhausted = true
      break
    }
  }

  return {
    pairs,
    sourceRowsScanned,
    sourcePagesRead,
    exhausted,
  }
}

async function recomputePair(supabase: SupabaseClient, pair: Pair) {
  const { error } = await supabase.rpc('recompute_personal_record_for_user_distance', {
    p_user_id: pair.userId,
    p_distance_meters: pair.distanceMeters,
  })

  if (error) {
    throw new Error(error.message)
  }
}

function createTotals(): Totals {
  return {
    batches: 0,
    processedPairs: 0,
    successfulPairs: 0,
    failedPairs: 0,
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
  let lastProcessedPair: Pair | null = args.afterUserId && args.afterDistanceMeters !== null
    ? {
        userId: args.afterUserId,
        distanceMeters: args.afterDistanceMeters,
      }
    : null

  console.log('Starting canonical personal record recompute', {
    batchSize: args.batchSize,
    sourcePageSize: args.sourcePageSize,
    resumeAfter: lastProcessedPair ? formatPair(lastProcessedPair) : null,
    processingMode: 'sequential',
  })

  try {
    for (;;) {
      const batch = await fetchDistinctPairBatch(supabase, {
        batchSize: args.batchSize,
        sourcePageSize: args.sourcePageSize,
        afterUserId: lastProcessedPair?.userId ?? null,
        afterDistanceMeters: lastProcessedPair?.distanceMeters ?? null,
      })

      if (batch.pairs.length === 0) {
        console.log('No more distinct personal record pairs to process.')
        break
      }

      totals.batches += 1
      totals.sourceRowsScanned += batch.sourceRowsScanned
      totals.sourcePagesRead += batch.sourcePagesRead

      const batchFirstPair = batch.pairs[0]
      const batchLastPair = batch.pairs[batch.pairs.length - 1]
      let batchSuccesses = 0
      let batchFailures = 0

      console.log('Loaded batch', {
        batchNumber: totals.batches,
        pairCount: batch.pairs.length,
        firstPair: formatPair(batchFirstPair),
        lastPair: formatPair(batchLastPair),
        sourceRowsScanned: batch.sourceRowsScanned,
        sourcePagesRead: batch.sourcePagesRead,
        exhausted: batch.exhausted,
      })

      for (const pair of batch.pairs) {
        try {
          await recomputePair(supabase, pair)
          batchSuccesses += 1
          totals.successfulPairs += 1
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
      }

      console.log('Batch complete', {
        batchNumber: totals.batches,
        batchPairsProcessed: batch.pairs.length,
        batchSuccesses,
        batchFailures,
        processedPairsSoFar: totals.processedPairs,
        successfulPairsSoFar: totals.successfulPairs,
        failedPairsSoFar: totals.failedPairs,
        lastProcessedPair: formatPair(batchLastPair),
        resumeArgs: buildResumeArgs(batchLastPair),
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error'

    console.error('Canonical personal record recompute aborted', {
      error: message,
      lastProcessedPair: lastProcessedPair ? formatPair(lastProcessedPair) : null,
      resumeArgs: buildResumeArgs(lastProcessedPair),
    })

    throw error
  }

  const elapsedMs = Date.now() - startedAt

  console.log('Canonical personal record recompute finished', {
    batches: totals.batches,
    processedPairs: totals.processedPairs,
    successfulPairs: totals.successfulPairs,
    failedPairs: totals.failedPairs,
    sourceRowsScanned: totals.sourceRowsScanned,
    sourcePagesRead: totals.sourcePagesRead,
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

main().catch((error) => {
  console.error('Canonical personal record recompute failed', {
    error: error instanceof Error ? error.message : 'unknown_error',
  })
  process.exitCode = 1
})
