import { supabase } from './supabase'

const XP_PER_LIKE = 5

type RunOwnerRow = {
  id: string
  user_id: string
}

type RunLikeRow = {
  run_id: string
}

export async function loadLikeXpByUser() {
  const [{ data: runs, error: runsError }, { data: likes, error: likesError }] = await Promise.all([
    supabase.from('runs').select('id, user_id'),
    supabase.from('run_likes').select('run_id'),
  ])

  if (runsError || likesError) {
    return {}
  }

  const runOwnerById = Object.fromEntries(((runs as RunOwnerRow[] | null) ?? []).map((run) => [run.id, run.user_id]))
  const xpByUserId: Record<string, number> = {}

  for (const like of (likes as RunLikeRow[] | null) ?? []) {
    const ownerId = runOwnerById[like.run_id]
    if (!ownerId) continue
    xpByUserId[ownerId] = (xpByUserId[ownerId] ?? 0) + XP_PER_LIKE
  }

  return xpByUserId
}

export async function loadLikeXpByUserIds(userIds: string[]) {
  if (userIds.length === 0) {
    return {}
  }

  const { data: runs, error: runsError } = await supabase
    .from('runs')
    .select('id, user_id')
    .in('user_id', userIds)

  if (runsError) {
    return {}
  }

  const runOwnerById = Object.fromEntries(((runs as RunOwnerRow[] | null) ?? []).map((run) => [run.id, run.user_id]))
  const runIds = Object.keys(runOwnerById)

  if (runIds.length === 0) {
    return {}
  }

  const { data: likes, error: likesError } = await supabase
    .from('run_likes')
    .select('run_id')
    .in('run_id', runIds)

  if (likesError) {
    return {}
  }

  const xpByUserId: Record<string, number> = {}

  for (const like of (likes as RunLikeRow[] | null) ?? []) {
    const ownerId = runOwnerById[like.run_id]
    if (!ownerId) continue
    xpByUserId[ownerId] = (xpByUserId[ownerId] ?? 0) + XP_PER_LIKE
  }

  return xpByUserId
}
