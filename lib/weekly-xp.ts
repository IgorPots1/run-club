import { supabase } from './supabase'

type WeeklyXpRpcRow = {
  user_id: string
  display_name: string | null
  total_xp: number | string | null
  weekly_xp: number | string | null
  challenge_xp: number | string | null
  rank: number | string | null
}

type CurrentRaceWeekRpcRow = {
  id: string
  slug: string
  starts_at: string
  ends_at: string
  timezone: string
  status: 'scheduled' | 'active' | 'finalized'
  finalized_at: string | null
}

export type CurrentRaceWeek = {
  id: string
  slug: string
  startsAt: string
  endsAt: string
  timezone: string
  status: 'scheduled' | 'active' | 'finalized'
  finalizedAt: string | null
}

export type WeeklyXpRow = {
  user_id: string
  displayName: string
  totalXp: number
  rank: number
}

export type WeeklyXpLeaderboard = {
  week: CurrentRaceWeek | null
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

function mapCurrentRaceWeek(row: CurrentRaceWeekRpcRow | null): CurrentRaceWeek | null {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    slug: row.slug,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    status: row.status,
    finalizedAt: row.finalized_at,
  }
}

export async function loadWeeklyXpLeaderboard(currentUserId: string): Promise<WeeklyXpLeaderboard> {
  const [{ data: weekData, error: weekError }, { data, error }] = await Promise.all([
    supabase.rpc('get_current_race_week'),
    supabase.rpc('get_weekly_xp_leaderboard'),
  ])

  if (weekError) {
    throw new Error('Не удалось загрузить текущую неделю гонки')
  }

  if (error) {
    throw new Error('Не удалось загрузить недельный рейтинг')
  }

  const week = mapCurrentRaceWeek(((weekData as CurrentRaceWeekRpcRow[] | null) ?? [])[0] ?? null)
  const rows = ((data as WeeklyXpRpcRow[] | null) ?? []).map((row) => ({
    user_id: row.user_id,
    displayName: row.display_name?.trim() || 'Бегун',
    totalXp: toSafeNumber(row.total_xp ?? row.weekly_xp),
    rank: Math.max(0, toSafeNumber(row.rank)),
  }))

  if (!week) {
    return {
      week: null,
      rows: [],
      topRows: [],
      currentUserRow: null,
      gapToNext: null,
      gapToBehind: null,
    }
  }

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
    week,
    rows,
    topRows: rows.slice(0, 5),
    currentUserRow,
    gapToNext: previousRow ? Math.max(previousRow.totalXp - currentUserRow.totalXp, 0) : null,
    gapToBehind: nextRow ? Math.max(currentUserRow.totalXp - nextRow.totalXp, 0) : null,
  }
}
