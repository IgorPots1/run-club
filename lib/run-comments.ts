import { supabase } from './supabase'

// #region agent log
fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b47950'},body:JSON.stringify({sessionId:'b47950',runId:'build-import-graph',hypothesisId:'H2',location:'lib/run-comments.ts:3',message:'run-comments module evaluated',data:{hasWindow:typeof window!=='undefined',supabaseImport:'./supabase'},timestamp:Date.now()})}).catch(()=>{});
// #endregion

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

type RunCommentSnapshotRow = RunCommentRow & {
  display_name: string | null
  nickname: string | null
  avatar_url: string | null
}

type RunCommentCountRow = Pick<RunCommentRow, 'run_id'>

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
}

export type RunCommentThread = RunCommentItem & {
  replies: RunCommentItem[]
}

type RunCommentMutationResponse = {
  ok?: boolean
  error?: string
  comment?: RunCommentRow
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

function compareRunComments(left: Pick<RunCommentItem, 'createdAt' | 'id'>, right: Pick<RunCommentItem, 'createdAt' | 'id'>) {
  const createdAtComparison = left.createdAt.localeCompare(right.createdAt)

  if (createdAtComparison !== 0) {
    return createdAtComparison
  }

  return left.id.localeCompare(right.id)
}

function mapRunCommentSnapshotRowToItem(comment: RunCommentSnapshotRow): RunCommentItem {
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
  }
}

async function loadRunCommentSnapshot(commentId: string, runId: string, viewerUserId: string | null = null) {
  const { data, error } = await supabase
    .rpc('get_run_comments_with_meta', {
      p_run_id: runId,
      p_viewer_user_id: viewerUserId,
    })
    .eq('id', commentId)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    throw new Error('run_comment_snapshot_not_found')
  }

  return mapRunCommentSnapshotRowToItem(data as RunCommentSnapshotRow)
}

async function requestRunCommentMutation(path: string, init: RequestInit): Promise<RunCommentRow> {
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

  return result.comment
}

export function mergeRunCommentRealtimeRow(params: {
  commentRow: RunCommentRealtimeRow
  existingComment?: RunCommentItem | null
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
    displayName: params.existingComment?.displayName ?? 'Бегун',
    nickname: params.existingComment?.nickname ?? null,
    avatarUrl: params.existingComment?.avatarUrl ?? null,
  }
}

export async function resolveRunCommentRealtimeItem(
  commentRow: RunCommentRealtimeRow,
  existingComment?: RunCommentItem | null
): Promise<RunCommentItem> {
  if (existingComment) {
    return mergeRunCommentRealtimeRow({
      commentRow,
      existingComment,
    })
  }

  try {
    return await loadRunCommentSnapshot(commentRow.id, commentRow.run_id)
  } catch {
    return mergeRunCommentRealtimeRow({
      commentRow,
    })
  }
}

export async function createRunComment(runId: string, input: CreateRunCommentInput) {
  const createdCommentRow = await requestRunCommentMutation(`/api/runs/${runId}/comments`, {
    method: 'POST',
    body: JSON.stringify({
      comment: input.comment,
      parentId: input.parentId ?? null,
    }),
  })

  return loadRunCommentSnapshot(createdCommentRow.id, createdCommentRow.run_id)
}

export async function updateRunComment(commentId: string, input: UpdateRunCommentInput) {
  const updatedCommentRow = await requestRunCommentMutation(`/api/run-comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      comment: input.comment,
    }),
  })

  return loadRunCommentSnapshot(updatedCommentRow.id, updatedCommentRow.run_id)
}

export async function deleteRunComment(commentId: string) {
  const deletedCommentRow = await requestRunCommentMutation(`/api/run-comments/${commentId}`, {
    method: 'DELETE',
  })

  return loadRunCommentSnapshot(deletedCommentRow.id, deletedCommentRow.run_id)
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

export function buildRunCommentThreads(comments: RunCommentItem[]) {
  const sortedComments = [...comments].sort(compareRunComments)
  const threadsById = new Map<string, RunCommentThread>()
  const threads: RunCommentThread[] = []

  for (const comment of sortedComments) {
    if (comment.parentId) {
      const parentThread = threadsById.get(comment.parentId)

      if (parentThread) {
        parentThread.replies.push(comment)
        parentThread.replies.sort(compareRunComments)
        continue
      }
    }

    const nextThread: RunCommentThread = {
      ...comment,
      replies: [],
    }

    threads.push(nextThread)
    threadsById.set(comment.id, nextThread)
  }

  return threads
}

export function filterVisibleRunCommentThreads(threads: RunCommentThread[]) {
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

export function flattenRunCommentThreads(threads: RunCommentThread[]) {
  return threads.flatMap((thread) => [thread, ...thread.replies])
}

export function countVisibleRunComments(comments: RunCommentItem[]) {
  return flattenRunCommentThreads(filterVisibleRunCommentThreads(buildRunCommentThreads(comments))).length
}

export async function loadRunCommentCountsForRunIds(runIds: string[]) {
  if (runIds.length === 0) {
    return {} as Record<string, number>
  }

  const uniqueRunIds = Array.from(new Set(runIds))
  const { data, error } = await supabase
    .from('run_comments')
    .select('run_id')
    .in('run_id', uniqueRunIds)

  if (error) {
    throw error
  }

  const countsByRunId: Record<string, number> = {}

  for (const runId of uniqueRunIds) {
    countsByRunId[runId] = 0
  }

  for (const row of (data as RunCommentCountRow[] | null) ?? []) {
    countsByRunId[row.run_id] = (countsByRunId[row.run_id] ?? 0) + 1
  }

  return countsByRunId
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
  const { data: comments, error: commentsError } = await supabase.rpc('get_run_comments_with_meta', {
    p_run_id: runId,
    p_viewer_user_id: viewerUserId,
  })

  if (commentsError) {
    throw commentsError
  }

  return ((comments as RunCommentSnapshotRow[] | null) ?? [])
    .map(mapRunCommentSnapshotRowToItem)
    .sort(compareRunComments)
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
