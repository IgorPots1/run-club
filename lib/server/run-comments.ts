import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

export const RUN_COMMENT_PLACEHOLDER_TEXT = 'Комментарий удалён'

const RUN_COMMENT_MUTATION_SELECT =
  'id, run_id, user_id, parent_id, comment, created_at, edited_at, deleted_at'

type ResultOk<T> = {
  ok: true
  data: T
}

type ResultError = {
  ok: false
  status: number
  error: string
}

export type MutationResult<T> = ResultOk<T> | ResultError

type RequestBodyRecord = Record<string, unknown>

type RunExistsRow = {
  id: string
}

export type RunCommentMutationRow = {
  id: string
  run_id: string
  user_id: string
  parent_id: string | null
  comment: string
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

type RunCommentParentRow = Pick<RunCommentMutationRow, 'id' | 'run_id' | 'parent_id' | 'deleted_at'>

export type CreateRunCommentInput = {
  comment: string
  parentId: string | null
}

export type UpdateRunCommentInput = {
  comment: string
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

function asBodyRecord(body: unknown): RequestBodyRecord | null {
  return typeof body === 'object' && body !== null ? (body as RequestBodyRecord) : null
}

function parseRequiredComment(value: unknown) {
  if (typeof value !== 'string') {
    return failure(400, 'invalid_comment')
  }

  const comment = value.trim()

  if (!comment) {
    return failure(400, 'empty_comment')
  }

  return success(comment)
}

export function parseCreateRunCommentInput(body: unknown): MutationResult<CreateRunCommentInput> {
  const record = asBodyRecord(body)

  if (!record) {
    return failure(400, 'invalid_body')
  }

  const parsedComment = parseRequiredComment(record.comment)

  if (!parsedComment.ok) {
    return parsedComment
  }

  const rawParentId = record.parentId
  let parentId: string | null = null

  if (rawParentId === null || typeof rawParentId === 'undefined') {
    parentId = null
  } else if (typeof rawParentId === 'string') {
    parentId = rawParentId.trim() || null
  } else {
    return failure(400, 'invalid_parent_id')
  }

  return success({
    comment: parsedComment.data,
    parentId,
  })
}

export function parseUpdateRunCommentInput(body: unknown): MutationResult<UpdateRunCommentInput> {
  const record = asBodyRecord(body)

  if (!record) {
    return failure(400, 'invalid_body')
  }

  const parsedComment = parseRequiredComment(record.comment)

  if (!parsedComment.ok) {
    return parsedComment
  }

  return success({
    comment: parsedComment.data,
  })
}

async function loadRunExists(
  supabaseAdmin: SupabaseClient,
  runId: string
): Promise<MutationResult<RunExistsRow>> {
  const { data, error } = await supabaseAdmin
    .from('runs')
    .select('id')
    .eq('id', runId)
    .maybeSingle()

  if (error) {
    return failure(500, error.message)
  }

  if (!data) {
    return failure(404, 'run_not_found')
  }

  return success(data as RunExistsRow)
}

async function loadRunCommentById(
  supabaseAdmin: SupabaseClient,
  commentId: string
): Promise<MutationResult<RunCommentMutationRow>> {
  const { data, error } = await supabaseAdmin
    .from('run_comments')
    .select(RUN_COMMENT_MUTATION_SELECT)
    .eq('id', commentId)
    .maybeSingle()

  if (error) {
    return failure(500, error.message)
  }

  if (!data) {
    return failure(404, 'comment_not_found')
  }

  return success(data as RunCommentMutationRow)
}

async function validateReplyParent(
  supabaseAdmin: SupabaseClient,
  runId: string,
  parentId: string
): Promise<MutationResult<RunCommentParentRow>> {
  const { data, error } = await supabaseAdmin
    .from('run_comments')
    .select('id, run_id, parent_id, deleted_at')
    .eq('id', parentId)
    .maybeSingle()

  if (error) {
    return failure(500, error.message)
  }

  if (!data) {
    return failure(404, 'parent_comment_not_found')
  }

  const parentComment = data as RunCommentParentRow

  if (parentComment.run_id !== runId) {
    return failure(400, 'parent_comment_run_mismatch')
  }

  if (parentComment.parent_id) {
    return failure(400, 'parent_comment_not_top_level')
  }

  if (parentComment.deleted_at) {
    return failure(400, 'parent_comment_deleted')
  }

  return success(parentComment)
}

export async function createRunCommentRecord(params: {
  supabaseAdmin: SupabaseClient
  runId: string
  userId: string
  comment: string
  parentId: string | null
}): Promise<MutationResult<RunCommentMutationRow>> {
  const runResult = await loadRunExists(params.supabaseAdmin, params.runId)

  if (!runResult.ok) {
    return runResult
  }

  if (params.parentId) {
    const parentResult = await validateReplyParent(params.supabaseAdmin, params.runId, params.parentId)

    if (!parentResult.ok) {
      return parentResult
    }
  }

  const { data, error } = await params.supabaseAdmin
    .from('run_comments')
    .insert({
      run_id: params.runId,
      user_id: params.userId,
      comment: params.comment,
      parent_id: params.parentId,
    })
    .select(RUN_COMMENT_MUTATION_SELECT)
    .single()

  if (error) {
    return failure(500, error.message)
  }

  return success(data as RunCommentMutationRow)
}

export async function updateRunCommentRecord(params: {
  supabaseAdmin: SupabaseClient
  commentId: string
  userId: string
  comment: string
}): Promise<MutationResult<RunCommentMutationRow>> {
  const existingCommentResult = await loadRunCommentById(params.supabaseAdmin, params.commentId)

  if (!existingCommentResult.ok) {
    return existingCommentResult
  }

  const existingComment = existingCommentResult.data

  if (existingComment.user_id !== params.userId) {
    return failure(403, 'forbidden')
  }

  if (existingComment.deleted_at) {
    return failure(409, 'comment_deleted')
  }

  const { data, error } = await params.supabaseAdmin
    .from('run_comments')
    .update({
      comment: params.comment,
      edited_at: new Date().toISOString(),
    })
    .eq('id', existingComment.id)
    .select(RUN_COMMENT_MUTATION_SELECT)
    .single()

  if (error) {
    return failure(500, error.message)
  }

  return success(data as RunCommentMutationRow)
}

export async function softDeleteRunCommentRecord(params: {
  supabaseAdmin: SupabaseClient
  commentId: string
  userId: string
}): Promise<MutationResult<RunCommentMutationRow>> {
  const existingCommentResult = await loadRunCommentById(params.supabaseAdmin, params.commentId)

  if (!existingCommentResult.ok) {
    return existingCommentResult
  }

  const existingComment = existingCommentResult.data

  if (existingComment.user_id !== params.userId) {
    return failure(403, 'forbidden')
  }

  if (existingComment.deleted_at) {
    return success(existingComment)
  }

  const { data, error } = await params.supabaseAdmin
    .from('run_comments')
    .update({
      comment: RUN_COMMENT_PLACEHOLDER_TEXT,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', existingComment.id)
    .select(RUN_COMMENT_MUTATION_SELECT)
    .single()

  if (error) {
    return failure(500, error.message)
  }

  return success(data as RunCommentMutationRow)
}
