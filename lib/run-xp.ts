import 'server-only'

import { createSupabaseAdminClient } from './supabase-admin'
import {
  applyDailyXpCap,
  loadDailyXpUsage,
  MIN_RUN_DISTANCE_KM_FOR_XP,
  RUN_XP_FREQUENCY_WINDOW_MS,
} from './xp-anti-abuse'
import { buildRunXpBreakdown, capXpBreakdownItems } from './xp'

const RUN_BASE_XP = 40
const FIRST_DISTANCE_TIER_LIMIT_KM = 10
const SECOND_DISTANCE_TIER_LIMIT_KM = 20
const FIRST_DISTANCE_TIER_XP_PER_KM = 9
const SECOND_DISTANCE_TIER_XP_PER_KM = 7
const THIRD_DISTANCE_TIER_XP_PER_KM = 5
const MIN_DISTANCE_KM_FOR_ELEVATION_XP = 3
const ELEVATION_METERS_PER_XP = 20
const MAX_ELEVATION_XP = 25
const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

type CalculateRunXpOptions = {
  userId: string
  createdAt: string
  distanceKm: number
  elevationGainMeters?: number | null
  externalSource?: string | null
  excludeRunId?: string
  supabase?: ReturnType<typeof createSupabaseAdminClient>
}

function calculateRunDistanceXp(distanceKm: number): number {
  const normalizedDistanceKm = Number.isFinite(distanceKm) ? Math.max(0, Number(distanceKm)) : 0
  const firstTierDistanceKm = Math.min(normalizedDistanceKm, FIRST_DISTANCE_TIER_LIMIT_KM)
  const secondTierDistanceKm = Math.min(
    Math.max(normalizedDistanceKm - FIRST_DISTANCE_TIER_LIMIT_KM, 0),
    SECOND_DISTANCE_TIER_LIMIT_KM - FIRST_DISTANCE_TIER_LIMIT_KM
  )
  const thirdTierDistanceKm = Math.max(normalizedDistanceKm - SECOND_DISTANCE_TIER_LIMIT_KM, 0)

  return Math.max(
    0,
    Math.round(
      (firstTierDistanceKm * FIRST_DISTANCE_TIER_XP_PER_KM)
        + (secondTierDistanceKm * SECOND_DISTANCE_TIER_XP_PER_KM)
        + (thirdTierDistanceKm * THIRD_DISTANCE_TIER_XP_PER_KM)
    )
  )
}

function getElevationXp({
  distanceKm,
  elevationGainMeters,
  externalSource,
}: {
  distanceKm: number
  elevationGainMeters?: number | null
  externalSource?: string | null
}): number {
  const normalizedDistanceKm = Number.isFinite(distanceKm) ? Math.max(0, Number(distanceKm)) : 0
  const normalizedElevationGainMeters = Number.isFinite(elevationGainMeters)
    ? Math.max(0, Math.floor(Number(elevationGainMeters)))
    : 0
  const normalizedExternalSource = externalSource?.trim() ?? ''
  const isTrustedImportedRun = normalizedExternalSource.length > 0

  if (!isTrustedImportedRun || normalizedDistanceKm < MIN_DISTANCE_KM_FOR_ELEVATION_XP) {
    return 0
  }

  return Math.min(
    Math.floor(normalizedElevationGainMeters / ELEVATION_METERS_PER_XP),
    MAX_ELEVATION_XP
  )
}

export function getWeeklyConsistencyBonus(runCountLast7Days: number): number {
  const normalizedRunCount = Number.isFinite(runCountLast7Days)
    ? Math.max(0, Math.round(runCountLast7Days))
    : 0

  if (normalizedRunCount >= 5) {
    return 50
  }

  if (normalizedRunCount >= 3) {
    return 30
  }

  if (normalizedRunCount >= 2) {
    return 15
  }

  return 0
}

export async function calculateRunXp({
  userId,
  createdAt,
  distanceKm,
  elevationGainMeters,
  externalSource,
  excludeRunId,
  supabase = createSupabaseAdminClient(),
}: CalculateRunXpOptions) {
  const createdAtDate = new Date(createdAt)

  if (Number.isNaN(createdAtDate.getTime())) {
    throw new Error('invalid_run_created_at')
  }

  const normalizedDistanceKm = Number.isFinite(distanceKm) ? Math.max(0, Number(distanceKm)) : 0
  const normalizedCreatedAt = createdAtDate.toISOString()
  const workoutXp = RUN_BASE_XP
  const distanceXp = calculateRunDistanceXp(normalizedDistanceKm)
  const elevationXp = getElevationXp({
    distanceKm: normalizedDistanceKm,
    elevationGainMeters,
    externalSource,
  })

  if (normalizedDistanceKm < MIN_RUN_DISTANCE_KM_FOR_XP) {
    return {
      xp: 0,
      workoutXp,
      distanceXp,
      elevationXp,
      weeklyConsistencyBonus: 0,
      runCountLast7Days: 0,
      breakdown: [],
    }
  }

  const runFrequencyWindowStart = new Date(
    createdAtDate.getTime() - RUN_XP_FREQUENCY_WINDOW_MS
  ).toISOString()
  let recentRunsQuery = supabase
    .from('runs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', runFrequencyWindowStart)
    .lte('created_at', normalizedCreatedAt)

  if (excludeRunId) {
    recentRunsQuery = recentRunsQuery.neq('id', excludeRunId)
  }

  const { count: recentRunCount, error: recentRunsError } = await recentRunsQuery

  if (recentRunsError) {
    throw recentRunsError
  }

  if (Number(recentRunCount ?? 0) > 0) {
    return {
      xp: 0,
      workoutXp,
      distanceXp,
      elevationXp,
      weeklyConsistencyBonus: 0,
      runCountLast7Days: 0,
      breakdown: [],
    }
  }

  const windowStart = new Date(createdAtDate.getTime() - WEEKLY_WINDOW_MS).toISOString()

  let weeklyRunsQuery = supabase
    .from('runs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', windowStart)
    .lte('created_at', normalizedCreatedAt)

  if (excludeRunId) {
    weeklyRunsQuery = weeklyRunsQuery.neq('id', excludeRunId)
  }

  const { count, error } = await weeklyRunsQuery

  if (error) {
    throw error
  }

  const existingRunCount = Number(count ?? 0)
  const runCountLast7Days = existingRunCount + 1
  const weeklyConsistencyBonus = getWeeklyConsistencyBonus(runCountLast7Days)
  const rawXp = workoutXp + distanceXp + elevationXp + weeklyConsistencyBonus
  const dailyXpUsage = await loadDailyXpUsage({
    userId,
    timestamp: normalizedCreatedAt,
    excludeRunId,
    supabase,
  })
  const { xpGained } = applyDailyXpCap(rawXp, dailyXpUsage.totalXp)
  const xp = Math.max(0, xpGained)

  return {
    xp,
    workoutXp,
    distanceXp,
    elevationXp,
    weeklyConsistencyBonus,
    runCountLast7Days,
    breakdown: capXpBreakdownItems(
      buildRunXpBreakdown({
        workoutXp,
        distanceXp,
        elevationXp,
        weeklyConsistencyBonus,
      }),
      xp
    ),
  }
}
