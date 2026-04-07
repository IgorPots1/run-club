import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

type ResultOk<T> = {
  ok: true
  data: T
}

type ResultError = {
  ok: false
  status: number
  error: string
}

type MutationResult<T> = ResultOk<T> | ResultError

type RunCommentLikeTargetRow = {
  id: string
  entity_type: 'run' | 'race'
  entity_id: string
  run_id: string | null
  deleted_at: string | null
}

function success<T>(data: T): MutationResult<T> {
  return {
    ok: true,
    data,
  }
}

function failure(status: number, error: string): MutationResult<never> {
  return {
    ok: false,
    status,
    error,
  }
}

function isDuplicateRunCommentLikeError(error: { code?: string | null; message?: string | null }) {
  return (
    error.code === '23505' ||
    Boolean(error.message?.includes('duplicate key value')) ||
    Boolean(error.message?.includes('run_comment_likes_pkey'))
  )
}

export function parseToggleRunCommentLikeInput(body: unknown): MutationResult<{ commentId: string; likedByMe: boolean }> {
  if (typeof body !== 'object' || body === null) {
    return failure(400, 'invalid_body')
  }

  const record = body as Record<string, unknown>
  const commentId = typeof record.commentId === 'string' ? record.commentId.trim() : ''
  const likedByMe = record.likedByMe === true

  if (!commentId) {
    return failure(400, 'invalid_comment_id')
  }

  return success({ commentId, likedByMe })
}

async function loadRunCommentLikeTarget(
  supabaseAdmin: SupabaseClient,
  commentId: string
): Promise<MutationResult<RunCommentLikeTargetRow>> {
  const { data, error } = await supabaseAdmin
    .from('run_comments')
    .select('id, run_id, deleted_at')
    .eq('id', commentId)
    .maybeSingle()

  if (error) {
    return failure(500, error.message)
  }

  if (!data) {
    return failure(404, 'comment_not_found')
  }

  return success(data as RunCommentLikeTargetRow)
}

export async function toggleRunCommentLikeRecord(params: {
  supabaseAdmin: SupabaseClient
  commentId: string
  userId: string
  likedByMe: boolean
}): Promise<MutationResult<{ entityType: 'run' | 'race'; entityId: string; runId: string | null }>> {
  const targetResult = await loadRunCommentLikeTarget(params.supabaseAdmin, params.commentId)

  if (!targetResult.ok) {
    return targetResult
  }

  const target = targetResult.data

  if (target.deleted_at) {
    return failure(409, 'comment_deleted')
  }

  if (params.likedByMe) {
    const { error } = await params.supabaseAdmin
      .from('run_comment_likes')
      .delete()
      .eq('comment_id', params.commentId)
      .eq('user_id', params.userId)

    if (error) {
      return failure(500, error.message)
    }

    return success({
      entityType: target.entity_type,
      entityId: target.entity_id,
      runId: target.run_id,
    })
  }

  const { error } = await params.supabaseAdmin
    .from('run_comment_likes')
    .insert({
      comment_id: params.commentId,
      entity_type: target.entity_type,
      entity_id: target.entity_id,
      run_id: target.run_id,
      user_id: params.userId,
    })

  if (error && !isDuplicateRunCommentLikeError(error)) {
    return failure(500, error.message)
  }

  return success({
    entityType: target.entity_type,
    entityId: target.entity_id,
    runId: target.run_id,
  })
}
