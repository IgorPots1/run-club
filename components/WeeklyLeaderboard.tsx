'use client'

import type { WeeklyXpLeaderboard } from '@/lib/weekly-xp'

type WeeklyLeaderboardProps = {
  leaderboard: WeeklyXpLeaderboard | null
  currentUserId: string
  loading?: boolean
  error?: string
}

export default function WeeklyLeaderboard({
  leaderboard,
  currentUserId,
  loading = false,
  error = '',
}: WeeklyLeaderboardProps) {
  const topRows = Array.isArray(leaderboard?.topRows) ? leaderboard.topRows : []
  const currentUserRow = leaderboard?.currentUserRow ?? null
  const gapToNext = typeof leaderboard?.gapToNext === 'number' ? leaderboard.gapToNext : null
  const isCurrentUserInTop = topRows.some((row) => row.user_id === currentUserId)
  const shouldShowCurrentUserRow =
    Boolean(currentUserRow) &&
    !isCurrentUserInTop &&
    (topRows.length > 0 || (currentUserRow?.totalXp ?? 0) > 0)

  return (
    <div className="app-card mb-4 overflow-hidden rounded-xl border p-4 shadow-sm">
      <p className="app-text-secondary text-sm font-medium">🔥 Гонка недели</p>

      {loading ? (
        <>
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="skeleton-line h-4 w-32" />
              <div className="skeleton-line h-4 w-14" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="skeleton-line h-4 w-28" />
              <div className="skeleton-line h-4 w-14" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="skeleton-line h-4 w-24" />
              <div className="skeleton-line h-4 w-14" />
            </div>
          </div>
          <div className="mt-4 border-t pt-3">
            <div className="skeleton-line h-4 w-40" />
            <div className="skeleton-line mt-2 h-4 w-32" />
          </div>
        </>
      ) : error ? (
        <p className="app-text-secondary mt-3 text-sm">{error}</p>
      ) : topRows.length === 0 ? (
        <p className="app-text-secondary mt-3 text-sm">Пока нет данных за последние 7 дней</p>
      ) : (
        <div className="mt-3 space-y-2">
          {topRows.map((row) => (
            <div key={row.user_id} className="flex items-center justify-between gap-3 text-sm">
              <p className="app-text-primary min-w-0 flex-1 truncate">
                {row.rank}. {row.displayName}
              </p>
              <p className="app-text-primary shrink-0 font-medium">{row.totalXp} XP</p>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && shouldShowCurrentUserRow ? (
        <div className="mt-4 border-t pt-3">
          <p className="app-text-primary text-sm font-medium">
            Ты — {currentUserRow?.rank} место · {currentUserRow?.totalXp} XP
          </p>
          {gapToNext !== null && gapToNext > 0 ? (
            <p className="app-text-secondary mt-1 text-sm">До следующего места: {gapToNext} XP</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
