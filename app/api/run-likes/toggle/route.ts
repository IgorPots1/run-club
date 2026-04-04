import { after, NextResponse } from 'next/server'
import { createAppEvent } from '@/lib/events/createAppEvent'
import { buildRunLikeCreatedEvent } from '@/lib/events/returnTriggerEvents'
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

type RunEventTargetRow = {
  id: string
  user_id: string
  title: string | null
  name: string | null
}

type RunLikeTargetOwnerRow = {
  user_id: string | null
}

function isDuplicateRunLikeError(error: { code?: string | null; message?: string | null }) {
  return (
    error.code === '23505' ||
    Boolean(error.message?.includes('duplicate key value')) ||
    Boolean(error.message?.includes('run_likes_pkey'))
  )
}

function isSelfRunLikeError(error: { code?: string | null; message?: string | null }) {
  return Boolean(error.message?.includes('cannot_like_own_run'))
}

async function emitRunLikeCreatedEvent(input: {
  actorUserId: string
  runId: string
  xpAwarded: number
}) {
  try {
    const supabaseAdmin = createSupabaseAdminClient()
    const { data, error } = await supabaseAdmin
      .from('runs')
      .select('id, user_id, title, name')
      .eq('id', input.runId)
      .maybeSingle()

    if (error) {
      throw error
    }

    const run = (data as RunEventTargetRow | null) ?? null

    if (!run || !run.user_id || run.user_id === input.actorUserId) {
      return
    }

    await createAppEvent(
      buildRunLikeCreatedEvent({
        actorUserId: input.actorUserId,
        targetUserId: run.user_id,
        runId: run.id,
        runTitle: run.title ?? run.name,
        xpAwarded: input.xpAwarded,
      })
    )
  } catch (error) {
    console.error('Failed to create run like app event', {
      runId: input.runId,
      actorUserId: input.actorUserId,
      error: error instanceof Error ? error.message : 'unknown_error',
    })
  }
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

    if (!deletedLike?.created_at) {
      return NextResponse.json({
        ok: true,
      })
    }
  } else {
    const { data: runTarget, error: runTargetError } = await supabaseAdmin
      .from('runs')
      .select('user_id')
      .eq('id', runId)
      .maybeSingle()

    if (runTargetError) {
      return NextResponse.json(
        {
          ok: false,
          error: runTargetError.message,
        },
        { status: 500 }
      )
    }

    const runOwnerUserId = (runTarget as RunLikeTargetOwnerRow | null)?.user_id ?? null

    if (runOwnerUserId === user.id) {
      return NextResponse.json(
        {
          ok: false,
          error: 'cannot_like_own_run',
        },
        { status: 409 }
      )
    }

    const { data: insertedLikes, error: insertError } = await supabaseAdmin
      .from('run_likes')
      .insert({ run_id: runId, user_id: user.id })
      .select('created_at, xp_awarded')

    if (insertError) {
      if (isDuplicateRunLikeError(insertError)) {
        return NextResponse.json({
          ok: true,
        })
      }

      if (isSelfRunLikeError(insertError)) {
        return NextResponse.json(
          {
            ok: false,
            error: 'cannot_like_own_run',
          },
          { status: 409 }
        )
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
    const xpAwarded = Math.max(0, Math.round(Number(insertedLike?.xp_awarded ?? 0)))

    if (!insertedLike?.created_at) {
      return NextResponse.json({
        ok: true,
      })
    }

    after(async () => {
      await emitRunLikeCreatedEvent({
        actorUserId: user.id,
        runId,
        xpAwarded,
      })
    })
  }

  return NextResponse.json({
    ok: true,
  })
}
