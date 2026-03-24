import { getProfileDisplayName } from './profiles'
import { supabase } from './supabase'

type RunCommentRow = {
  id: string
  run_id: string
  user_id: string
  comment: string
  created_at: string
}

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
  comment: string
  createdAt: string
  displayName: string
  nickname: string | null
  avatarUrl: string | null
}

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

export async function createRunComment(runId: string, userId: string, comment: string) {
  const result = await supabase.from('run_comments').insert({
    run_id: runId,
    user_id: userId,
    comment,
  })

  return result
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
    .select('id, run_id, user_id, comment, created_at')
    .eq('run_id', runId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (commentsError) {
    throw commentsError
  }

  const commentRows = (comments as RunCommentRow[] | null) ?? []
  const userIds = Array.from(new Set(commentRows.map((comment) => comment.user_id)))

  if (userIds.length === 0) {
    return []
  }

  const profileById = await loadProfilesForUserIds(userIds)

  return commentRows.map((comment) => {
    const author = mapCommentAuthorIdentity(comment.user_id, profileById[comment.user_id])

    return {
      id: comment.id,
      runId: comment.run_id,
      userId: comment.user_id,
      comment: comment.comment,
      createdAt: comment.created_at,
      displayName: author.displayName,
      nickname: author.nickname,
      avatarUrl: author.avatarUrl,
    }
  })
}
