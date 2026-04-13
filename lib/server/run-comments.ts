import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { RUN_COMMENT_PLACEHOLDER_TEXT } from '@/lib/run-comments-constants'

const RUN_COMMENT_MUTATION_SELECT =
  'id, entity_type, entity_id, run_id, user_id, parent_id, comment, created_at, edited_at, deleted_at'

export type CommentEntityType = 'run' | 'race'

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

type RaceExistsRow = {
  id: string
}

export type RunCommentMutationRow = {
  id: string
  entity_type: CommentEntityType
  entity_id: string
  run_id: string | null
  user_id: string
  parent_id: string | null
  comment: string
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

export type RunCommentPayload = RunCommentMutationRow & {
  display_name: string
  nickname: string | null
  avatar_url: string | null
  likes_count: number
  liked_by_me: boolean
}

type RunCommentParentRow = Pick<RunCommentMutationRow, 'id' | 'entity_type' | 'entity_id' | 'run_id' | 'parent_id' | 'deleted_at'>
type RunCommentProfileRow = {
  name: string | null
  nickname: string | null
  avatar_url: string | null
}

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

async function loadRaceExists(
  supabaseAdmin: SupabaseClient,
  raceId: string
): Promise<MutationResult<RaceExistsRow>> {
  const { data, error } = await supabaseAdmin
    .from('race_events')
    .select('id')
    .eq('id', raceId)
    .maybeSingle()

  if (error) {
    return failure(500, error.message)
  }

  if (!data) {
    return failure(404, 'race_not_found')
  }

  return success(data as RaceExistsRow)
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
  entityType: CommentEntityType,
  entityId: string,
  parentId: string
): Promise<MutationResult<RunCommentParentRow>> {
  const { data, error } = await supabaseAdmin
    .from('run_comments')
    .select('id, entity_type, entity_id, run_id, parent_id, deleted_at')
    .eq('id', parentId)
    .maybeSingle()

  if (error) {
    return failure(500, error.message)
  }

  if (!data) {
    return failure(404, 'parent_comment_not_found')
  }

  const parentComment = data as RunCommentParentRow

  if (parentComment.entity_type !== entityType || parentComment.entity_id !== entityId) {
    return failure(400, 'parent_comment_entity_mismatch')
  }

  if (parentComment.parent_id) {
    return failure(400, 'parent_comment_not_top_level')
  }

  if (parentComment.deleted_at) {
    return failure(400, 'parent_comment_deleted')
  }

  return success(parentComment)
}

async function loadRunCommentPayloadProfile(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<RunCommentProfileRow | null> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('name, nickname, avatar_url')
    .eq('id', userId)
    .eq('app_access_status', 'active')
    .maybeSingle()

  if (error) {
    throw error
  }

  return (data as RunCommentProfileRow | null) ?? null
}

async function loadRunCommentPayloadLikes(
  supabaseAdmin: SupabaseClient,
  commentId: string,
  viewerUserId: string | null
) {
  const [likesCountResult, likedByMeResult] = await Promise.all([
    supabaseAdmin
      .from('run_comment_likes')
      .select('comment_id', { count: 'exact', head: true })
      .eq('comment_id', commentId),
    viewerUserId
      ? supabaseAdmin
          .from('run_comment_likes')
          .select('comment_id', { count: 'exact', head: true })
          .eq('comment_id', commentId)
          .eq('user_id', viewerUserId)
      : Promise.resolve({ count: 0, error: null }),
  ])

  if (likesCountResult.error) {
    throw likesCountResult.error
  }

  if (likedByMeResult.error) {
    throw likedByMeResult.error
  }

  return {
    likesCount: Number(likesCountResult.count ?? 0),
    likedByMe: Number(likedByMeResult.count ?? 0) > 0,
  }
}

export async function buildRunCommentPayload(params: {
  supabaseAdmin: SupabaseClient
  comment: RunCommentMutationRow
  viewerUserId?: string | null
}): Promise<RunCommentPayload> {
  const [profile, likes] = await Promise.all([
    loadRunCommentPayloadProfile(params.supabaseAdmin, params.comment.user_id).catch(() => null),
    loadRunCommentPayloadLikes(
      params.supabaseAdmin,
      params.comment.id,
      params.viewerUserId ?? null
    ).catch(() => ({
      likesCount: 0,
      likedByMe: false,
    })),
  ])

  return {
    ...params.comment,
    display_name: profile?.name?.trim() || 'Бегун',
    nickname: profile?.nickname?.trim() || null,
    avatar_url: profile?.avatar_url ?? null,
    likes_count: likes.likesCount,
    liked_by_me: likes.likedByMe,
  }
}

export async function createRunCommentRecord(params: {
  supabaseAdmin: SupabaseClient
  entityType: CommentEntityType
  entityId: string
  userId: string
  comment: string
  parentId: string | null
}): Promise<MutationResult<RunCommentMutationRow>> {
  if (params.entityType === 'run') {
    const runResult = await loadRunExists(params.supabaseAdmin, params.entityId)

    if (!runResult.ok) {
      return runResult
    }
  } else {
    const raceResult = await loadRaceExists(params.supabaseAdmin, params.entityId)

    if (!raceResult.ok) {
      return raceResult
    }
  }

  if (params.parentId) {
    const parentResult = await validateReplyParent(
      params.supabaseAdmin,
      params.entityType,
      params.entityId,
      params.parentId
    )

    if (!parentResult.ok) {
      return parentResult
    }
  }

  const { data, error } = await params.supabaseAdmin
    .from('run_comments')
    .insert({
      entity_type: params.entityType,
      entity_id: params.entityId,
      run_id: params.entityType === 'run' ? params.entityId : null,
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

export async function createRunScopedCommentRecord(params: {
  supabaseAdmin: SupabaseClient
  runId: string
  userId: string
  comment: string
  parentId: string | null
}): Promise<MutationResult<RunCommentMutationRow>> {
  return createRunCommentRecord({
    supabaseAdmin: params.supabaseAdmin,
    entityType: 'run',
    entityId: params.runId,
    userId: params.userId,
    comment: params.comment,
    parentId: params.parentId,
  })
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
