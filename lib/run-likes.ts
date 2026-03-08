import { supabase } from './supabase'

export type RunLikesSummary = {
  likesByRunId: Record<string, number>
  likedRunIds: Set<string>
}

type RunLikeRow = {
  run_id: string
  user_id: string
}

export async function loadRunLikesSummary(currentUserId: string | null): Promise<RunLikesSummary> {
  const { data, error } = await supabase.from('run_likes').select('run_id, user_id')

  if (error) {
    throw error
  }

  const likesByRunId: Record<string, number> = {}
  const likedRunIds = new Set<string>()

  for (const like of (data as RunLikeRow[] | null) ?? []) {
    likesByRunId[like.run_id] = (likesByRunId[like.run_id] ?? 0) + 1

    if (like.user_id === currentUserId) {
      likedRunIds.add(like.run_id)
    }
  }

  return { likesByRunId, likedRunIds }
}

export async function toggleRunLike(runId: string, currentUserId: string, likedByMe: boolean) {
  return likedByMe
    ? supabase.from('run_likes').delete().eq('run_id', runId).eq('user_id', currentUserId)
    : supabase.from('run_likes').insert({ run_id: runId, user_id: currentUserId })
}
