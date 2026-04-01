import { NextResponse } from 'next/server'
import { refreshProfileTotalXp } from '@/lib/profile-total-xp'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type ChallengeCompletionRequestBody = {
  challengeId?: string
}

type ChallengeCompletionRpcResult = {
  completion_created?: boolean
  badge_created?: boolean
  completed_at?: string | null
}

type ChallengeXpRow = {
  xp_reward: number | null
}

export async function POST(request: Request) {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? 'auth_required',
      },
      { status: 401 }
    )
  }

  const body = await request.json().catch(() => null) as ChallengeCompletionRequestBody | null
  const challengeId = body?.challengeId?.trim() ?? ''

  if (!challengeId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_challenge_id',
      },
      { status: 400 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const { data: challengeRow, error: challengeError } = await supabaseAdmin
    .from('challenges')
    .select('xp_reward')
    .eq('id', challengeId)
    .maybeSingle()

  if (challengeError) {
    console.error('[challenge_completion] failed to load challenge xp reward', {
      challengeId,
      error: challengeError,
    })
  }

  const challengeXpReward = Math.max(0, Math.round(Number((challengeRow as ChallengeXpRow | null)?.xp_reward ?? 0)))

  const { data, error: rpcError } = await supabaseAdmin.rpc('award_challenge_completion_badge', {
    p_user_id: user.id,
    p_challenge_id: challengeId,
  })

  if (rpcError) {
    const status = rpcError.code === 'P0002' ? 404 : 500

    return NextResponse.json(
      {
        ok: false,
        error: rpcError.message,
      },
      { status }
    )
  }

  const payload = (data ?? {}) as ChallengeCompletionRpcResult
  const completionCreated = payload.completion_created !== false
  const xpGained = completionCreated ? challengeXpReward : 0

  const xpRefreshResult = await refreshProfileTotalXp(user.id, {
    supabase: supabaseAdmin,
    context: 'challenge_completion',
  })

  return NextResponse.json({
    ok: true,
    duplicate: completionCreated === false,
    badgeCreated: payload.badge_created === true,
    completedAt: payload.completed_at ?? null,
    xpGained,
    breakdown: xpGained > 0 ? [{ label: 'Челлендж', value: xpGained }] : [],
    levelUp: xpRefreshResult.levelUp,
    newLevel: xpRefreshResult.newLevel,
  })
}
