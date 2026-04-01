import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type ToggleRunLikeRequestBody = {
  runId?: string | null
  likedByMe?: boolean | null
}

type RunLikeMutationRow = {
  created_at: string
  xp_awarded?: number | null
}

function isDuplicateRunLikeError(error: { code?: string | null; message?: string | null }) {
  return (
    error.code === '23505' ||
    Boolean(error.message?.includes('duplicate key value')) ||
    Boolean(error.message?.includes('run_likes_pkey'))
  )
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
  let xpGained = 0
  let xpRemoved = 0

  if (likedByMe) {
    const { data: deletedLikes, error: deleteError } = await supabaseAdmin
      .from('run_likes')
      .delete()
      .eq('run_id', runId)
      .eq('user_id', user.id)
      .select('created_at, xp_awarded')

    if (deleteError) {
      return NextResponse.json(
        {
          ok: false,
          error: deleteError.message,
        },
        { status: 500 }
      )
    }

    const deletedLike = ((deletedLikes as RunLikeMutationRow[] | null) ?? [])[0] ?? null
    xpRemoved = Math.max(0, Math.round(Number(deletedLike?.xp_awarded ?? 0)))

    if (!deletedLike?.created_at) {
      return NextResponse.json({
        ok: true,
        xpGained: 0,
        xpRemoved: 0,
        breakdown: [],
      })
    }
  } else {
    const { data: insertedLikes, error: insertError } = await supabaseAdmin
      .from('run_likes')
      .insert({ run_id: runId, user_id: user.id })
      .select('created_at, xp_awarded')

    if (insertError) {
      if (isDuplicateRunLikeError(insertError)) {
        return NextResponse.json({
          ok: true,
          xpGained: 0,
          xpRemoved: 0,
          breakdown: [],
        })
      }

      return NextResponse.json(
        {
          ok: false,
          error: insertError.message,
        },
        { status: 500 }
      )
    }

    const insertedLike = ((insertedLikes as RunLikeMutationRow[] | null) ?? [])[0] ?? null
    xpGained = Math.max(0, Math.round(Number(insertedLike?.xp_awarded ?? 0)))

    if (!insertedLike?.created_at) {
      return NextResponse.json({
        ok: true,
        xpGained: 0,
        xpRemoved: 0,
        breakdown: [],
      })
    }
  }

  return NextResponse.json({
    ok: true,
    xpGained,
    xpRemoved,
    breakdown: xpGained > 0 ? [{ label: 'Лайк', value: xpGained }] : [],
  })
}
