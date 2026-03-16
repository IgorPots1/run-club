import { getProfileDisplayName } from './profiles'
import { supabase } from './supabase'

type RunCommentRow = {
  id: string
  run_id: string
  user_id: string
  comment: string
  created_at: string
}

type ProfileRow = {
  id: string
  name: string | null
  nickname?: string | null
  email: string | null
  avatar_url?: string | null
}

export type RunCommentItem = {
  id: string
  runId: string
  userId: string
  comment: string
  createdAt: string
  displayName: string
  avatarUrl: string | null
}

export async function createRunComment(runId: string, userId: string, comment: string) {
  const result = await supabase.from('run_comments').insert({
    run_id: runId,
    user_id: userId,
    comment,
  })

  return result
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

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name, nickname, email, avatar_url')
    .in('id', userIds)

  if (profilesError) {
    throw profilesError
  }

  const profileById = Object.fromEntries(((profiles as ProfileRow[] | null) ?? []).map((profile) => [profile.id, profile]))

  return commentRows.map((comment) => {
    const profile = profileById[comment.user_id]

    return {
      id: comment.id,
      runId: comment.run_id,
      userId: comment.user_id,
      comment: comment.comment,
      createdAt: comment.created_at,
      displayName: getProfileDisplayName(profile, 'Бегун'),
      avatarUrl: profile?.avatar_url ?? null,
    }
  })
}
