import { after, NextResponse } from 'next/server'
import { createAppEvent } from '@/lib/events/createAppEvent'
import {
  buildRunCommentCreatedEvent,
  buildRunCommentReplyCreatedEvent,
} from '@/lib/events/returnTriggerEvents'
import {
  buildRunCommentPayload,
  createRunScopedCommentRecord,
  parseCreateRunCommentInput,
} from '@/lib/server/run-comments'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type RunCommentEventRunRow = {
  id: string
  user_id: string
  title: string | null
  name: string | null
}

type RunCommentEventParentRow = {
  id: string
  user_id: string
}

async function emitRunCommentCreatedEvent(input: {
  actorUserId: string
  runId: string
  commentId: string
  parentId: string | null
  comment: string
}) {
  try {
    const supabaseAdmin = createSupabaseAdminClient()
    const { data: runData, error: runError } = await supabaseAdmin
      .from('runs')
      .select('id, user_id, title, name')
      .eq('id', input.runId)
      .maybeSingle()

    if (runError) {
      throw runError
    }

    const run = (runData as RunCommentEventRunRow | null) ?? null

    if (!run) {
      return
    }

    if (input.parentId) {
      const { data: parentData, error: parentError } = await supabaseAdmin
        .from('run_comments')
        .select('id, user_id')
        .eq('id', input.parentId)
        .maybeSingle()

      if (parentError) {
        throw parentError
      }

      const parentComment = (parentData as RunCommentEventParentRow | null) ?? null

      if (!parentComment?.user_id || parentComment.user_id === input.actorUserId) {
        return
      }

      await createAppEvent(
        buildRunCommentReplyCreatedEvent({
          actorUserId: input.actorUserId,
          targetUserId: parentComment.user_id,
          runId: input.runId,
          commentId: input.commentId,
          parentCommentId: parentComment.id,
          comment: input.comment,
        })
      )
      return
    }

    if (!run.user_id || run.user_id === input.actorUserId) {
      return
    }

    await createAppEvent(
      buildRunCommentCreatedEvent({
        actorUserId: input.actorUserId,
        targetUserId: run.user_id,
        runId: input.runId,
        commentId: input.commentId,
        runTitle: run.title ?? run.name,
        comment: input.comment,
      })
    )
  } catch (error) {
    console.error('Failed to create run comment app event', {
      runId: input.runId,
      commentId: input.commentId,
      parentId: input.parentId,
      actorUserId: input.actorUserId,
      error: error instanceof Error ? error.message : 'unknown_error',
    })
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
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

  const { id } = await context.params
  const runId = typeof id === 'string' ? id.trim() : ''

  if (!runId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_run_id',
      },
      { status: 400 }
    )
  }

  const body = await request.json().catch(() => null)
  const parsedInput = parseCreateRunCommentInput(body)

  if (!parsedInput.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: parsedInput.error,
      },
      { status: parsedInput.status }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const result = await createRunScopedCommentRecord({
    supabaseAdmin,
    runId,
    userId: user.id,
    comment: parsedInput.data.comment,
    parentId: parsedInput.data.parentId,
  })

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
      },
      { status: result.status }
    )
  }

  after(async () => {
    await emitRunCommentCreatedEvent({
      actorUserId: user.id,
      runId,
      commentId: result.data.id,
      parentId: result.data.parent_id,
      comment: result.data.comment,
    })
  })

  return NextResponse.json(
    {
      ok: true,
      comment: await buildRunCommentPayload({
        supabaseAdmin,
        comment: result.data,
        viewerUserId: user.id,
      }),
    },
    { status: 201 }
  )
}
