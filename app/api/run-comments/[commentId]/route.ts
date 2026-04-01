import { NextResponse } from 'next/server'
import {
  buildRunCommentPayload,
  parseUpdateRunCommentInput,
  softDeleteRunCommentRecord,
  updateRunCommentRecord,
} from '@/lib/server/run-comments'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

function getCommentId(rawCommentId: string | undefined) {
  return typeof rawCommentId === 'string' ? rawCommentId.trim() : ''
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ commentId: string }> }
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

  const { commentId: rawCommentId } = await context.params
  const commentId = getCommentId(rawCommentId)

  if (!commentId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_comment_id',
      },
      { status: 400 }
    )
  }

  const body = await request.json().catch(() => null)
  const parsedInput = parseUpdateRunCommentInput(body)

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
  const result = await updateRunCommentRecord({
    supabaseAdmin,
    commentId,
    userId: user.id,
    comment: parsedInput.data.comment,
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

  return NextResponse.json({
    ok: true,
    comment: await buildRunCommentPayload({
      supabaseAdmin,
      comment: result.data,
      viewerUserId: user.id,
    }),
  })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ commentId: string }> }
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

  const { commentId: rawCommentId } = await context.params
  const commentId = getCommentId(rawCommentId)

  if (!commentId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_comment_id',
      },
      { status: 400 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const result = await softDeleteRunCommentRecord({
    supabaseAdmin,
    commentId,
    userId: user.id,
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

  return NextResponse.json({
    ok: true,
    comment: await buildRunCommentPayload({
      supabaseAdmin,
      comment: result.data,
      viewerUserId: user.id,
    }),
  })
}
