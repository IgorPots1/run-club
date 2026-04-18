import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { upsertPersonalRecordsForDistancesFromStravaPayload } from '@/lib/personal-records-backfill-shared'
import {
  recomputePersonalRecordForUserDistance,
  type SupportedPersonalRecordDistance,
} from '@/lib/personal-records-recompute'

const TARGET_USER_IDS = [
  '17af0c01-f905-484f-bbe8-21ba7c5b01f8',
  '1dc201b2-68e9-4b44-b589-07d14df3e292',
  '4cec94f8-20a3-4dc2-b17b-3704482d5cc6',
  '4d802baf-bdbe-4d78-9e2b-10ee52ac9e93',
  '4e0c833f-ef5a-4f80-90f6-2602071351bc',
  '6ed2baad-5f9b-4610-ad0d-286d9bc462cb',
] as const

const SUPPORTED_DISTANCES: SupportedPersonalRecordDistance[] = [5000, 10000, 21097, 42195]
const STRAVA_EXTERNAL_SOURCE = 'strava'
const RUN_PAGE_SIZE = 1000

type ScriptArgs = {
  userIds: string[]
  help: boolean
}

type RunRow = {
  id: string
  created_at: string
  external_id: string | null
  distance_meters: number | null
  moving_time_seconds: number | null
  raw_strava_payload: unknown
}

type UserDistanceSnapshot = {
  sourceCountsByDistance: Map<SupportedPersonalRecordDistance, number>
  canonicalDistances: Set<SupportedPersonalRecordDistance>
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

function parseCsvUserIds(value: string) {
  const uniqueIds = new Set<string>()
  for (const entry of value.split(',')) {
    const normalized = entry.trim()
    if (normalized) {
      uniqueIds.add(normalized)
    }
  }
  return [...uniqueIds]
}

function parseArgs(argv: string[]): ScriptArgs {
  const args: ScriptArgs = {
    userIds: [...TARGET_USER_IDS],
    help: false,
  }

  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') {
      args.help = true
      continue
    }

    if (argument.startsWith('--user-ids=')) {
      args.userIds = parseCsvUserIds(argument.slice('--user-ids='.length))
      continue
    }

    throw new Error(`Unknown argument: ${argument}`)
  }

  if (args.userIds.length === 0) {
    throw new Error('No target users provided. Use --user-ids=<uuid,uuid,...>')
  }

  return args
}

function printUsage() {
  console.log(`
Repair missing personal_record_sources and canonical personal_records for targeted users.

Usage:
  npx tsx --env-file=.env.local scripts/repair-targeted-missing-personal-record-sources.ts
  npx tsx --env-file=.env.local scripts/repair-targeted-missing-personal-record-sources.ts --user-ids=<uuid,uuid,...>

Environment variables:
  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`)
}

function toSupportedDistance(value: unknown): SupportedPersonalRecordDistance | null {
  const normalized = Number(value)
  if (
    Number.isFinite(normalized)
    && (normalized === 5000 || normalized === 10000 || normalized === 21097 || normalized === 42195)
  ) {
    return normalized
  }
  return null
}

async function fetchAllUserStravaRuns(supabase: SupabaseClient, userId: string) {
  const runs: RunRow[] = []

  for (let offset = 0; ; offset += RUN_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('runs')
      .select('id, created_at, external_id, distance_meters, moving_time_seconds, raw_strava_payload')
      .eq('user_id', userId)
      .eq('external_source', STRAVA_EXTERNAL_SOURCE)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + RUN_PAGE_SIZE - 1)

    if (error) {
      throw new Error(error.message)
    }

    const page = (data as RunRow[] | null) ?? []
    runs.push(...page)

    if (page.length < RUN_PAGE_SIZE) {
      break
    }
  }

  return runs
}

async function loadUserDistanceSnapshot(supabase: SupabaseClient, userId: string): Promise<UserDistanceSnapshot> {
  const sourceCountsByDistance = new Map<SupportedPersonalRecordDistance, number>(
    SUPPORTED_DISTANCES.map((distance) => [distance, 0])
  )

  const { data: sourceRows, error: sourceError } = await supabase
    .from('personal_record_sources')
    .select('distance_meters')
    .eq('user_id', userId)
    .in('distance_meters', SUPPORTED_DISTANCES)

  if (sourceError) {
    throw new Error(sourceError.message)
  }

  for (const sourceRow of (sourceRows ?? []) as Array<{ distance_meters: number | string }>) {
    const distance = toSupportedDistance(sourceRow.distance_meters)
    if (!distance) {
      continue
    }

    sourceCountsByDistance.set(distance, (sourceCountsByDistance.get(distance) ?? 0) + 1)
  }

  const canonicalDistances = new Set<SupportedPersonalRecordDistance>()
  const { data: canonicalRows, error: canonicalError } = await supabase
    .from('personal_records')
    .select('distance_meters')
    .eq('user_id', userId)
    .in('distance_meters', SUPPORTED_DISTANCES)

  if (canonicalError) {
    throw new Error(canonicalError.message)
  }

  for (const canonicalRow of (canonicalRows ?? []) as Array<{ distance_meters: number | string }>) {
    const distance = toSupportedDistance(canonicalRow.distance_meters)
    if (distance) {
      canonicalDistances.add(distance)
    }
  }

  return {
    sourceCountsByDistance,
    canonicalDistances,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printUsage()
    return
  }

  process.env.NEXT_PUBLIC_SUPABASE_URL ??= process.env.SUPABASE_URL
  const supabase = createSupabaseAdminClient()

  console.log('Starting targeted PR rebuild repair', {
    userCount: args.userIds.length,
    userIds: args.userIds,
    distances: SUPPORTED_DISTANCES,
    externalSource: STRAVA_EXTERNAL_SOURCE,
  })

  for (const userId of args.userIds) {
    const beforeSnapshot = await loadUserDistanceSnapshot(supabase, userId)
    const runs = await fetchAllUserStravaRuns(supabase, userId)

    let checkedCandidates = 0
    let sourcesUpdated = 0

    for (const run of runs) {
      const upsertResult = await upsertPersonalRecordsForDistancesFromStravaPayload({
        supabase,
        userId,
        runId: run.id,
        rawStravaPayload: run.raw_strava_payload,
        distanceMeters: SUPPORTED_DISTANCES,
        fallbackRecordDate: run.created_at,
        fallbackStravaActivityId: run.external_id,
        fallbackDistanceMeters: run.distance_meters,
        fallbackMovingTimeSeconds: run.moving_time_seconds,
      })

      checkedCandidates += upsertResult.checked
      sourcesUpdated += upsertResult.updated
    }

    for (const distanceMeters of SUPPORTED_DISTANCES) {
      await recomputePersonalRecordForUserDistance({
        supabase,
        userId,
        distanceMeters,
      })
    }

    const afterSnapshot = await loadUserDistanceSnapshot(supabase, userId)
    const sourceDeltasByDistance = new Map<SupportedPersonalRecordDistance, number>()
    const canonicalCreatedDistances = new Set<SupportedPersonalRecordDistance>()
    const distancesFixed: SupportedPersonalRecordDistance[] = []
    let sourcesCreated = 0
    let canonicalCreated = 0

    for (const distanceMeters of SUPPORTED_DISTANCES) {
      const beforeSourceCount = beforeSnapshot.sourceCountsByDistance.get(distanceMeters) ?? 0
      const afterSourceCount = afterSnapshot.sourceCountsByDistance.get(distanceMeters) ?? 0
      const sourceDelta = Math.max(0, afterSourceCount - beforeSourceCount)
      sourceDeltasByDistance.set(distanceMeters, sourceDelta)
      sourcesCreated += sourceDelta

      const wasCanonicalMissing = !beforeSnapshot.canonicalDistances.has(distanceMeters)
      const isCanonicalPresent = afterSnapshot.canonicalDistances.has(distanceMeters)
      if (wasCanonicalMissing && isCanonicalPresent) {
        canonicalCreated += 1
        canonicalCreatedDistances.add(distanceMeters)
      }

      if (sourceDelta > 0 || canonicalCreatedDistances.has(distanceMeters)) {
        distancesFixed.push(distanceMeters)
      }
    }

    console.log('Targeted PR rebuild result', {
      userId,
      runs_scanned: runs.length,
      qualifying_candidates_checked: checkedCandidates,
      sources_updated: sourcesUpdated,
      sources_created: sourcesCreated,
      canonical_created: canonicalCreated,
      distances_fixed: distancesFixed,
      source_deltas_by_distance: Object.fromEntries(
        [...sourceDeltasByDistance.entries()].map(([distance, delta]) => [String(distance), delta])
      ),
      canonical_created_distances: [...canonicalCreatedDistances],
    })
  }

  console.log('Targeted PR rebuild repair complete', {
    userCount: args.userIds.length,
  })
}

main().catch((error) => {
  console.error('Targeted PR rebuild repair failed', {
    error: error instanceof Error ? error.message : 'unknown_error',
  })
  process.exitCode = 1
})
