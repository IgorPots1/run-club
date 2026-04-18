import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createScriptSafeSupabaseAdminClient,
  hydrateSummaryOnlyStravaRun,
} from '../lib/strava/strava-summary-only-hydration'

const STRAVA_EXTERNAL_SOURCE = 'strava'
const DEFAULT_BATCH_SIZE = 200
const SCAN_PAGE_SIZE = 500
const RUN_ID_IN_QUERY_CHUNK_SIZE = 100

type Args = {
  batchSize: number
  dryRun: boolean
  userId: string | null
}

type RunRow = {
  id: string
  user_id: string
  external_id: string | null
  created_at: string
}

type RunIdRow = {
  run_id: string
}

type CandidateRun = {
  runId: string
  userId: string
  activityId: number
  createdAt: string
}

let cachedSupabaseAdminClient: SupabaseClient | null = null

function createSupabaseAdminClient() {
  if (cachedSupabaseAdminClient) {
    return cachedSupabaseAdminClient
  }

  cachedSupabaseAdminClient = createScriptSafeSupabaseAdminClient()

  return cachedSupabaseAdminClient
}

function parsePositiveInteger(value: string, flagName: string) {
  const normalizedValue = Number(value)

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new Error(`${flagName} must be a positive integer`)
  }

  return normalizedValue
}

function toPositiveInteger(value: unknown) {
  const normalizedValue = Number(value)

  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return null
  }

  return Math.round(normalizedValue)
}

function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize))
  }

  return chunks
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
      args.batchSize = parsePositiveInteger(
        argument.slice('--batch-size='.length),
        '--batch-size'
      )
      continue
    }

    if (argument.startsWith('--user-id=')) {
      args.userId = argument.slice('--user-id='.length).trim() || null
      continue
    }

    throw new Error(`Unknown argument: ${argument}`)
  }

  return args
}

async function fetchCandidateRuns(batchSize: number, userId: string | null) {
  const supabase = createSupabaseAdminClient()
  const candidates: CandidateRun[] = []

  for (let offset = 0; candidates.length < batchSize; offset += SCAN_PAGE_SIZE) {
    const runsQueryStage = 'runs query'
    let runsQuery = supabase
      .from('runs')
      .select('id, user_id, external_id, created_at')
      .eq('external_source', STRAVA_EXTERNAL_SOURCE)
      .not('external_id', 'is', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + SCAN_PAGE_SIZE - 1)

    if (userId) {
      runsQuery = runsQuery.eq('user_id', userId)
    }

    console.info('Strava summary-only candidate scan stage', {
      stage: runsQueryStage,
      offset,
      pageSize: SCAN_PAGE_SIZE,
      userId,
    })
    const { data: runsData, error: runsError } = await runsQuery

    if (runsError) {
      throw new Error(`[${runsQueryStage}] ${runsError.message}`)
    }

    const runs = (runsData as RunRow[] | null) ?? []

    if (runs.length === 0) {
      break
    }

    const runIds = runs.map((run) => run.id)
    const runDetailSeriesQueryStage = 'run_detail_series query'
    const runLapsQueryStage = 'run_laps query'

    console.info('Strava summary-only candidate scan stage', {
      stage: runDetailSeriesQueryStage,
      runIdCount: runIds.length,
      offset,
      userId,
    })
    console.info('Strava summary-only candidate scan stage', {
      stage: runLapsQueryStage,
      runIdCount: runIds.length,
      offset,
      userId,
    })
    const runIdChunks = chunkArray(runIds, RUN_ID_IN_QUERY_CHUNK_SIZE)
    const detailRows: RunIdRow[] = []
    const lapRows: RunIdRow[] = []

    for (const runIdChunk of runIdChunks) {
      const [{ data: detailChunkRows, error: detailError }, { data: lapChunkRows, error: lapError }] =
        await Promise.all([
          supabase
            .from('run_detail_series')
            .select('run_id')
            .in('run_id', runIdChunk),
          supabase
            .from('run_laps')
            .select('run_id')
            .in('run_id', runIdChunk),
        ])

      if (detailError) {
        throw new Error(`[${runDetailSeriesQueryStage}] ${detailError.message}`)
      }

      if (lapError) {
        throw new Error(`[${runLapsQueryStage}] ${lapError.message}`)
      }

      if (detailChunkRows) {
        detailRows.push(...(detailChunkRows as RunIdRow[]))
      }

      if (lapChunkRows) {
        lapRows.push(...(lapChunkRows as RunIdRow[]))
      }
    }

    const detailRunIds = new Set(detailRows.map((row) => row.run_id))
    const lapRunIds = new Set(lapRows.map((row) => row.run_id))

    for (const run of runs) {
      const activityId = toPositiveInteger(run.external_id)

      if (!activityId) {
        continue
      }

      if (detailRunIds.has(run.id) || lapRunIds.has(run.id)) {
        continue
      }

      candidates.push({
        runId: run.id,
        userId: run.user_id,
        activityId,
        createdAt: run.created_at,
      })

      if (candidates.length >= batchSize) {
        break
      }
    }

    if (runs.length < SCAN_PAGE_SIZE) {
      break
    }
  }

  return candidates
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const candidates = await fetchCandidateRuns(args.batchSize, args.userId)

  if (candidates.length === 0) {
    console.info('No Strava summary-only runs found for supplemental hydration normalization.')
    return
  }

  console.info('Starting Strava summary-only supplemental hydration backfill', {
    batchSize: args.batchSize,
    selectedRuns: candidates.length,
    dryRun: args.dryRun,
    targetUserId: args.userId,
  })

  const summary = {
    selected: candidates.length,
    hydrated: 0,
    unchanged: 0,
    failed: 0,
  }

  for (const candidate of candidates) {
    if (args.dryRun) {
      console.info('Dry run candidate', candidate)
      continue
    }

    try {
      const hydrated = await hydrateSummaryOnlyStravaRun({
        supabase: createSupabaseAdminClient(),
        runId: candidate.runId,
        activityId: candidate.activityId,
      })

      if (hydrated) {
        summary.hydrated += 1
      } else {
        summary.unchanged += 1
      }
    } catch (error) {
      summary.failed += 1
      console.warn('Strava summary-only supplemental hydration failed', {
        userId: candidate.userId,
        runId: candidate.runId,
        activityId: candidate.activityId,
        createdAt: candidate.createdAt,
        error: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }

  console.info('Strava summary-only supplemental hydration backfill complete', summary)
}

main().catch((error) => {
  console.error('Strava summary-only supplemental hydration backfill failed', {
    stage: error instanceof Error ? error.message.match(/^\[(.+?)\]/)?.[1] ?? null : null,
    error: error instanceof Error ? error.message : 'unknown_error',
  })
  process.exitCode = 1
})
