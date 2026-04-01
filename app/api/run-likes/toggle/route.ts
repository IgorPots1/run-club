import { NextResponse } from 'next/server'
import { refreshProfileTotalXp } from '@/lib/profile-total-xp'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type ToggleRunLikeRequestBody = {
  runId?: string | null
  likedByMe?: boolean | null
}

type RunOwnerRow = {
  user_id: string
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

  const body = await request.json().catch(() => null) as ToggleRunLikeRequestBody | null
  const runId = body?.runId?.trim() ?? ''
  const likedByMe = body?.likedByMe === true

  if (!runId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_run_id',
      },
      { status: 400 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const { data: runOwner, error: runOwnerError } = await supabaseAdmin
    .from('runs')
    .select('user_id')
    .eq('id', runId)
    .maybeSingle()

  if (runOwnerError) {
    return NextResponse.json(
      {
        ok: false,
        error: runOwnerError.message,
      },
      { status: 500 }
    )
  }

  const ownerUserId = (runOwner as RunOwnerRow | null)?.user_id ?? null

  if (!ownerUserId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'run_not_found',
      },
      { status: 404 }
    )
  }

  const mutationResult = likedByMe
    ? await supabaseAdmin
        .from('run_likes')
        .delete()
        .eq('run_id', runId)
        .eq('user_id', user.id)
    : await supabaseAdmin
        .from('run_likes')
        .upsert(
          { run_id: runId, user_id: user.id },
          {
            onConflict: 'run_id,user_id',
            ignoreDuplicates: true,
          }
        )

  if (mutationResult.error) {
    return NextResponse.json(
      {
        ok: false,
        error: mutationResult.error.message,
      },
      { status: 500 }
    )
  }

  await refreshProfileTotalXp(ownerUserId, {
    supabase: supabaseAdmin,
    context: likedByMe ? 'run_like_removed' : 'run_like_created',
  })

  return NextResponse.json({
    ok: true,
  })
}
