import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createScriptSafeSupabaseAdminClient,
  hydrateSummaryOnlyStravaRun,
} from '../lib/strava/strava-summary-only-hydration'

const STRAVA_EXTERNAL_SOURCE = 'strava'
const DEFAULT_BATCH_SIZE = 200
const SCAN_PAGE_SIZE = 500

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

    const { data: runsData, error: runsError } = await runsQuery

    if (runsError) {
      throw new Error(runsError.message)
    }

    const runs = (runsData as RunRow[] | null) ?? []

    if (runs.length === 0) {
      break
    }

    const runIds = runs.map((run) => run.id)
    const [{ data: detailRows, error: detailError }, { data: lapRows, error: lapError }] = await Promise.all([
      supabase
        .from('run_detail_series')
        .select('run_id')
        .in('run_id', runIds),
      supabase
        .from('run_laps')
        .select('run_id')
        .in('run_id', runIds),
    ])

    if (detailError) {
      throw new Error(detailError.message)
    }

    if (lapError) {
      throw new Error(lapError.message)
    }

    const detailRunIds = new Set(((detailRows as RunIdRow[] | null) ?? []).map((row) => row.run_id))
    const lapRunIds = new Set(((lapRows as RunIdRow[] | null) ?? []).map((row) => row.run_id))

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
    error: error instanceof Error ? error.message : 'unknown_error',
  })
  process.exitCode = 1
})
