import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { hydrateRunSupplementalStravaDataForRun } from '../lib/strava/strava-sync'

const STRAVA_EXTERNAL_SOURCE = 'strava'
const RECOVERY_DISTANCES = [21097, 42195]
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

type PersonalRecordSourceRunRow = {
  run_id: string | null
}

type CandidateRun = {
  runId: string
  userId: string
  activityId: number
  createdAt: string
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
    const [{ data: detailRows, error: detailError }, { data: lapRows, error: lapError }, { data: prsRows, error: prsError }] = await Promise.all([
      supabase
        .from('run_detail_series')
        .select('run_id')
        .in('run_id', runIds),
      supabase
        .from('run_laps')
        .select('run_id')
        .in('run_id', runIds),
      supabase
        .from('personal_record_sources')
        .select('run_id')
        .in('run_id', runIds)
        .eq('source_type', 'strava_best_effort')
        .in('distance_meters', RECOVERY_DISTANCES),
    ])

    if (detailError) {
      throw new Error(detailError.message)
    }

    if (lapError) {
      throw new Error(lapError.message)
    }

    if (prsError) {
      throw new Error(prsError.message)
    }

    const detailRunIds = new Set(((detailRows as RunIdRow[] | null) ?? []).map((row) => row.run_id))
    const lapRunIds = new Set(((lapRows as RunIdRow[] | null) ?? []).map((row) => row.run_id))
    const recoveryPrRunIds = new Set(
      ((prsRows as PersonalRecordSourceRunRow[] | null) ?? [])
        .map((row) => row.run_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )

    for (const run of runs) {
      const activityId = toPositiveInteger(run.external_id)

      if (!activityId) {
        continue
      }

      if (!recoveryPrRunIds.has(run.id) || detailRunIds.has(run.id) || lapRunIds.has(run.id)) {
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
    console.info('No historical PR recovery runs found with missing detail series and laps.')
    return
  }

  console.info('Starting historical PR recovery supplemental detail backfill', {
    batchSize: args.batchSize,
    selectedRuns: candidates.length,
    dryRun: args.dryRun,
    targetUserId: args.userId,
  })

  const summary = {
    selected: candidates.length,
    hydrated: 0,
    skipped: 0,
    failed: 0,
  }

  for (const candidate of candidates) {
    if (args.dryRun) {
      console.info('Dry run candidate', candidate)
      continue
    }

    try {
      const hydrated = await hydrateRunSupplementalStravaDataForRun({
        userId: candidate.userId,
        runId: candidate.runId,
        stravaActivityId: candidate.activityId,
        ignoreCooldown: true,
      })

      if (hydrated) {
        summary.hydrated += 1
      } else {
        summary.skipped += 1
      }
    } catch (error) {
      summary.failed += 1
      console.warn('Historical PR recovery supplemental hydration failed', {
        userId: candidate.userId,
        runId: candidate.runId,
        activityId: candidate.activityId,
        createdAt: candidate.createdAt,
        error: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }

  console.info('Historical PR recovery supplemental detail backfill complete', summary)
}

main().catch((error) => {
  console.error('Historical PR recovery supplemental detail backfill failed', {
    error: error instanceof Error ? error.message : 'unknown_error',
  })
  process.exitCode = 1
})
