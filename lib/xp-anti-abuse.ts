import 'server-only'

import { createSupabaseAdminClient } from './supabase-admin'

export const MIN_RUN_DISTANCE_KM_FOR_XP = 1
export const DAILY_XP_CAP = 250
export const XP_PER_LIKE = 5
export const MAX_LIKES_WITH_XP_PER_DAY = 10
export const RUN_XP_FREQUENCY_WINDOW_MS = 10 * 60 * 1000

type LoadDailyXpUsageOptions = {
  userId: string
  timestamp: string
  excludeRunId?: string
  supabase?: ReturnType<typeof createSupabaseAdminClient>
}

type DailyXpUsageRpcResult = {
  runXp?: number | null
  challengeXp?: number | null
  receivedLikesCount?: number | null
} | null

export function getUtcDayBounds(timestamp: string) {
  const date = new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    throw new Error('invalid_xp_timestamp')
  }

  const start = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0,
    0,
    0,
    0
  ))
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  }
}

export function applyDailyXpCap(rawXp: number, currentDailyXp: number) {
  const normalizedRawXp = Number.isFinite(rawXp) ? Math.max(0, Math.round(rawXp)) : 0
  const normalizedCurrentDailyXp = Number.isFinite(currentDailyXp)
    ? Math.max(0, Math.round(currentDailyXp))
    : 0
  const remainingXp = Math.max(0, DAILY_XP_CAP - normalizedCurrentDailyXp)
  const xpGained = Math.min(normalizedRawXp, remainingXp)

  return {
    xpGained,
    remainingXp,
  }
}

export async function loadDailyXpUsage({
  userId,
  timestamp,
  excludeRunId,
  supabase = createSupabaseAdminClient(),
}: LoadDailyXpUsageOptions) {
  const { startIso, endIso } = getUtcDayBounds(timestamp)
  let runXp = 0
  let challengeXp = 0
  let normalizedReceivedLikesCount = 0

  if (excludeRunId) {
    let runXpQuery = supabase
      .from('runs')
      .select('xp')
      .eq('user_id', userId)
      .gte('created_at', startIso)
      .lt('created_at', endIso)

    runXpQuery = runXpQuery.neq('id', excludeRunId)

    const [
      { data: runRows, error: runError },
      { data: challengeRows, error: challengeError },
      { count: receivedLikesCount, error: likesError },
    ] = await Promise.all([
      runXpQuery,
      supabase
        .from('user_challenges')
        .select('challenges!inner(xp_reward)')
        .eq('user_id', userId)
        .gte('completed_at', startIso)
        .lt('completed_at', endIso),
      supabase
        .from('run_likes')
        .select('id', { count: 'exact', head: true })
        .eq('run_owner_user_id', userId)
        .gt('xp_awarded', 0)
        .gte('created_at', startIso)
        .lt('created_at', endIso),
    ])

    if (runError) {
      throw runError
    }

    if (challengeError) {
      throw challengeError
    }

    if (likesError) {
      throw likesError
    }

    runXp = Math.max(
      0,
      Math.round(
        ((runRows as Array<{ xp?: number | null }> | null) ?? []).reduce(
          (sum, row) => sum + Math.max(0, Math.round(Number(row.xp ?? 0))),
          0
        )
      )
    )

    challengeXp = Math.max(
      0,
      Math.round(
        ((challengeRows as Array<{ challenges?: { xp_reward?: number | null } | null }> | null) ?? []).reduce(
          (sum, row) => sum + Math.max(0, Math.round(Number(row.challenges?.xp_reward ?? 0))),
          0
        )
      )
    )

    normalizedReceivedLikesCount = Math.max(0, Math.round(Number(receivedLikesCount ?? 0)))
  } else {
    const { data, error } = await supabase.rpc('get_daily_xp_usage', {
      p_user_id: userId,
      p_start: startIso,
      p_end: endIso,
    })

    if (error) {
      throw error
    }

    const dailyUsage = (data as DailyXpUsageRpcResult) ?? null
    runXp = Math.max(0, Math.round(Number(dailyUsage?.runXp ?? 0)))
    challengeXp = Math.max(0, Math.round(Number(dailyUsage?.challengeXp ?? 0)))
    normalizedReceivedLikesCount = Math.max(0, Math.round(Number(dailyUsage?.receivedLikesCount ?? 0)))
  }

  const likeXp = Math.min(normalizedReceivedLikesCount, MAX_LIKES_WITH_XP_PER_DAY) * XP_PER_LIKE
  const uncappedTotalXp = runXp + challengeXp + likeXp
  const totalXp = Math.min(uncappedTotalXp, DAILY_XP_CAP)

  return {
    runXp,
    challengeXp,
    likeXp,
    uncappedTotalXp,
    totalXp,
    receivedLikesCount: normalizedReceivedLikesCount,
  }
}
