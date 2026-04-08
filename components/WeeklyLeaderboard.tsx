'use client'

import Link from 'next/link'
import { Flame } from 'lucide-react'
import { formatRaceWeekDateRange } from '@/lib/race-badges'
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
  const week = leaderboard?.week ?? null
  const topRows = Array.isArray(leaderboard?.topRows) ? leaderboard.topRows : []
  const currentUserRow = leaderboard?.currentUserRow ?? null
  const gapToNext = typeof leaderboard?.gapToNext === 'number' ? leaderboard.gapToNext : null
  const isCurrentUserInTop = topRows.some((row) => row.user_id === currentUserId)
  const shouldShowCurrentUserRow =
    Boolean(currentUserRow) &&
    !isCurrentUserInTop &&
    (topRows.length > 0 || (currentUserRow?.totalXp ?? 0) > 0)

  return (
    <div className="app-card mb-4 min-h-[188px] overflow-hidden rounded-xl border p-4 shadow-sm">
      <p className="app-text-secondary flex items-center gap-2 text-sm font-medium">
        <Flame className="h-4 w-4 shrink-0" strokeWidth={1.9} />
        <span>Гонка недели</span>
      </p>
      {!loading && !error && week ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="app-text-secondary rounded-full border px-2 py-1 text-[11px] font-medium">
            Текущая неделя
          </span>
          <span className="app-text-secondary text-sm">{formatRaceWeekDateRange(week)}</span>
        </div>
      ) : null}

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
      ) : !week ? (
        <div className="mt-3">
          <p className="app-text-secondary text-sm">Сейчас нет активной недели гонки.</p>
          <p className="app-text-secondary mt-2 text-sm">Открой экран гонки, чтобы посмотреть статус и последние итоги.</p>
        </div>
      ) : topRows.length === 0 ? (
        <p className="app-text-secondary mt-3 text-sm">Пока в текущей неделе нет результатов.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {topRows.map((row) => (
            <div key={row.user_id} className="flex items-center justify-between gap-3 text-sm">
              <Link href={`/users/${row.user_id}`} className="app-text-primary min-w-0 flex-1 truncate">
                {row.rank}. {row.displayName}
              </Link>
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
