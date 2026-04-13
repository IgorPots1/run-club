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
  compact?: boolean
  href?: string
}

function getMotivationHint(gapToNext: number | null) {
  if (typeof gapToNext !== 'number' || gapToNext <= 0 || gapToNext > 50) {
    return ''
  }

  return 'Ещё 1 тренировка - и ты выше'
}

export default function WeeklyLeaderboard({
  leaderboard,
  currentUserId,
  loading = false,
  error = '',
  compact = false,
  href,
}: WeeklyLeaderboardProps) {
  const week = leaderboard?.week ?? null
  const topRows = Array.isArray(leaderboard?.topRows) ? leaderboard.topRows : []
  const currentUserRow = leaderboard?.currentUserRow ?? null
  const gapToNext = typeof leaderboard?.gapToNext === 'number' ? leaderboard.gapToNext : null
  const gapToBehind = typeof leaderboard?.gapToBehind === 'number' ? leaderboard.gapToBehind : null
  const compactTopRows = topRows.slice(0, 3)
  const compactCurrentUserRow = topRows.find((row) => row.user_id === currentUserId) ?? currentUserRow
  const isCurrentUserAlreadyInTopRows =
    Boolean(currentUserRow) && topRows.some((row) => row.user_id === currentUserRow?.user_id)
  const isCurrentUserAlreadyInCompactRows =
    Boolean(compactCurrentUserRow) && compactTopRows.some((row) => row.user_id === compactCurrentUserRow?.user_id)
  const shouldShowCurrentUserRow =
    Boolean(currentUserRow) &&
    !isCurrentUserAlreadyInTopRows &&
    (topRows.length > 0 || (currentUserRow?.totalXp ?? 0) > 0)
  const shouldShowCompactCurrentUserRow =
    Boolean(compactCurrentUserRow) &&
    !isCurrentUserAlreadyInCompactRows &&
    (topRows.length > 0 || (compactCurrentUserRow?.totalXp ?? 0) > 0)
  const currentUserSummary =
    currentUserRow && currentUserRow.rank > 0
      ? `Ты — ${currentUserRow.rank} место · ${currentUserRow.totalXp} XP`
      : ''
  const motivationHint = getMotivationHint(gapToNext)
  const compactGapLine =
    gapToNext !== null && gapToNext > 0
      ? `До следующего места: +${gapToNext} XP`
      : gapToBehind !== null && gapToBehind > 0
        ? `Отрыв от следующего: ${gapToBehind} XP`
        : ''
  const compactRows = shouldShowCompactCurrentUserRow && compactCurrentUserRow
    ? [...compactTopRows, compactCurrentUserRow]
    : compactTopRows
  const cardClassName = 'app-card mb-4 min-h-[188px] overflow-hidden rounded-xl border p-4 shadow-sm'
  const isCardClickable = typeof href === 'string' && href.length > 0

  const content = (
    <>
      {compact && !loading && !error && week ? (
        <div className="flex items-center justify-between gap-3">
          <p className="app-text-secondary flex min-w-0 items-center gap-2 text-sm font-medium">
            <Flame className="h-4 w-4 shrink-0" strokeWidth={1.9} />
            <span>Гонка недели</span>
          </p>
          <span className="app-text-secondary shrink-0 text-sm">{formatRaceWeekDateRange(week)}</span>
        </div>
      ) : (
        <p className="app-text-secondary flex items-center gap-2 text-sm font-medium">
          <Flame className="h-4 w-4 shrink-0" strokeWidth={1.9} />
          <span>Гонка недели</span>
        </p>
      )}
      {!compact && !loading && !error && week ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="app-text-secondary rounded-full border px-2 py-1 text-[11px] font-medium">
            Текущая неделя
          </span>
          <span className="app-text-secondary text-sm">{formatRaceWeekDateRange(week)}</span>
        </div>
      ) : null}
      {!compact && !loading && !error && currentUserSummary ? (
        <p className="app-text-primary mt-3 text-sm font-medium">{currentUserSummary}</p>
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
      ) : compact ? (
        compactRows.length > 0 ? (
          <div className="mt-3 space-y-2">
            {compactRows.map((row) => {
              const isCurrentUser = row.user_id === currentUserId

              return (
                <div
                  key={row.user_id}
                  className={
                    isCurrentUser
                      ? 'app-surface-muted rounded-xl px-3 py-3 ring-1 ring-black/10 dark:ring-white/15'
                      : 'px-3 py-2'
                  }
                >
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <p className="app-text-primary min-w-0 flex-1 truncate font-medium">
                      {row.rank}. {row.displayName}
                      {isCurrentUser ? (
                        <span className="app-text-secondary ml-2 rounded-full border px-2 py-0.5 text-[11px] font-medium">
                          Ты
                        </span>
                      ) : null}
                    </p>
                    <p className="app-text-primary shrink-0 font-medium">{row.totalXp} XP</p>
                  </div>
                  {isCurrentUser && compactGapLine ? (
                    <p className="app-text-secondary mt-2 text-xs">{compactGapLine}</p>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="app-text-secondary mt-3 text-sm">Пока в текущей неделе нет результатов.</p>
        )
      ) : topRows.length === 0 ? (
        <p className="app-text-secondary mt-3 text-sm">Пока в текущей неделе нет результатов.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {topRows.map((row) => {
            const isCurrentUser = row.user_id === currentUserId
            const rowClassName =
              isCurrentUser
                ? 'app-surface-muted rounded-xl px-3 py-3 ring-1 ring-black/10 dark:ring-white/15'
                : 'px-3 py-2'
            const rowContent = (
              <>
                <div className="flex items-center justify-between gap-3 text-sm">
                  {isCardClickable ? (
                    <div className="app-text-primary min-w-0 flex-1 truncate">
                      {row.rank}. {row.displayName}
                      {isCurrentUser ? (
                        <span className="app-text-secondary ml-2 rounded-full border px-2 py-0.5 text-[11px] font-medium">
                          Ты
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <Link href={`/users/${row.user_id}`} className="app-text-primary min-w-0 flex-1 truncate">
                      {row.rank}. {row.displayName}
                      {isCurrentUser ? (
                        <span className="app-text-secondary ml-2 rounded-full border px-2 py-0.5 text-[11px] font-medium">
                          Ты
                        </span>
                      ) : null}
                    </Link>
                  )}
                  <p className="app-text-primary shrink-0 font-medium">{row.totalXp} XP</p>
                </div>
                {isCurrentUser ? (
                  <div className="mt-2 space-y-1">
                    {gapToNext !== null && gapToNext > 0 ? (
                      <p className="app-text-secondary text-xs">До следующего места: +{gapToNext} XP</p>
                    ) : null}
                    {gapToBehind !== null && gapToBehind > 0 ? (
                      <p className="app-text-secondary text-xs">Отрыв от следующего: {gapToBehind} XP</p>
                    ) : null}
                    {motivationHint ? (
                      <p className="app-text-secondary text-xs">{motivationHint}</p>
                    ) : null}
                  </div>
                ) : null}
              </>
            )

            return (
              <div key={row.user_id} className={rowClassName}>
                {rowContent}
              </div>
            )
          })}
        </div>
      )}

      {!compact && !loading && !error && shouldShowCurrentUserRow ? (
        <div className="app-surface-muted mt-4 rounded-xl px-3 py-3 ring-1 ring-black/10 dark:ring-white/15">
          <div className="flex items-center justify-between gap-3 text-sm">
            <p className="app-text-primary min-w-0 flex-1 font-medium">
              {currentUserRow?.rank}. {currentUserRow?.displayName}
              <span className="app-text-secondary ml-2 rounded-full border px-2 py-0.5 text-[11px] font-medium">
                Ты
              </span>
            </p>
            <p className="app-text-primary shrink-0 font-medium">{currentUserRow?.totalXp} XP</p>
          </div>
          <div className="mt-2 space-y-1">
            {gapToNext !== null && gapToNext > 0 ? (
              <p className="app-text-secondary text-xs">До следующего места: +{gapToNext} XP</p>
            ) : null}
            {gapToBehind !== null && gapToBehind > 0 ? (
              <p className="app-text-secondary text-xs">Отрыв от следующего: {gapToBehind} XP</p>
            ) : null}
            {motivationHint ? (
              <p className="app-text-secondary text-xs">{motivationHint}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )

  if (isCardClickable) {
    return (
      <Link
        href={href}
        aria-label="Открыть гонку недели"
        className={`block transition-[transform,box-shadow] hover:shadow-md active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/20 ${cardClassName}`}
      >
        {content}
      </Link>
    )
  }

  return <div className={cardClassName}>{content}</div>
}
