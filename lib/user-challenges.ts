import { supabase } from './supabase'
import type { XpBreakdownItem } from './xp'

type UserChallengeRow = {
  user_id: string
  challenge_id: string
  completed_at?: string | null
}

type ChallengeRewardRow = {
  id: string
  xp_reward: number | null
}

export type CompletedChallengeRecord = {
  challengeId: string
  completedAt: string | null
  xpAwarded: number
}

type ChallengeCompletionResult = {
  success: boolean
  duplicate: boolean
  xpGained: number
  breakdown: XpBreakdownItem[]
  levelUp: boolean
  newLevel: number | null
  error: unknown | null
}

async function loadChallengeRewardsById(challengeIds: string[]) {
  if (challengeIds.length === 0) {
    return {} as Record<string, number>
  }

  const { data, error } = await supabase
    .from('challenges')
    .select('id, xp_reward')
    .in('id', challengeIds)

  if (error) {
    throw error
  }

  return Object.fromEntries(
    ((data as ChallengeRewardRow[] | null) ?? []).map((challenge) => [
      challenge.id,
      Number(challenge.xp_reward ?? 0),
    ])
  ) as Record<string, number>
}

export async function loadChallengeXpByUser() {
  const { data, error } = await supabase.from('user_challenges').select('user_id, challenge_id')

  if (error) {
    console.error('[user_challenges] failed to load challenge XP by user', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    return {}
  }

  const challengeRows = (data as UserChallengeRow[] | null) ?? []
  let challengeXpById: Record<string, number> = {}

  try {
    challengeXpById = await loadChallengeRewardsById(
      Array.from(new Set(challengeRows.map((item) => item.challenge_id)))
    )
  } catch (rewardError) {
    console.error('[user_challenges] failed to load challenge reward mapping', rewardError)
    return {}
  }

  const xpByUserId: Record<string, number> = {}

  for (const item of challengeRows) {
    xpByUserId[item.user_id] = (xpByUserId[item.user_id] ?? 0) + Number(challengeXpById[item.challenge_id] ?? 0)
  }

  return xpByUserId
}

export async function loadChallengeXpByUserIds(userIds: string[]) {
  if (userIds.length === 0) {
    return {}
  }

  const { data, error } = await supabase
    .from('user_challenges')
    .select('user_id, challenge_id')
    .in('user_id', userIds)

  if (error) {
    console.error('[user_challenges] failed to load challenge XP by user ids', {
      userIds,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    return {}
  }

  const challengeRows = (data as UserChallengeRow[] | null) ?? []
  let challengeXpById: Record<string, number> = {}

  try {
    challengeXpById = await loadChallengeRewardsById(
      Array.from(new Set(challengeRows.map((item) => item.challenge_id)))
    )
  } catch (rewardError) {
    console.error('[user_challenges] failed to load challenge reward mapping by user ids', {
      userIds,
      error: rewardError,
    })
    return {}
  }

  const xpByUserId: Record<string, number> = {}

  for (const item of challengeRows) {
    xpByUserId[item.user_id] = (xpByUserId[item.user_id] ?? 0) + Number(challengeXpById[item.challenge_id] ?? 0)
  }

  return xpByUserId
}

export async function loadCompletedChallenges(userId: string) {
  const { data, error } = await supabase
    .from('user_challenges')
    .select('challenge_id, completed_at')
    .eq('user_id', userId)

  if (error) {
    console.error('[user_challenges] failed to load completed challenges', {
      userId,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    return new Map<string, CompletedChallengeRecord>()
  }

  const completedRows = (data as UserChallengeRow[] | null) ?? []
  let challengeXpById: Record<string, number> = {}

  try {
    challengeXpById = await loadChallengeRewardsById(
      Array.from(new Set(completedRows.map((item) => item.challenge_id)))
    )
  } catch (rewardError) {
    console.error('[user_challenges] failed to load challenge reward mapping for completed challenges', {
      userId,
      error: rewardError,
    })
    return new Map<string, CompletedChallengeRecord>()
  }

  return new Map(
    completedRows.map((item) => [
      item.challenge_id,
      {
        challengeId: item.challenge_id,
        completedAt: item.completed_at ?? null,
        xpAwarded: Number(challengeXpById[item.challenge_id] ?? 0),
      },
    ])
  )
}

export async function loadCompletedChallengeIds(userId: string) {
  const completedChallenges = await loadCompletedChallenges(userId)

  return new Set(completedChallenges.keys())
}

export async function awardChallengeCompletion(
  _userId: string,
  challengeId: string,
  _xpAwarded: number
): Promise<ChallengeCompletionResult> {
  try {
    const response = await fetch('/api/challenges/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        challengeId,
      }),
    })

    const payload = await response.json().catch(() => null) as
      | {
          ok?: boolean
          duplicate?: boolean
          xpGained?: number
          breakdown?: XpBreakdownItem[]
          levelUp?: boolean
          newLevel?: number | null
          error?: string
        }
      | null

    if (response.ok && payload?.ok) {
      return {
        success: true,
        duplicate: payload.duplicate === true,
        xpGained: typeof payload.xpGained === 'number' ? payload.xpGained : 0,
        breakdown: Array.isArray(payload.breakdown) ? payload.breakdown : [],
        levelUp: payload.levelUp === true,
        newLevel: typeof payload.newLevel === 'number' ? payload.newLevel : null,
        error: null,
      }
    }

    console.error('[user_challenges] failed to persist challenge completion via api', {
      challengeId,
      status: response.status,
      error: payload?.error ?? 'challenge_completion_request_failed',
    })

    return {
      success: false,
      duplicate: false,
      xpGained: 0,
      breakdown: [],
      levelUp: false,
      newLevel: null,
      error: payload?.error ?? 'challenge_completion_request_failed',
    }
  } catch (error) {
    console.error('[user_challenges] failed to persist challenge completion via api', {
      challengeId,
      error,
    })

    return {
      success: false,
      duplicate: false,
      xpGained: 0,
      breakdown: [],
      levelUp: false,
      newLevel: null,
      error,
    }
  }
}
