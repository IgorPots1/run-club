import { RUN_COMMENT_PLACEHOLDER_TEXT } from './run-comments-constants'
import { supabase } from './supabase'

type RunCommentRow = {
  id: string
  run_id: string
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

type RunCommentCountRow = Pick<RunCommentRow, 'id' | 'run_id' | 'parent_id' | 'created_at' | 'deleted_at'>
export type RunCommentVisibilityRecord = {
  id: string
  runId: string
  parentId: string | null
  createdAt: string
  deletedAt: string | null
}

export type RunCommentVisibilitySummary = {
  visibilityByRunId: Record<string, RunCommentVisibilityRecord[]>
  countsByRunId: Record<string, number>
}

export type RunCommentLikeRealtimeRow = {
  comment_id: string
  run_id: string
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
  runId: string
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

export async function createRunComment(runId: string, input: CreateRunCommentInput) {
  return requestRunCommentMutation(`/api/runs/${runId}/comments`, {
    method: 'POST',
    body: JSON.stringify({
      comment: input.comment,
      parentId: input.parentId ?? null,
    }),
  })
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
  if (runIds.length === 0) {
    return {
      visibilityByRunId: {},
      countsByRunId: {},
    }
  }

  const uniqueRunIds = Array.from(new Set(runIds))
  const { data, error } = await supabase
    .from('run_comments')
    .select('id, run_id, parent_id, created_at, deleted_at')
    .in('run_id', uniqueRunIds)

  if (error) {
    throw error
  }

  const visibilityByRunId: Record<string, RunCommentVisibilityRecord[]> = {}
  const countsByRunId: Record<string, number> = {}

  for (const runId of uniqueRunIds) {
    visibilityByRunId[runId] = []
    countsByRunId[runId] = 0
  }

  for (const row of (data as RunCommentCountRow[] | null) ?? []) {
    if (!visibilityByRunId[row.run_id]) {
      visibilityByRunId[row.run_id] = []
    }

    visibilityByRunId[row.run_id].push({
      id: row.id,
      runId: row.run_id,
      parentId: row.parent_id,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
    })
  }

  for (const runId of uniqueRunIds) {
    countsByRunId[runId] = countVisibleCommentItems(visibilityByRunId[runId] ?? [])
  }

  return {
    visibilityByRunId,
    countsByRunId,
  }
}

export async function loadRunCommentVisibilityForRunIds(runIds: string[]) {
  const summary = await loadRunCommentVisibilitySummaryForRunIds(runIds)
  return summary.visibilityByRunId
}

export async function loadRunCommentCountsForRunIds(runIds: string[]) {
  const summary = await loadRunCommentVisibilitySummaryForRunIds(runIds)
  return summary.countsByRunId
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
  console.debug('[RunComments] rpc load start', {
    runId,
    viewerUserId,
  })

  const { data: comments, error: commentsError } = await supabase.rpc('get_run_comments_with_meta', {
    run_id: runId,
    viewer_user_id: viewerUserId,
  })

  if (commentsError) {
    console.error('[RunComments] rpc load failed', {
      runId,
      viewerUserId,
      commentsError,
    })
    throw commentsError
  }

  const mappedComments = ((comments as RunCommentApiPayload[] | null) ?? [])
    .map(mapRunCommentApiPayloadToItem)
    .sort(compareRunComments)

  console.debug('[RunComments] rpc load success', {
    runId,
    viewerUserId,
    commentsCount: mappedComments.length,
  })

  return mappedComments
}

export function subscribeToRunCommentLikes(
  runId: string,
  handlers: SubscribeToRunCommentLikesHandlers
) {
  if (!runId.trim()) {
    return () => {}
  }

  const channel = supabase
    .channel(`run-comment-likes-${runId}-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'run_comment_likes',
        filter: `run_id=eq.${runId}`,
      },
      (payload) => {
        handlers.onInsert?.(payload.new as RunCommentLikeRealtimeRow)
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'run_comment_likes',
        filter: `run_id=eq.${runId}`,
      },
      (payload) => {
        handlers.onDelete?.(payload.old as RunCommentLikeRealtimeRow)
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
  if (!runId.trim()) {
    return () => {}
  }

  const channel = supabase
    .channel(`run-comments-${runId}-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'run_comments',
        filter: `run_id=eq.${runId}`,
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
        filter: `run_id=eq.${runId}`,
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
