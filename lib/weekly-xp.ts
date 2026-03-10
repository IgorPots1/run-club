import { getProfileDisplayName } from './profiles'
import { supabase } from './supabase'

const XP_PER_LIKE = 5

type ProfileRow = {
  id: string
  name: string | null
  nickname?: string | null
  email: string | null
}

type RunRow = {
  id: string
  user_id: string
  xp: number | null
  created_at: string
}

type RunLikeRow = {
  run_id: string
  created_at: string
}

type UserChallengeRow = {
  user_id: string
  xp_awarded: number | null
  completed_at: string
}

export type WeeklyXpRow = {
  user_id: string
  displayName: string
  totalXp: number
  rank: number
}

export type WeeklyXpLeaderboard = {
  topRows: WeeklyXpRow[]
  currentUserRow: WeeklyXpRow | null
  gapToNext: number | null
}

export async function loadWeeklyXpLeaderboard(currentUserId: string): Promise<WeeklyXpLeaderboard> {
  const [
    { data: profiles, error: profilesError },
    { data: runs, error: runsError },
    { data: likes, error: likesError },
    { data: userChallenges, error: userChallengesError },
  ] = await Promise.all([
    supabase.from('profiles').select('*'),
    supabase.from('runs').select('id, user_id, xp, created_at'),
    supabase.from('run_likes').select('run_id, created_at'),
    supabase.from('user_challenges').select('user_id, xp_awarded, completed_at'),
  ])

  if (runsError || likesError) {
    throw new Error('Не удалось загрузить недельный рейтинг')
  }

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  const profileById = profilesError
    ? {}
    : Object.fromEntries(((profiles as ProfileRow[] | null) ?? []).map((profile) => [profile.id, profile]))
  const xpByUserId: Record<string, number> = {}
  const runOwnerById = Object.fromEntries(((runs as RunRow[] | null) ?? []).map((run) => [run.id, run.user_id]))

  for (const run of (runs as RunRow[] | null) ?? []) {
    if (new Date(run.created_at).getTime() < cutoff) continue
    xpByUserId[run.user_id] = (xpByUserId[run.user_id] ?? 0) + Number(run.xp ?? 0)
  }

  for (const like of (likes as RunLikeRow[] | null) ?? []) {
    if (new Date(like.created_at).getTime() < cutoff) continue
    const ownerId = runOwnerById[like.run_id]
    if (!ownerId) continue
    xpByUserId[ownerId] = (xpByUserId[ownerId] ?? 0) + XP_PER_LIKE
  }

  if (!userChallengesError) {
    for (const challenge of (userChallenges as UserChallengeRow[] | null) ?? []) {
      if (new Date(challenge.completed_at).getTime() < cutoff) continue
      xpByUserId[challenge.user_id] = (xpByUserId[challenge.user_id] ?? 0) + Number(challenge.xp_awarded ?? 0)
    }
  }

  const rows = Object.entries(xpByUserId)
    .map(([user_id, totalXp]) => {
      const profile = profileById[user_id]
      return {
        user_id,
        displayName: getProfileDisplayName(profile, 'Бегун'),
        totalXp,
        rank: 0,
      }
    })
    .sort((a, b) => b.totalXp - a.totalXp)
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }))

  const currentUserIndex = rows.findIndex((row) => row.user_id === currentUserId)
  const currentUserRow =
    (currentUserIndex >= 0 ? rows[currentUserIndex] : null) ??
    {
      user_id: currentUserId,
      displayName: getProfileDisplayName(profileById[currentUserId], 'Ты'),
      totalXp: 0,
      rank: rows.length + 1,
    }
  const previousRow = currentUserIndex > 0 ? rows[currentUserIndex - 1] : null

  return {
    topRows: rows.slice(0, 5),
    currentUserRow,
    gapToNext: previousRow ? Math.max(previousRow.totalXp - currentUserRow.totalXp, 0) : null,
  }
}
