import { supabase } from './supabase'

type UserChallengeRow = {
  user_id: string
  challenge_id: string
  xp_awarded: number
}

export async function loadChallengeXpByUser() {
  const { data, error } = await supabase.from('user_challenges').select('user_id, challenge_id, xp_awarded')

  if (error) {
    return {}
  }

  const xpByUserId: Record<string, number> = {}

  for (const item of (data as UserChallengeRow[] | null) ?? []) {
    xpByUserId[item.user_id] = (xpByUserId[item.user_id] ?? 0) + Number(item.xp_awarded ?? 0)
  }

  return xpByUserId
}

export async function loadCompletedChallengeIds(userId: string) {
  const { data, error } = await supabase
    .from('user_challenges')
    .select('challenge_id')
    .eq('user_id', userId)

  if (error) {
    return new Set<string>()
  }

  return new Set(((data as { challenge_id: string }[] | null) ?? []).map((item) => item.challenge_id))
}

export async function awardChallengeCompletion(userId: string, challengeId: string, xpAwarded: number) {
  return supabase.from('user_challenges').upsert(
    {
      user_id: userId,
      challenge_id: challengeId,
      completed_at: new Date().toISOString(),
      xp_awarded: xpAwarded,
    },
    {
      onConflict: 'user_id,challenge_id',
      ignoreDuplicates: true,
    }
  )
}
