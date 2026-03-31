import { supabase } from './supabase'

type WeeklyXpRpcRow = {
  user_id: string
  display_name: string | null
  total_xp: number | string | null
  weekly_xp: number | string | null
  challenge_xp: number | string | null
  rank: number | string | null
}

export type WeeklyXpRow = {
  user_id: string
  displayName: string
  totalXp: number
  rank: number
}

export type WeeklyXpLeaderboard = {
  rows: WeeklyXpRow[]
  topRows: WeeklyXpRow[]
  currentUserRow: WeeklyXpRow | null
  gapToNext: number | null
  gapToBehind: number | null
}

function toSafeNumber(value: number | string | null | undefined) {
  const numericValue = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(numericValue) ? Number(numericValue) : 0
}

export async function loadWeeklyXpLeaderboard(currentUserId: string): Promise<WeeklyXpLeaderboard> {
  const { data, error } = await supabase.rpc('get_weekly_xp_leaderboard')

  if (error) {
    throw new Error('Не удалось загрузить недельный рейтинг')
  }

  const rows = ((data as WeeklyXpRpcRow[] | null) ?? []).map((row) => ({
    user_id: row.user_id,
    displayName: row.display_name?.trim() || 'Бегун',
    totalXp: toSafeNumber(row.total_xp ?? row.weekly_xp),
    rank: Math.max(0, toSafeNumber(row.rank)),
  }))

  const currentUserIndex = rows.findIndex((row) => row.user_id === currentUserId)
  const currentUserRow =
    (currentUserIndex >= 0 ? rows[currentUserIndex] : null) ??
    {
      user_id: currentUserId,
      displayName: 'Ты',
      totalXp: 0,
      rank: rows.length + 1,
    }
  const previousRow = currentUserIndex > 0 ? rows[currentUserIndex - 1] : null
  const nextRow = currentUserIndex >= 0 && currentUserIndex < rows.length - 1 ? rows[currentUserIndex + 1] : null

  return {
    rows,
    topRows: rows.slice(0, 5),
    currentUserRow,
    gapToNext: previousRow ? Math.max(previousRow.totalXp - currentUserRow.totalXp, 0) : null,
    gapToBehind: nextRow ? Math.max(currentUserRow.totalXp - nextRow.totalXp, 0) : null,
  }
}
