import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { backfillStravaSupplementalDataForRun } from '../lib/strava/strava-sync'

const STRAVA_EXTERNAL_SOURCE = 'strava'
const DEFAULT_BATCH_SIZE = 100
const SCAN_PAGE_SIZE = 500

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

let cachedSupabaseAdminClient: SupabaseClient | null = null

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

    const success = await backfillStravaSupplementalDataForRun(run.user_id, run.id)

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
