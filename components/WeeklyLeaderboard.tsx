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

  return (
    <div className="mb-4 rounded-xl border bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-gray-500">🔥 Гонка недели</p>

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
        <p className="mt-3 text-sm text-gray-600">Не удалось загрузить рейтинг</p>
      ) : topRows.length === 0 ? (
        <p className="mt-3 text-sm text-gray-600">Нет данных</p>
      ) : (
        <div className="mt-3 space-y-2">
          {topRows.map((row) => (
            <div key={row.user_id} className="flex items-center justify-between gap-3 text-sm">
              <p className="min-w-0 truncate">
                {row.rank}. {row.displayName}
              </p>
              <p className="shrink-0 font-medium">{row.totalXp} XP</p>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && currentUserRow && !isCurrentUserInTop ? (
        <div className="mt-4 border-t pt-3">
          <p className="text-sm font-medium">
            Ты — {currentUserRow.rank} место · {currentUserRow.totalXp} XP
          </p>
          {gapToNext !== null && gapToNext > 0 ? (
            <p className="mt-1 text-sm text-gray-600">До следующего места: {gapToNext} XP</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
