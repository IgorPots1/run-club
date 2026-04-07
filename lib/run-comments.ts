import { RUN_COMMENT_PLACEHOLDER_TEXT } from './run-comments-constants'
import { supabase } from './supabase'

export type CommentEntityType = 'run' | 'race'

type RunCommentRow = {
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

export type RunCommentRealtimeRow = RunCommentRow

type RunCommentApiPayload = RunCommentRow & {
  display_name: string | null
  nickname: string | null
  avatar_url: string | null
  likes_count: number | null
  liked_by_me: boolean | null
}

type RunCommentCountRow = Pick<RunCommentRow, 'id' | 'entity_type' | 'entity_id' | 'parent_id' | 'created_at' | 'deleted_at'>
export type RunCommentVisibilityRecord = {
  id: string
  entityType: CommentEntityType
  entityId: string
  runId: string | null
  parentId: string | null
  createdAt: string
  deletedAt: string | null
}

export type RunCommentVisibilitySummary = {
  visibilityByEntityId: Record<string, RunCommentVisibilityRecord[]>
  countsByEntityId: Record<string, number>
  visibilityByRunId: Record<string, RunCommentVisibilityRecord[]>
  countsByRunId: Record<string, number>
}

export type RunCommentLikeRealtimeRow = {
  comment_id: string
  entity_type: CommentEntityType
  entity_id: string
  run_id: string | null
  user_id: string
  created_at: string
}

export type RunCommentAuthorIdentity = {
  userId: string
  displayName: string
  nickname: string | null
  avatarUrl: string | null
}

export type RunCommentItem = {
  id: string
  entityType: CommentEntityType
  entityId: string
  runId: string | null
  userId: string
  parentId: string | null
  comment: string
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
  displayName: string
  nickname: string | null
  avatarUrl: string | null
  likesCount: number
  likedByMe: boolean
}

export type RunCommentThread = RunCommentItem & {
  replies: RunCommentItem[]
}

type RunCommentVisibilityItem = Pick<RunCommentItem, 'id' | 'parentId' | 'createdAt' | 'deletedAt'>

type RunCommentVisibilityThread<TComment extends RunCommentVisibilityItem> = TComment & {
  replies: TComment[]
}

type RunCommentMutationResponse = {
  ok?: boolean
  error?: string
  comment?: RunCommentApiPayload
}

type CreateRunCommentInput = {
  comment: string
  parentId?: string | null
}

type CreateEntityCommentInput = CreateRunCommentInput

type UpdateRunCommentInput = {
  comment: string
}

type SubscribeToRunCommentsHandlers = {
  onInsert?: (comment: RunCommentRealtimeRow) => void
  onUpdate?: (comment: RunCommentRealtimeRow) => void
}

type SubscribeToRunCommentLikesHandlers = {
  onInsert?: (like: RunCommentLikeRealtimeRow) => void
  onDelete?: (like: RunCommentLikeRealtimeRow) => void
}

function compareRunComments(left: Pick<RunCommentItem, 'createdAt' | 'id'>, right: Pick<RunCommentItem, 'createdAt' | 'id'>) {
  const createdAtComparison = left.createdAt.localeCompare(right.createdAt)

  if (createdAtComparison !== 0) {
    return createdAtComparison
  }

  return left.id.localeCompare(right.id)
}

function mapRunCommentApiPayloadToItem(comment: RunCommentApiPayload): RunCommentItem {
  return {
    id: comment.id,
    entityType: comment.entity_type,
    entityId: comment.entity_id,
    runId: comment.run_id,
    userId: comment.user_id,
    parentId: comment.parent_id,
    comment: comment.comment,
    createdAt: comment.created_at,
    editedAt: comment.edited_at,
    deletedAt: comment.deleted_at,
    displayName: comment.display_name?.trim() || 'Бегун',
    nickname: comment.nickname?.trim() || null,
    avatarUrl: comment.avatar_url ?? null,
    likesCount: Math.max(0, Math.round(Number(comment.likes_count ?? 0))),
    likedByMe: comment.liked_by_me === true,
  }
}

async function requestRunCommentMutation(path: string, init: RequestInit): Promise<RunCommentItem> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const result = await response.json().catch(() => null) as RunCommentMutationResponse | null

  if (!response.ok || !result?.ok || !result.comment) {
    throw new Error(result?.error ?? 'run_comment_request_failed')
  }

  return mapRunCommentApiPayloadToItem(result.comment)
}

export function mergeRunCommentRealtimeRow(params: {
  commentRow: RunCommentRealtimeRow
  existingComment?: RunCommentItem | null
  authorIdentity?: RunCommentAuthorIdentity | null
}): RunCommentItem {
  return {
    id: params.commentRow.id,
    entityType: params.commentRow.entity_type,
    entityId: params.commentRow.entity_id,
    runId: params.commentRow.run_id,
    userId: params.commentRow.user_id,
    parentId: params.commentRow.parent_id,
    comment: params.commentRow.comment,
    createdAt: params.commentRow.created_at,
    editedAt: params.commentRow.edited_at,
    deletedAt: params.commentRow.deleted_at,
    displayName: params.existingComment?.displayName ?? params.authorIdentity?.displayName ?? 'Бегун',
    nickname: params.existingComment?.nickname ?? params.authorIdentity?.nickname ?? null,
    avatarUrl: params.existingComment?.avatarUrl ?? params.authorIdentity?.avatarUrl ?? null,
    likesCount: params.existingComment?.likesCount ?? 0,
    likedByMe: params.existingComment?.likedByMe ?? false,
  }
}

export function resolveRunCommentRealtimeItem(
  commentRow: RunCommentRealtimeRow,
  params: {
    existingComment?: RunCommentItem | null
    authorIdentity?: RunCommentAuthorIdentity | null
  } = {}
): RunCommentItem {
  return mergeRunCommentRealtimeRow({
    commentRow,
    existingComment: params.existingComment,
    authorIdentity: params.authorIdentity,
  })
}

export async function createEntityComment(
  entityType: CommentEntityType,
  entityId: string,
  input: CreateEntityCommentInput
) {
  const normalizedEntityPath = entityType === 'race' ? 'races' : 'runs'

  return requestRunCommentMutation(`/api/${normalizedEntityPath}/${entityId}/comments`, {
    method: 'POST',
    body: JSON.stringify({
      comment: input.comment,
      parentId: input.parentId ?? null,
    }),
  })
}

export async function createRunComment(runId: string, input: CreateRunCommentInput) {
  return createEntityComment('run', runId, input)
}

export async function createRaceComment(raceId: string, input: CreateEntityCommentInput) {
  return createEntityComment('race', raceId, input)
}

export async function updateRunComment(commentId: string, input: UpdateRunCommentInput) {
  return requestRunCommentMutation(`/api/run-comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      comment: input.comment,
    }),
  })
}

export async function deleteRunComment(commentId: string) {
  return requestRunCommentMutation(`/api/run-comments/${commentId}`, {
    method: 'DELETE',
  })
}

export function createOptimisticDeletedRunComment(
  comment: RunCommentItem,
  deletedAt: string = new Date().toISOString()
): RunCommentItem {
  return {
    ...comment,
    comment: RUN_COMMENT_PLACEHOLDER_TEXT,
    deletedAt,
  }
}

export async function toggleRunCommentLike(commentId: string, likedByMe: boolean) {
  const response = await fetch('/api/run-comment-likes/toggle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({
      commentId,
      likedByMe,
    }),
  })

  const payload = await response.json().catch(() => null) as
    | {
        ok?: boolean
        error?: string
      }
    | null

  if (!response.ok || !payload?.ok) {
    return {
      error: new Error(
        payload && typeof payload.error === 'string'
          ? payload.error
          : 'run_comment_like_toggle_failed'
      ),
    }
  }

  return {
    error: null,
  }
}

export function applyRunCommentInsert(existingComments: RunCommentItem[], incomingComment: RunCommentItem) {
  const existingIndex = existingComments.findIndex((comment) => comment.id === incomingComment.id)

  if (existingIndex >= 0) {
    return existingComments
      .map((comment, index) => (index === existingIndex ? incomingComment : comment))
      .sort(compareRunComments)
  }

  return [...existingComments, incomingComment].sort(compareRunComments)
}

export function applyRunCommentUpdate(existingComments: RunCommentItem[], incomingComment: RunCommentItem) {
  const existingIndex = existingComments.findIndex((comment) => comment.id === incomingComment.id)

  if (existingIndex < 0) {
    return applyRunCommentInsert(existingComments, incomingComment)
  }

  return existingComments
    .map((comment, index) => (index === existingIndex ? incomingComment : comment))
    .sort(compareRunComments)
}

export function applyRunCommentLikeState(
  existingComments: RunCommentItem[],
  params: {
    commentId: string
    delta: number
    likedByMe?: boolean
  }
) {
  return existingComments.map((comment) => {
    if (comment.id !== params.commentId) {
      return comment
    }

    return {
      ...comment,
      likesCount: Math.max(0, comment.likesCount + params.delta),
      likedByMe: typeof params.likedByMe === 'boolean' ? params.likedByMe : comment.likedByMe,
    }
  })
}

function buildRunCommentVisibilityThreads<TComment extends RunCommentVisibilityItem>(comments: TComment[]) {
  const sortedComments = [...comments].sort(compareRunComments)
  const threadsById = new Map<string, RunCommentVisibilityThread<TComment>>()
  const threads: RunCommentVisibilityThread<TComment>[] = []

  for (const comment of sortedComments) {
    if (comment.parentId) {
      const parentThread = threadsById.get(comment.parentId)

      if (parentThread) {
        parentThread.replies.push(comment)
        parentThread.replies.sort(compareRunComments)
        continue
      }
    }

    const nextThread: RunCommentVisibilityThread<TComment> = {
      ...comment,
      replies: [],
    }

    threads.push(nextThread)
    threadsById.set(comment.id, nextThread)
  }

  return threads
}

function filterVisibleCommentThreads<TComment extends RunCommentVisibilityItem>(
  threads: RunCommentVisibilityThread<TComment>[]
) {
  return threads.flatMap((thread) => {
    const visibleReplies = thread.replies.filter((reply) => !reply.deletedAt)

    if (thread.deletedAt && visibleReplies.length === 0) {
      return []
    }

    return [
      {
        ...thread,
        replies: visibleReplies,
      },
    ]
  })
}

function countVisibleCommentItems<TComment extends RunCommentVisibilityItem>(comments: TComment[]) {
  return filterVisibleCommentThreads(buildRunCommentVisibilityThreads(comments)).reduce(
    (totalCount, thread) => totalCount + 1 + thread.replies.length,
    0
  )
}

export function buildRunCommentThreads(comments: RunCommentItem[]) {
  return buildRunCommentVisibilityThreads(comments)
}

export function filterVisibleRunCommentThreads(threads: RunCommentThread[]) {
  return filterVisibleCommentThreads(threads)
}

export function flattenRunCommentThreads(threads: RunCommentThread[]) {
  return threads.flatMap((thread) => [thread, ...thread.replies])
}

export function countVisibleRunComments(comments: RunCommentItem[]) {
  return countVisibleCommentItems(comments)
}

export function countVisibleRunCommentRecords(comments: RunCommentVisibilityRecord[]) {
  return countVisibleCommentItems(comments)
}

export async function loadRunCommentVisibilitySummaryForRunIds(runIds: string[]): Promise<RunCommentVisibilitySummary> {
  return loadEntityCommentVisibilitySummaryForEntityIds('run', runIds)
}

export async function loadEntityCommentVisibilitySummaryForEntityIds(
  entityType: CommentEntityType,
  entityIds: string[]
): Promise<RunCommentVisibilitySummary> {
  if (entityIds.length === 0) {
    return {
      visibilityByEntityId: {},
      countsByEntityId: {},
      visibilityByRunId: {},
      countsByRunId: {},
    }
  }

  const uniqueEntityIds = Array.from(new Set(entityIds))
  const { data, error } = await supabase
    .from('run_comments')
    .select('id, entity_type, entity_id, parent_id, created_at, deleted_at')
    .eq('entity_type', entityType)
    .in('entity_id', uniqueEntityIds)

  if (error) {
    throw error
  }

  const visibilityByEntityId: Record<string, RunCommentVisibilityRecord[]> = {}
  const countsByEntityId: Record<string, number> = {}

  for (const entityId of uniqueEntityIds) {
    visibilityByEntityId[entityId] = []
    countsByEntityId[entityId] = 0
  }

  for (const row of (data as RunCommentCountRow[] | null) ?? []) {
    if (!visibilityByEntityId[row.entity_id]) {
      visibilityByEntityId[row.entity_id] = []
    }

    visibilityByEntityId[row.entity_id].push({
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      runId: row.entity_type === 'run' ? row.entity_id : null,
      parentId: row.parent_id,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
    })
  }

  for (const entityId of uniqueEntityIds) {
    countsByEntityId[entityId] = countVisibleCommentItems(visibilityByEntityId[entityId] ?? [])
  }

  return {
    visibilityByEntityId,
    countsByEntityId,
    visibilityByRunId: visibilityByEntityId,
    countsByRunId: countsByEntityId,
  }
}

export async function loadRunCommentVisibilityForRunIds(runIds: string[]) {
  const summary = await loadRunCommentVisibilitySummaryForRunIds(runIds)
  return summary.visibilityByEntityId
}

export async function loadRunCommentCountsForRunIds(runIds: string[]) {
  const summary = await loadRunCommentVisibilitySummaryForRunIds(runIds)
  return summary.countsByEntityId
}

export async function loadRunCommentAuthorProfile(userId: string): Promise<RunCommentAuthorIdentity> {
  const { data, error } = await supabase
    .from('profiles')
    .select('name, nickname, avatar_url')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw error
  }

  const profile = (data as { name?: string | null; nickname?: string | null; avatar_url?: string | null } | null) ?? null

  return {
    userId,
    displayName: profile?.name?.trim() || 'Бегун',
    nickname: profile?.nickname?.trim() || null,
    avatarUrl: profile?.avatar_url ?? null,
  }
}

export async function loadRunComments(runId: string, viewerUserId: string | null = null): Promise<RunCommentItem[]> {
  return loadEntityComments('run', runId, viewerUserId)
}

export async function loadRaceComments(raceId: string, viewerUserId: string | null = null): Promise<RunCommentItem[]> {
  return loadEntityComments('race', raceId, viewerUserId)
}

export async function loadEntityComments(
  entityType: CommentEntityType,
  entityId: string,
  viewerUserId: string | null = null
): Promise<RunCommentItem[]> {
  console.debug('[RunComments] rpc load start', {
    entityType,
    entityId,
    viewerUserId,
  })

  const { data: comments, error: commentsError } = await supabase.rpc('get_entity_comments_with_meta', {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_viewer_user_id: viewerUserId,
  })

  if (commentsError) {
    console.error('[RunComments] rpc load failed', {
      entityType,
      entityId,
      viewerUserId,
      commentsError,
    })
    throw commentsError
  }

  const mappedComments = ((comments as RunCommentApiPayload[] | null) ?? [])
    .map(mapRunCommentApiPayloadToItem)
    .sort(compareRunComments)

  console.debug('[RunComments] rpc load success', {
    entityType,
    entityId,
    viewerUserId,
    commentsCount: mappedComments.length,
  })

  return mappedComments
}

export function subscribeToRunCommentLikes(
  runId: string,
  handlers: SubscribeToRunCommentLikesHandlers
) {
  return subscribeToEntityCommentLikes('run', runId, handlers)
}

export function subscribeToEntityCommentLikes(
  entityType: CommentEntityType,
  entityId: string,
  handlers: SubscribeToRunCommentLikesHandlers
) {
  if (!entityId.trim()) {
    return () => {}
  }

  const channel = supabase
    .channel(`comment-likes-${entityType}-${entityId}-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'run_comment_likes',
      },
      (payload) => {
        const nextLike = payload.new as RunCommentLikeRealtimeRow

        if (nextLike.entity_type === entityType && nextLike.entity_id === entityId) {
          handlers.onInsert?.(nextLike)
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'run_comment_likes',
      },
      (payload) => {
        const nextLike = payload.old as RunCommentLikeRealtimeRow

        if (nextLike.entity_type === entityType && nextLike.entity_id === entityId) {
          handlers.onDelete?.(nextLike)
        }
      }
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}

export function subscribeToRunComments(
  runId: string,
  handlers: SubscribeToRunCommentsHandlers
) {
  return subscribeToEntityComments('run', runId, handlers)
}

export function subscribeToEntityComments(
  entityType: CommentEntityType,
  entityId: string,
  handlers: SubscribeToRunCommentsHandlers
) {
  if (!entityId.trim()) {
    return () => {}
  }

  const channel = supabase
    .channel(`comments-${entityType}-${entityId}-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'run_comments',
      },
      (payload) => {
        const nextComment = payload.new as RunCommentRealtimeRow

        if (nextComment.entity_type === entityType && nextComment.entity_id === entityId) {
          handlers.onInsert?.(nextComment)
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'run_comments',
      },
      (payload) => {
        const nextComment = payload.new as RunCommentRealtimeRow

        if (nextComment.entity_type === entityType && nextComment.entity_id === entityId) {
          handlers.onUpdate?.(nextComment)
        }
      }
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}

export function subscribeToFeedRunComments(handlers: SubscribeToRunCommentsHandlers) {
  const channel = supabase
    .channel(`run-comments-feed-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'run_comments',
      },
      (payload) => {
        handlers.onInsert?.(payload.new as RunCommentRealtimeRow)
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'run_comments',
      },
      (payload) => {
        handlers.onUpdate?.(payload.new as RunCommentRealtimeRow)
      }
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}
