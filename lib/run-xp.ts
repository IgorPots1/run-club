import 'server-only'

import { createSupabaseAdminClient } from './supabase-admin'
import {
  applyDailyXpCap,
  loadDailyXpUsage,
  MIN_RUN_DISTANCE_KM_FOR_XP,
  RUN_XP_FREQUENCY_WINDOW_MS,
} from './xp-anti-abuse'
import { buildRunXpBreakdown, capXpBreakdownItems } from './xp'

const RUN_WORKOUT_XP = 50
const RUN_DISTANCE_XP_PER_KM = 10
const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

type CalculateRunXpOptions = {
  userId: string
  createdAt: string
  distanceKm: number
  supabase?: ReturnType<typeof createSupabaseAdminClient>
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
  supabase = createSupabaseAdminClient(),
}: CalculateRunXpOptions) {
  const createdAtDate = new Date(createdAt)

  if (Number.isNaN(createdAtDate.getTime())) {
    throw new Error('invalid_run_created_at')
  }

  const normalizedDistanceKm = Number.isFinite(distanceKm) ? Math.max(0, Number(distanceKm)) : 0
  const normalizedCreatedAt = createdAtDate.toISOString()
  const workoutXp = RUN_WORKOUT_XP
  const distanceXp = Math.max(0, Math.round(normalizedDistanceKm * RUN_DISTANCE_XP_PER_KM))

  if (normalizedDistanceKm < MIN_RUN_DISTANCE_KM_FOR_XP) {
    return {
      xp: 0,
      workoutXp,
      distanceXp,
      weeklyConsistencyBonus: 0,
      runCountLast7Days: 0,
      breakdown: [],
    }
  }

  const runFrequencyWindowStart = new Date(
    createdAtDate.getTime() - RUN_XP_FREQUENCY_WINDOW_MS
  ).toISOString()
  const { count: recentRunCount, error: recentRunsError } = await supabase
    .from('runs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', runFrequencyWindowStart)
    .lte('created_at', normalizedCreatedAt)

  if (recentRunsError) {
    throw recentRunsError
  }

  if (Number(recentRunCount ?? 0) > 0) {
    return {
      xp: 0,
      workoutXp,
      distanceXp,
      weeklyConsistencyBonus: 0,
      runCountLast7Days: 0,
      breakdown: [],
    }
  }

  const windowStart = new Date(createdAtDate.getTime() - WEEKLY_WINDOW_MS).toISOString()

  const { count, error } = await supabase
    .from('runs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', windowStart)
    .lte('created_at', normalizedCreatedAt)

  if (error) {
    throw error
  }

  const existingRunCount = Number(count ?? 0)
  const runCountLast7Days = existingRunCount + 1
  const weeklyConsistencyBonus = getWeeklyConsistencyBonus(runCountLast7Days)
  const rawXp = workoutXp + distanceXp + weeklyConsistencyBonus
  const dailyXpUsage = await loadDailyXpUsage({
    userId,
    timestamp: normalizedCreatedAt,
    supabase,
  })
  const { xpGained } = applyDailyXpCap(rawXp, dailyXpUsage.totalXp)
  const xp = Math.max(0, xpGained)

  return {
    xp,
    workoutXp,
    distanceXp,
    weeklyConsistencyBonus,
    runCountLast7Days,
    breakdown: capXpBreakdownItems(
      buildRunXpBreakdown({
        workoutXp,
        distanceXp,
        weeklyConsistencyBonus,
      }),
      xp
    ),
  }
}
