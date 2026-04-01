import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { loadProfileTotalXp } from '@/lib/profile-total-xp'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { getLevelFromXP } from '@/lib/xp'

type ChallengeCompletionRequestBody = {
  challengeId?: string
}

type ChallengeCompletionRpcResult = {
  out_challenge_id?: string | null
  xp_awarded?: number | null
  completed_at?: string | null
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
  const previousTotalXp = await loadProfileTotalXp(user.id, {
    supabase: supabaseAdmin,
  })
  const { data, error: rpcError } = await supabaseAdmin.rpc('finalize_earned_challenges_for_user', {
    p_user_id: user.id,
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

  const finalizedRows = ((data as ChallengeCompletionRpcResult[] | null) ?? []).filter(
    (row): row is ChallengeCompletionRpcResult & { out_challenge_id: string } =>
      typeof row?.out_challenge_id === 'string' && row.out_challenge_id.length > 0
  )
  const finalizedChallenge = finalizedRows.find((row) => row.out_challenge_id === challengeId) ?? null
  const { data: existingCompletion, error: existingCompletionError } = await supabaseAdmin
    .from('user_challenges')
    .select('completed_at')
    .eq('user_id', user.id)
    .eq('challenge_id', challengeId)
    .maybeSingle()

  if (existingCompletionError) {
    return NextResponse.json(
      {
        ok: false,
        error: existingCompletionError.message,
      },
      { status: 500 }
    )
  }

  if (!existingCompletion) {
    return NextResponse.json(
      {
        ok: false,
        error: 'challenge_not_earned',
      },
      { status: 409 }
    )
  }

  const nextTotalXp = await loadProfileTotalXp(user.id, {
    supabase: supabaseAdmin,
  })
  const previousLevel = getLevelFromXP(previousTotalXp).level
  const nextLevel = getLevelFromXP(nextTotalXp).level
  const levelUp = nextLevel > previousLevel
  const xpGained = Math.max(0, Math.round(Number(finalizedChallenge?.xp_awarded ?? 0)))

  return NextResponse.json({
    ok: true,
    duplicate: finalizedChallenge == null,
    badgeCreated: finalizedChallenge != null,
    completedAt: finalizedChallenge?.completed_at ?? existingCompletion.completed_at ?? null,
    xpGained,
    breakdown: xpGained > 0 ? [{ label: 'Челлендж', value: xpGained }] : [],
    levelUp,
    newLevel: levelUp ? nextLevel : null,
  })
}
