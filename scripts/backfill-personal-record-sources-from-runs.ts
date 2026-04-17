import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const STRAVA_EXTERNAL_SOURCE = 'strava'
const DEFAULT_BATCH_SIZE = 200
const SUPPORTED_DISTANCES = [5000, 10000, 21097, 42195] as const
const FULL_RUN_DISTANCE_TOLERANCES: Record<(typeof SUPPORTED_DISTANCES)[number], number> = {
  5000: 25,
  10000: 25,
  21097: 30,
  42195: 50,
}

type SupportedDistance = (typeof SUPPORTED_DISTANCES)[number]

type Args = {
  batchSize: number
  dryRun: boolean
  maxBatches: number | null
}

type RunRow = {
  id: string
  user_id: string | null
  external_id: string | null
  created_at: string
  distance_meters: number | null
  moving_time_seconds: number | null
  raw_strava_payload: unknown
}

type Cursor = {
  createdAt: string
  runId: string
}

type PersonalRecordCandidate = {
  distance_meters: SupportedDistance
  duration_seconds: number
  pace_seconds_per_km: number
  record_date: string | null
  strava_activity_id: number | null
  source: string
  metadata: Record<string, unknown> | null
}

type Totals = {
  scannedRuns: number
  skippedRuns: number
  extractedCandidates: number
  fallbackCandidates: number
  checkedCandidates: number
  updatedCandidates: number
  failedRuns: number
  batches: number
}

let cachedSupabaseAdminClient: SupabaseClient | null = null

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function getRequiredEnv(name: 'SUPABASE_SERVICE_ROLE_KEY' | 'SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_URL') {
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
    dryRun: false,
    maxBatches: null,
  }

  for (const argument of argv) {
    if (argument === '--dry-run') {
      args.dryRun = true
      continue
    }

    if (argument.startsWith('--batch-size=')) {
      args.batchSize = parsePositiveInteger(argument.slice('--batch-size='.length), '--batch-size')
      continue
    }

    if (argument.startsWith('--max-batches=')) {
      args.maxBatches = parsePositiveInteger(argument.slice('--max-batches='.length), '--max-batches')
      continue
    }

    if (argument === '--help' || argument === '-h') {
      printUsage()
      process.exit(0)
    }

    throw new Error(`Unknown argument: ${argument}`)
  }

  return args
}

function printUsage() {
  console.log(`
Backfill personal_record_sources from existing Strava runs.

Usage:
  npx tsx scripts/backfill-personal-record-sources-from-runs.ts
  npx tsx scripts/backfill-personal-record-sources-from-runs.ts --batch-size=200
  npx tsx scripts/backfill-personal-record-sources-from-runs.ts --dry-run --max-batches=5

Environment variables:
  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`)
}

function toPositiveInteger(value: unknown) {
  const normalizedValue = Number(value)

  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return null
  }

  return Math.round(normalizedValue)
}

function toSupportedDistance(value: unknown): SupportedDistance | null {
  const normalizedValue = toPositiveInteger(value)
  return normalizedValue && SUPPORTED_DISTANCES.includes(normalizedValue as SupportedDistance)
    ? normalizedValue as SupportedDistance
    : null
}

function toIsoDateValue(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return null
  }

  return parsedDate.toISOString().slice(0, 10)
}

function normalizeBestEffortName(value: unknown) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
    : ''
}

function resolveSupportedBestEffortDistance(bestEffort: Record<string, unknown>): SupportedDistance | null {
  const exactDistance = toSupportedDistance(bestEffort.distance)

  if (exactDistance) {
    return exactDistance
  }

  const normalizedName = normalizeBestEffortName(bestEffort.name)

  if (!normalizedName) {
    return null
  }

  if (normalizedName === '5k' || normalizedName === '5km' || normalizedName === '5000') {
    return 5000
  }

  if (normalizedName === '10k' || normalizedName === '10km' || normalizedName === '10000') {
    return 10000
  }

  if (
    normalizedName === 'halfmarathon'
    || normalizedName === '21k'
    || normalizedName === '21km'
    || normalizedName === '211km'
    || normalizedName === '21097'
    || normalizedName === '210975'
    || normalizedName === '21097km'
  ) {
    return 21097
  }

  if (
    normalizedName === 'marathon'
    || normalizedName === '42k'
    || normalizedName === '42km'
    || normalizedName === '422km'
    || normalizedName === '42195'
    || normalizedName === '421950'
    || normalizedName === '42195km'
  ) {
    return 42195
  }

  return null
}

function isDistanceWithinStravaFullRunFallbackWindow(value: unknown, distanceMeters: 21097 | 42195) {
  const normalizedValue = Number(value)

  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return false
  }

  if (distanceMeters === 21097) {
    return normalizedValue >= 20597 && normalizedValue <= 21597
  }

  return normalizedValue >= 42000 && normalizedValue <= 43000
}

function buildBestEffortMetadata(bestEffort: Record<string, unknown>) {
  const metadataEntries = Object.entries({
    name: typeof bestEffort.name === 'string' && bestEffort.name.trim() ? bestEffort.name.trim() : null,
    pr_rank: toPositiveInteger(bestEffort.pr_rank),
    elapsed_time: toPositiveInteger(bestEffort.elapsed_time),
    moving_time: toPositiveInteger(bestEffort.moving_time),
    start_index: toPositiveInteger(bestEffort.start_index),
    end_index: toPositiveInteger(bestEffort.end_index),
  }).filter(([, metadataValue]) => metadataValue !== null)

  return metadataEntries.length > 0 ? Object.fromEntries(metadataEntries) : null
}

function extractStravaPersonalRecordCandidatesForBackfill(
  rawStravaPayload: unknown,
  run: Pick<RunRow, 'distance_meters' | 'moving_time_seconds' | 'created_at' | 'external_id'>
): PersonalRecordCandidate[] {
  const payloadRecord = asRecord(rawStravaPayload)
  const bestEfforts = Array.isArray(payloadRecord?.best_efforts) ? payloadRecord.best_efforts : []
  const candidatesByDistance = new Map<SupportedDistance, PersonalRecordCandidate>()

  for (const bestEffortValue of bestEfforts) {
    const bestEffort = asRecord(bestEffortValue)

    if (!bestEffort) {
      continue
    }

    const distanceMeters = resolveSupportedBestEffortDistance(bestEffort)
    const durationSeconds = toPositiveInteger(bestEffort.elapsed_time ?? bestEffort.moving_time)

    if (!distanceMeters || !durationSeconds) {
      continue
    }

    const activityRecord = asRecord(bestEffort.activity)
    const candidate: PersonalRecordCandidate = {
      distance_meters: distanceMeters,
      duration_seconds: durationSeconds,
      pace_seconds_per_km: Math.round(durationSeconds / (distanceMeters / 1000)),
      record_date: (
        toIsoDateValue(bestEffort.start_date)
        ?? toIsoDateValue(bestEffort.start_date_local)
        ?? toIsoDateValue(payloadRecord?.start_date)
        ?? toIsoDateValue(payloadRecord?.start_date_local)
        ?? toIsoDateValue(run.created_at)
      ),
      strava_activity_id: toPositiveInteger(activityRecord?.id ?? bestEffort.activity_id ?? payloadRecord?.id ?? run.external_id),
      source: 'strava_best_effort',
      metadata: buildBestEffortMetadata(bestEffort),
    }

    const existingCandidate = candidatesByDistance.get(distanceMeters)

    if (!existingCandidate || candidate.duration_seconds < existingCandidate.duration_seconds) {
      candidatesByDistance.set(distanceMeters, candidate)
    }
  }

  const fullRunDurationSeconds = toPositiveInteger(
    payloadRecord?.moving_time
    ?? payloadRecord?.elapsed_time
    ?? payloadRecord?.moving_time_seconds
    ?? payloadRecord?.elapsed_time_seconds
    ?? run.moving_time_seconds
  )
  const fullRunDistance = payloadRecord?.distance ?? payloadRecord?.distance_meters ?? run.distance_meters
  const fullRunActivityId = toPositiveInteger(payloadRecord?.id ?? run.external_id)
  const fullRunRecordDate =
    toIsoDateValue(payloadRecord?.start_date)
    ?? toIsoDateValue(payloadRecord?.start_date_local)
    ?? toIsoDateValue(run.created_at)

  for (const distanceMeters of [21097, 42195] as const) {
    if (
      candidatesByDistance.has(distanceMeters)
      || !isDistanceWithinStravaFullRunFallbackWindow(fullRunDistance, distanceMeters)
      || !fullRunDurationSeconds
    ) {
      continue
    }

    candidatesByDistance.set(distanceMeters, {
      distance_meters: distanceMeters,
      duration_seconds: fullRunDurationSeconds,
      pace_seconds_per_km: Math.round(fullRunDurationSeconds / (distanceMeters / 1000)),
      record_date: fullRunRecordDate,
      strava_activity_id: fullRunActivityId,
      source: 'strava_best_effort',
      metadata: null,
    })
  }

  return SUPPORTED_DISTANCES
    .map((distanceMeters) => candidatesByDistance.get(distanceMeters) ?? null)
    .filter((candidate): candidate is PersonalRecordCandidate => candidate !== null)
}

function buildRunsCursorFilter(cursor: Cursor | null) {
  if (!cursor) {
    return null
  }

  return `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.runId})`
}

function matchSupportedDistanceFromRunDistance(value: unknown): SupportedDistance | null {
  const distanceMeters = Number(value)

  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return null
  }

  for (const supportedDistance of SUPPORTED_DISTANCES) {
    if (Math.abs(distanceMeters - supportedDistance) <= FULL_RUN_DISTANCE_TOLERANCES[supportedDistance]) {
      return supportedDistance
    }
  }

  return null
}

function buildFallbackCandidate(run: RunRow): PersonalRecordCandidate | null {
  const distanceMeters = matchSupportedDistanceFromRunDistance(run.distance_meters)
  const durationSeconds = toPositiveInteger(run.moving_time_seconds)

  if (!distanceMeters || !durationSeconds) {
    return null
  }

  const externalActivityId = toPositiveInteger(run.external_id)

  return {
    distance_meters: distanceMeters,
    duration_seconds: durationSeconds,
    pace_seconds_per_km: Math.round(durationSeconds / (distanceMeters / 1000)),
    record_date: toIsoDateValue(run.created_at),
    strava_activity_id: externalActivityId,
    source: 'strava_best_effort',
    metadata: {
      backfill_strategy: 'run_metrics_fallback',
    },
  }
}

async function fetchRunBatch(
  supabase: SupabaseClient,
  batchSize: number,
  cursor: Cursor | null
) {
  let query = supabase
    .from('runs')
    .select('id, user_id, external_id, created_at, distance_meters, moving_time_seconds, raw_strava_payload')
    .eq('external_source', STRAVA_EXTERNAL_SOURCE)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(batchSize)

  const cursorFilter = buildRunsCursorFilter(cursor)
  if (cursorFilter) {
    query = query.or(cursorFilter)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return (data as RunRow[] | null) ?? []
}

async function upsertPersonalRecordSource(
  supabase: SupabaseClient,
  run: RunRow,
  candidate: PersonalRecordCandidate
) {
  const fallbackStravaActivityId = toPositiveInteger(run.external_id)
  const fallbackRecordDate = toIsoDateValue(run.created_at)

  const { data, error } = await supabase.rpc('upsert_personal_record_if_better', {
    p_user_id: run.user_id,
    p_distance_meters: candidate.distance_meters,
    p_duration_seconds: candidate.duration_seconds,
    p_pace_seconds_per_km: candidate.pace_seconds_per_km,
    p_run_id: run.id,
    p_strava_activity_id: candidate.strava_activity_id ?? fallbackStravaActivityId,
    p_record_date: (candidate.record_date ?? fallbackRecordDate)
      ? `${candidate.record_date ?? fallbackRecordDate}T00:00:00.000Z`
      : null,
    p_source: candidate.source,
    p_metadata: candidate.metadata,
  })

  if (error) {
    throw new Error(error.message)
  }

  return Boolean(data)
}

function createTotals(): Totals {
  return {
    scannedRuns: 0,
    skippedRuns: 0,
    extractedCandidates: 0,
    fallbackCandidates: 0,
    checkedCandidates: 0,
    updatedCandidates: 0,
    failedRuns: 0,
    batches: 0,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const supabase = createSupabaseAdminClient()
  const startedAt = Date.now()
  const totals = createTotals()
  let cursor: Cursor | null = null
  let batchNumber = 0

  console.log('Starting personal_record_sources backfill from runs', {
    batchSize: args.batchSize,
    maxBatches: args.maxBatches,
    dryRun: args.dryRun,
    distances: SUPPORTED_DISTANCES,
    externalSource: STRAVA_EXTERNAL_SOURCE,
  })

  for (;;) {
    if (args.maxBatches !== null && batchNumber >= args.maxBatches) {
      console.log('Stopped due to --max-batches limit', {
        maxBatches: args.maxBatches,
      })
      break
    }

    const runs = await fetchRunBatch(supabase, args.batchSize, cursor)

    if (runs.length === 0) {
      console.log('No more runs to process.')
      break
    }

    batchNumber += 1
    totals.batches += 1
    let batchUpdatedCandidates = 0
    let batchCheckedCandidates = 0
    let batchFailedRuns = 0
    let batchSkippedRuns = 0
    let batchExtractedCandidates = 0
    let batchFallbackCandidates = 0

    for (const run of runs) {
      totals.scannedRuns += 1
      cursor = {
        createdAt: run.created_at,
        runId: run.id,
      }

      if (!run.user_id) {
        totals.skippedRuns += 1
        batchSkippedRuns += 1
        continue
      }

      try {
        const extractedCandidates = extractStravaPersonalRecordCandidatesForBackfill(run.raw_strava_payload, run)

        const candidates = extractedCandidates.length > 0
          ? extractedCandidates
          : (() => {
              const fallbackCandidate = buildFallbackCandidate(run)
              return fallbackCandidate ? [fallbackCandidate] : []
            })()

        batchExtractedCandidates += extractedCandidates.length
        totals.extractedCandidates += extractedCandidates.length

        if (extractedCandidates.length === 0 && candidates.length > 0) {
          batchFallbackCandidates += candidates.length
          totals.fallbackCandidates += candidates.length
        }

        if (candidates.length === 0) {
          totals.skippedRuns += 1
          batchSkippedRuns += 1
          continue
        }

        for (const candidate of candidates) {
          totals.checkedCandidates += 1
          batchCheckedCandidates += 1

          if (args.dryRun) {
            continue
          }

          const updated = await upsertPersonalRecordSource(supabase, run, candidate)

          if (updated) {
            totals.updatedCandidates += 1
            batchUpdatedCandidates += 1
          }
        }
      } catch (error) {
        totals.failedRuns += 1
        batchFailedRuns += 1
        console.error('Failed processing run', {
          runId: run.id,
          userId: run.user_id,
          error: error instanceof Error ? error.message : 'unknown_error',
        })
      }
    }

    console.log('Batch complete', {
      batchNumber,
      runsInBatch: runs.length,
      scannedRunsSoFar: totals.scannedRuns,
      batchCheckedCandidates,
      batchUpdatedCandidates,
      batchExtractedCandidates,
      batchFallbackCandidates,
      batchSkippedRuns,
      batchFailedRuns,
      lastCursor: cursor,
    })
  }

  console.log('Backfill complete', {
    ...totals,
    elapsedMs: Date.now() - startedAt,
  })
}

main().catch((error) => {
  console.error('Personal record sources backfill failed', {
    error: error instanceof Error ? error.message : 'unknown_error',
  })
  process.exitCode = 1
})
