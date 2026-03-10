import { supabase } from './supabase'

type UserChallengeRow = {
  user_id: string
  challenge_id: string
  xp_awarded: number | null
  completed_at?: string | null
}

export type CompletedChallengeRecord = {
  challengeId: string
  completedAt: string | null
  xpAwarded: number
}

type ChallengeCompletionResult = {
  success: boolean
  duplicate: boolean
  error: unknown | null
}

export async function loadChallengeXpByUser() {
  const { data, error } = await supabase.from('user_challenges').select('user_id, challenge_id, xp_awarded')

  if (error) {
    console.error('[user_challenges] failed to load challenge XP by user', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    return {}
  }

  const xpByUserId: Record<string, number> = {}

  for (const item of (data as UserChallengeRow[] | null) ?? []) {
    xpByUserId[item.user_id] = (xpByUserId[item.user_id] ?? 0) + Number(item.xp_awarded ?? 0)
  }

  return xpByUserId
}

export async function loadChallengeXpByUserIds(userIds: string[]) {
  if (userIds.length === 0) {
    return {}
  }

  const { data, error } = await supabase
    .from('user_challenges')
    .select('user_id, challenge_id, xp_awarded')
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

  const xpByUserId: Record<string, number> = {}

  for (const item of (data as UserChallengeRow[] | null) ?? []) {
    xpByUserId[item.user_id] = (xpByUserId[item.user_id] ?? 0) + Number(item.xp_awarded ?? 0)
  }

  return xpByUserId
}

export async function loadCompletedChallenges(userId: string) {
  const { data, error } = await supabase
    .from('user_challenges')
    .select('challenge_id, completed_at, xp_awarded')
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

  return new Map(
    ((data as UserChallengeRow[] | null) ?? []).map((item) => [
      item.challenge_id,
      {
        challengeId: item.challenge_id,
        completedAt: item.completed_at ?? null,
        xpAwarded: Number(item.xp_awarded ?? 0),
      },
    ])
  )
}

export async function loadCompletedChallengeIds(userId: string) {
  const completedChallenges = await loadCompletedChallenges(userId)

  return new Set(completedChallenges.keys())
}

export async function awardChallengeCompletion(
  userId: string,
  challengeId: string,
  xpAwarded: number
): Promise<ChallengeCompletionResult> {
  const { error } = await supabase.from('user_challenges').insert({
    user_id: userId,
    challenge_id: challengeId,
    completed_at: new Date().toISOString(),
    xp_awarded: xpAwarded,
  })

  if (!error) {
    return {
      success: true,
      duplicate: false,
      error: null,
    }
  }

  if (error.code === '23505') {
    return {
      success: true,
      duplicate: true,
      error: null,
    }
  }

  console.error('[user_challenges] failed to persist challenge completion', {
    userId,
    challengeId,
    xpAwarded,
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  })

  return {
    success: false,
    duplicate: false,
    error,
  }
}
