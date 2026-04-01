import { getProfileDisplayName } from './profiles'
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

type RunCommentCountRow = Pick<RunCommentRow, 'run_id'>

type ProfileRow = {
  id: string
  name: string | null
  nickname?: string | null
  email: string | null
  avatar_url?: string | null
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

const RUN_COMMENT_SELECT = 'id, run_id, user_id, parent_id, comment, created_at, edited_at, deleted_at'

function isMissingNicknameColumnError(error: { code?: string | null; message?: string | null }) {
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    Boolean(error.message?.includes('profiles.nickname')) ||
    Boolean(error.message?.includes("'nickname' column of 'profiles'"))
  )
}

async function loadProfilesForUserIds(userIds: string[]) {
  if (userIds.length === 0) {
    return {} as Record<string, ProfileRow | null>
  }

  const primaryResult = await supabase
    .from('profiles')
    .select('id, name, nickname, email, avatar_url')
    .in('id', userIds)

  if (!primaryResult.error) {
    return Object.fromEntries(((primaryResult.data as ProfileRow[] | null) ?? []).map((profile) => [profile.id, profile]))
  }

  if (!isMissingNicknameColumnError(primaryResult.error)) {
    throw primaryResult.error
  }

  const fallbackResult = await supabase
    .from('profiles')
    .select('id, name, email, avatar_url')
    .in('id', userIds)

  if (fallbackResult.error) {
    throw fallbackResult.error
  }

  const fallbackProfiles = (fallbackResult.data as Array<Omit<ProfileRow, 'nickname'>> | null) ?? []

  return Object.fromEntries(
    fallbackProfiles.map((profile) => [
      profile.id,
      {
        ...profile,
        nickname: null,
      } satisfies ProfileRow,
    ])
  )
}

function mapCommentAuthorIdentity(userId: string, profile: ProfileRow | null | undefined): RunCommentAuthorIdentity {
  return {
    userId,
    displayName: getProfileDisplayName(profile, 'Бегун'),
    nickname: profile?.nickname?.trim() || null,
    avatarUrl: profile?.avatar_url ?? null,
  }
}

function compareRunComments(left: Pick<RunCommentItem, 'createdAt' | 'id'>, right: Pick<RunCommentItem, 'createdAt' | 'id'>) {
  const createdAtComparison = left.createdAt.localeCompare(right.createdAt)

  if (createdAtComparison !== 0) {
    return createdAtComparison
  }

  return left.id.localeCompare(right.id)
}

function mapRunCommentRowToItem(comment: RunCommentRow, author: RunCommentAuthorIdentity): RunCommentItem {
  return {
    id: comment.id,
    runId: comment.run_id,
    userId: comment.user_id,
    parentId: comment.parent_id,
    comment: comment.comment,
    createdAt: comment.created_at,
    editedAt: comment.edited_at,
    deletedAt: comment.deleted_at,
    displayName: author.displayName,
    nickname: author.nickname,
    avatarUrl: author.avatarUrl,
  }
}

async function hydrateRunCommentRows(commentRows: RunCommentRow[]) {
  if (commentRows.length === 0) {
    return [] as RunCommentItem[]
  }

  const userIds = Array.from(new Set(commentRows.map((comment) => comment.user_id)))
  const profileById = await loadProfilesForUserIds(userIds)

  return commentRows
    .map((comment) => {
      const author = mapCommentAuthorIdentity(comment.user_id, profileById[comment.user_id])
      return mapRunCommentRowToItem(comment, author)
    })
    .sort(compareRunComments)
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
  authorIdentity?: RunCommentAuthorIdentity | null
}): RunCommentItem {
  const fallbackAuthor = params.authorIdentity ?? null

  return {
    id: params.commentRow.id,
    runId: params.commentRow.run_id,
    userId: params.commentRow.user_id,
    parentId: params.commentRow.parent_id,
    comment: params.commentRow.comment,
    createdAt: params.commentRow.created_at,
    editedAt: params.commentRow.edited_at,
    deletedAt: params.commentRow.deleted_at,
    displayName: params.existingComment?.displayName ?? fallbackAuthor?.displayName ?? 'Бегун',
    nickname: params.existingComment?.nickname ?? fallbackAuthor?.nickname ?? null,
    avatarUrl: params.existingComment?.avatarUrl ?? fallbackAuthor?.avatarUrl ?? null,
  }
}

export async function hydrateRunCommentRow(commentRow: RunCommentRow): Promise<RunCommentItem> {
  const hydratedComments = await hydrateRunCommentRows([commentRow])
  return hydratedComments[0]!
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
    return await hydrateRunCommentRow(commentRow)
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

  return hydrateRunCommentRow(createdCommentRow)
}

export async function updateRunComment(commentId: string, input: UpdateRunCommentInput) {
  const updatedCommentRow = await requestRunCommentMutation(`/api/run-comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      comment: input.comment,
    }),
  })

  return hydrateRunCommentRow(updatedCommentRow)
}

export async function deleteRunComment(commentId: string) {
  const deletedCommentRow = await requestRunCommentMutation(`/api/run-comments/${commentId}`, {
    method: 'DELETE',
  })

  return hydrateRunCommentRow(deletedCommentRow)
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
  const profilesByUserId = await loadProfilesForUserIds([userId])
  return mapCommentAuthorIdentity(userId, profilesByUserId[userId])
}

export async function loadRunComments(runId: string): Promise<RunCommentItem[]> {
  const { data: comments, error: commentsError } = await supabase
    .from('run_comments')
    .select(RUN_COMMENT_SELECT)
    .eq('run_id', runId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (commentsError) {
    throw commentsError
  }

  return hydrateRunCommentRows((comments as RunCommentRow[] | null) ?? [])
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
