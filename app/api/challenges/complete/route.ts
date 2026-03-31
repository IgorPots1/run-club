import { NextResponse } from 'next/server'
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

  return NextResponse.json({
    ok: true,
    duplicate: payload.completion_created === false,
    badgeCreated: payload.badge_created === true,
    completedAt: payload.completed_at ?? null,
  })
}
