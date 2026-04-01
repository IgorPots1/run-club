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
  supabase?: ReturnType<typeof createSupabaseAdminClient>
}

type RunXpRow = {
  xp: number | null
}

type ChallengeXpRow = {
  challenges: {
    xp_reward: number | null
  } | {
    xp_reward: number | null
  }[] | null
}

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
  supabase = createSupabaseAdminClient(),
}: LoadDailyXpUsageOptions) {
  const { startIso, endIso } = getUtcDayBounds(timestamp)

  const [
    { data: runRows, error: runsError },
    { data: challengeRows, error: challengesError },
    { count: receivedLikesCount, error: likesError },
  ] = await Promise.all([
    supabase
      .from('runs')
      .select('xp')
      .eq('user_id', userId)
      .gte('created_at', startIso)
      .lt('created_at', endIso),
    supabase
      .from('user_challenges')
      .select('challenges!inner(xp_reward)')
      .eq('user_id', userId)
      .gte('completed_at', startIso)
      .lt('completed_at', endIso),
    supabase
      .from('run_likes')
      .select('run_id, runs!inner(user_id)', { count: 'exact', head: true })
      .eq('runs.user_id', userId)
      .gte('created_at', startIso)
      .lt('created_at', endIso),
  ])

  if (runsError) {
    throw runsError
  }

  if (challengesError) {
    throw challengesError
  }

  if (likesError) {
    throw likesError
  }

  const runXp = ((runRows as RunXpRow[] | null) ?? []).reduce(
    (sum, row) => sum + Math.max(0, Math.round(Number(row.xp ?? 0))),
    0
  )
  const challengeXp = ((challengeRows as ChallengeXpRow[] | null) ?? []).reduce(
    (sum, row) => {
      const challengeValue = Array.isArray(row.challenges)
        ? row.challenges[0]?.xp_reward
        : row.challenges?.xp_reward

      return sum + Math.max(0, Math.round(Number(challengeValue ?? 0)))
    },
    0
  )
  const normalizedReceivedLikesCount = Math.max(0, Number(receivedLikesCount ?? 0))
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
