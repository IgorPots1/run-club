import { createClient } from '@supabase/supabase-js'

import { upsertPersonalRecordsForDistancesFromStravaPayload } from '@/lib/personal-records-backfill-shared'
import { recomputePersonalRecordForUserDistance } from '@/lib/personal-records-recompute'

const SUPPORTED_DISTANCES = [5000, 10000, 21097, 42195] as const
const RUN_PAGE_SIZE = 1000

async function main() {
  const userIdArg = process.argv
    .slice(2)
    .find((arg) => arg.startsWith('--user-id='))

  const userId = userIdArg?.slice('--user-id='.length).trim() ?? ''

  if (!userId) {
    console.error('Missing required argument: --user-id=<uuid>')
    console.error(
      'Usage: npx tsx --env-file=.env.local scripts/repair-pr-missing-sources.ts --user-id=<uuid>'
    )
    process.exitCode = 1
    return
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('Missing required environment variable: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL')
  }

  if (!serviceRoleKey) {
    throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  console.log('Step 1/6: Starting targeted PR repair', {
    userId,
    distances: SUPPORTED_DISTANCES,
  })

  console.log('Step 2/6: Reading before-state counts')
  const { data: beforeSources, error: beforeSourcesError } = await supabase
    .from('personal_record_sources')
    .select('distance_meters')
    .eq('user_id', userId)
    .in('distance_meters', [...SUPPORTED_DISTANCES])

  if (beforeSourcesError) {
    throw new Error(`Failed loading before personal_record_sources: ${beforeSourcesError.message}`)
  }

  const { data: beforeCanonical, error: beforeCanonicalError } = await supabase
    .from('personal_records')
    .select('distance_meters')
    .eq('user_id', userId)
    .in('distance_meters', [...SUPPORTED_DISTANCES])

  if (beforeCanonicalError) {
    throw new Error(`Failed loading before personal_records: ${beforeCanonicalError.message}`)
  }

  console.log('Before-state loaded', {
    sourceRows: (beforeSources ?? []).length,
    canonicalRows: (beforeCanonical ?? []).length,
  })

  console.log('Step 3/6: Fetching Strava runs for user')
  const runs: Array<{
    id: string
    created_at: string
    external_id: string | null
    distance_meters: number | null
    moving_time_seconds: number | null
    raw_strava_payload: unknown
  }> = []

  for (let offset = 0; ; offset += RUN_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('runs')
      .select('id, created_at, external_id, distance_meters, moving_time_seconds, raw_strava_payload')
      .eq('user_id', userId)
      .eq('external_source', 'strava')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + RUN_PAGE_SIZE - 1)

    if (error) {
      throw new Error(`Failed loading runs: ${error.message}`)
    }

    const page = (data ?? []) as typeof runs
    runs.push(...page)

    console.log('Fetched run page', {
      offset,
      pageSize: page.length,
      totalRunsSoFar: runs.length,
    })

    if (page.length < RUN_PAGE_SIZE) {
      break
    }
  }

  console.log('Step 4/6: Rebuilding personal_record_sources from runs', {
    runCount: runs.length,
  })

  let checkedCandidates = 0
  let updatedSources = 0

  for (const run of runs) {
    const result = await upsertPersonalRecordsForDistancesFromStravaPayload({
      supabase,
      userId,
      runId: run.id,
      rawStravaPayload: run.raw_strava_payload,
      distanceMeters: [...SUPPORTED_DISTANCES],
      fallbackRecordDate: run.created_at,
      fallbackStravaActivityId: run.external_id,
      fallbackDistanceMeters: run.distance_meters,
      fallbackMovingTimeSeconds: run.moving_time_seconds,
    })

    checkedCandidates += result.checked
    updatedSources += result.updated

    console.log('Processed run for PR source rebuild', {
      runId: run.id,
      checked: result.checked,
      updated: result.updated,
      checkedCandidatesSoFar: checkedCandidates,
      updatedSourcesSoFar: updatedSources,
    })
  }

  console.log('Step 5/6: Recomputing canonical personal_records')
  for (const distanceMeters of SUPPORTED_DISTANCES) {
    const recomputeResult = await recomputePersonalRecordForUserDistance({
      supabase,
      userId,
      distanceMeters,
    })

    console.log('Recomputed canonical personal record', {
      distanceMeters,
      updated: recomputeResult.updated,
      deleted: recomputeResult.deleted,
    })
  }

  console.log('Step 6/6: Reading after-state counts')
  const { data: afterSources, error: afterSourcesError } = await supabase
    .from('personal_record_sources')
    .select('distance_meters')
    .eq('user_id', userId)
    .in('distance_meters', [...SUPPORTED_DISTANCES])

  if (afterSourcesError) {
    throw new Error(`Failed loading after personal_record_sources: ${afterSourcesError.message}`)
  }

  const { data: afterCanonical, error: afterCanonicalError } = await supabase
    .from('personal_records')
    .select('distance_meters')
    .eq('user_id', userId)
    .in('distance_meters', [...SUPPORTED_DISTANCES])

  if (afterCanonicalError) {
    throw new Error(`Failed loading after personal_records: ${afterCanonicalError.message}`)
  }

  const beforeSourceCountByDistance = new Map<number, number>()
  const afterSourceCountByDistance = new Map<number, number>()
  const beforeCanonicalSet = new Set<number>()
  const afterCanonicalSet = new Set<number>()

  for (const row of (beforeSources ?? []) as Array<{ distance_meters: number | string }>) {
    const distance = Number(row.distance_meters)
    beforeSourceCountByDistance.set(distance, (beforeSourceCountByDistance.get(distance) ?? 0) + 1)
  }

  for (const row of (afterSources ?? []) as Array<{ distance_meters: number | string }>) {
    const distance = Number(row.distance_meters)
    afterSourceCountByDistance.set(distance, (afterSourceCountByDistance.get(distance) ?? 0) + 1)
  }

  for (const row of (beforeCanonical ?? []) as Array<{ distance_meters: number | string }>) {
    beforeCanonicalSet.add(Number(row.distance_meters))
  }

  for (const row of (afterCanonical ?? []) as Array<{ distance_meters: number | string }>) {
    afterCanonicalSet.add(Number(row.distance_meters))
  }

  let sourcesCreated = 0
  let canonicalCreated = 0
  const distancesFixed: number[] = []

  for (const distance of SUPPORTED_DISTANCES) {
    const beforeCount = beforeSourceCountByDistance.get(distance) ?? 0
    const afterCount = afterSourceCountByDistance.get(distance) ?? 0
    const delta = Math.max(0, afterCount - beforeCount)
    sourcesCreated += delta

    const wasCanonicalMissing = !beforeCanonicalSet.has(distance)
    const isCanonicalPresent = afterCanonicalSet.has(distance)
    const createdCanonicalForDistance = wasCanonicalMissing && isCanonicalPresent

    if (createdCanonicalForDistance) {
      canonicalCreated += 1
    }

    if (delta > 0 || createdCanonicalForDistance) {
      distancesFixed.push(distance)
    }
  }

  console.log('Repair complete', {
    userId,
    runs_scanned: runs.length,
    qualifying_candidates_checked: checkedCandidates,
    sources_created: sourcesCreated,
    canonical_created: canonicalCreated,
    distances_fixed: distancesFixed,
  })
}

main().catch((error) => {
  console.error('Repair failed', {
    error: error instanceof Error ? error.message : 'unknown_error',
  })
  process.exitCode = 1
})
