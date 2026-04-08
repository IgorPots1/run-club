'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import WorkoutDetailShell from '@/components/WorkoutDetailShell'
import { getBootstrapUser } from '@/lib/auth'
import { formatRaceWeekDateRange } from '@/lib/race-badges'
import { loadLatestFinalizedRaceWeek, type RaceWeekSummary } from '@/lib/race-results-client'
import { loadWeeklyXpLeaderboard, type WeeklyXpLeaderboard } from '@/lib/weekly-xp'
import type { User } from '@supabase/supabase-js'

function getStatusText(args: {
  rank: number
  gapToNext: number | null
  gapToBehind: number | null
}) {
  const { rank, gapToNext, gapToBehind } = args

  if (rank > 0 && rank <= 3) {
    return 'Ты в топе'
  }

  if (typeof gapToNext === 'number' && gapToNext <= 20) {
    return 'Почти догнал'
  }

  if (typeof gapToBehind === 'number' && gapToBehind <= 20) {
    return 'Под давлением'
  }

  return ''
}

function getProjectedRank(args: {
  rows: WeeklyXpLeaderboard['rows']
  currentUserId: string
  projectedXp: number
}) {
  const { rows, currentUserId, projectedXp } = args

  const higherOrTiedRowsCount = rows.filter((row) => {
    if (row.user_id === currentUserId) {
      return false
    }

    return row.totalXp >= projectedXp
  }).length

  return higherOrTiedRowsCount + 1
}

function getRowHighlightClass(args: {
  isCurrentUser: boolean
  rank: number
  gapAbove: number | null
  gapBelow: number | null
}) {
  const { isCurrentUser, rank, gapAbove, gapBelow } = args

  if (isCurrentUser) {
    return 'app-card app-surface-muted ring-1 ring-black/10 dark:ring-white/15'
  }

  if (rank > 0 && rank <= 3) {
    return 'app-card bg-black/[0.03] ring-1 ring-black/5 dark:bg-white/[0.05] dark:ring-white/10'
  }

  const nearestGap = [gapAbove, gapBelow]
    .filter((gap): gap is number => typeof gap === 'number')
    .reduce<number | null>((smallestGap, gap) => {
      if (smallestGap === null) {
        return gap
      }

      return Math.min(smallestGap, gap)
    }, null)

  if (nearestGap !== null && nearestGap <= 20) {
    return 'app-card bg-black/[0.025] ring-1 ring-black/5 dark:bg-white/[0.04] dark:ring-white/10'
  }

  if (nearestGap !== null && nearestGap <= 40) {
    return 'app-card bg-black/[0.015] dark:bg-white/[0.025]'
  }

  return 'app-card'
}

export default function RacePage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loadingUser, setLoadingUser] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function loadUser() {
      try {
        if (!isMounted) return

        const nextUser = await getBootstrapUser()
        setUser(nextUser)

        if (!nextUser) {
          router.replace('/login')
        }
      } finally {
        if (isMounted) {
          setLoadingUser(false)
        }
      }
    }

    void loadUser()

    return () => {
      isMounted = false
    }
  }, [router])

  const {
    data: leaderboard,
    error,
    isLoading,
  } = useSWR<WeeklyXpLeaderboard>(
    user ? (['weekly-race', user.id] as const) : null,
    ([, userId]: readonly [string, string]) => loadWeeklyXpLeaderboard(userId),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      dedupingInterval: 15000,
      focusThrottleInterval: 15000,
    }
  )
  const {
    data: latestFinalizedRaceWeek,
    error: latestFinalizedRaceWeekError,
    isLoading: latestFinalizedRaceWeekLoading,
  } = useSWR<RaceWeekSummary | null>(
    user ? (['latest-finalized-race-week', user.id] as const) : null,
    () => loadLatestFinalizedRaceWeek(),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      dedupingInterval: 60000,
      focusThrottleInterval: 60000,
    }
  )

  const week = leaderboard?.week ?? null
  const rows = Array.isArray(leaderboard?.rows) ? leaderboard.rows : []
  const currentUserRow = leaderboard?.currentUserRow ?? null
  const gapToNext = typeof leaderboard?.gapToNext === 'number' ? leaderboard.gapToNext : null
  const gapToBehind = typeof leaderboard?.gapToBehind === 'number' ? leaderboard.gapToBehind : null
  const currentUserIndex = currentUserRow ? rows.findIndex((row) => row.user_id === currentUserRow.user_id) : -1
  const userAbove = currentUserIndex > 0 ? rows[currentUserIndex - 1] : null
  const userBelow = currentUserIndex >= 0 && currentUserIndex < rows.length - 1 ? rows[currentUserIndex + 1] : null
  const thirdPlaceRow = rows.find((row) => row.rank === 3) ?? null
  const gapToTop3 = useMemo(() => {
    if (!currentUserRow || currentUserRow.rank <= 3 || !thirdPlaceRow) {
      return null
    }

    return Math.max(thirdPlaceRow.totalXp - currentUserRow.totalXp, 0)
  }, [currentUserRow, thirdPlaceRow])
  const movementEstimateText = useMemo(() => {
    if (!currentUserRow || rows.length === 0) {
      return ''
    }

    const projectedRank50 = getProjectedRank({
      rows,
      currentUserId: currentUserRow.user_id,
      projectedXp: currentUserRow.totalXp + 50,
    })
    const projectedRank100 = getProjectedRank({
      rows,
      currentUserId: currentUserRow.user_id,
      projectedXp: currentUserRow.totalXp + 100,
    })

    const gainedPositions50 = Math.max((currentUserRow.rank ?? 0) - projectedRank50, 0)
    const gainedPositions100 = Math.max((currentUserRow.rank ?? 0) - projectedRank100, 0)
    const bestGain = Math.max(gainedPositions50, gainedPositions100)

    if (bestGain <= 0) {
      return ''
    }

    return `Еще одна тренировка может поднять тебя на ${bestGain} ${bestGain === 1 ? 'позицию' : bestGain < 5 ? 'позиции' : 'позиций'}`
  }, [currentUserRow, rows])
  const statusText = useMemo(
    () => getStatusText({
      rank: currentUserRow?.rank ?? 0,
      gapToNext,
      gapToBehind,
    }),
    [currentUserRow?.rank, gapToBehind, gapToNext]
  )
  const showHistoryLink = !latestFinalizedRaceWeekLoading && Boolean(latestFinalizedRaceWeek?.id)

  if (loadingUser) {
    return <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">Загрузка...</main>
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

  return (
    <WorkoutDetailShell
      title="Гонка недели"
      fallbackHref="/dashboard"
      scrollContentClassName="pt-4 md:pt-4"
    >
        <div className="app-card rounded-2xl border p-4 shadow-sm">
          <h1 className="app-text-primary text-2xl font-bold">Гонка недели</h1>
          {week ? (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="app-text-secondary rounded-full border px-2 py-1 text-[11px] font-medium">
                  Текущая неделя
                </span>
                <span className="app-text-secondary rounded-full border px-2 py-1 text-[11px] font-medium">
                  Статус: {week.status === 'active' ? 'активна' : 'завершена'}
                </span>
              </div>
              <p className="app-text-secondary mt-2 text-sm">Период: {formatRaceWeekDateRange(week)}</p>
            </>
          ) : (
            <p className="app-text-secondary mt-2 text-sm">Сейчас активная неделя гонки не запущена.</p>
          )}

          {latestFinalizedRaceWeekError ? (
            <p className="mt-3 text-sm text-red-600">Не удалось загрузить последнюю завершенную неделю</p>
          ) : showHistoryLink ? (
            <Link
              href={`/race/history/${latestFinalizedRaceWeek!.id}`}
              className="app-button-secondary mt-4 inline-flex min-h-11 items-center rounded-lg border px-4 py-2 text-sm"
            >
              Итоги прошлой недели
            </Link>
          ) : null}

          {isLoading ? (
            <div className="mt-4 space-y-3">
              {[0, 1, 2, 3, 4].map((item) => (
                <div key={item} className="flex items-center justify-between gap-3">
                  <div className="skeleton-line h-4 w-32" />
                  <div className="skeleton-line h-4 w-14" />
                </div>
              ))}
            </div>
          ) : error ? (
            <p className="app-text-secondary mt-4 text-sm">Не удалось загрузить гонку недели</p>
          ) : !week ? (
            <div className="app-surface-muted mt-4 rounded-2xl p-4">
              <p className="app-text-primary text-sm font-medium">Активной фиксированной недели сейчас нет.</p>
              <p className="app-text-secondary mt-2 text-sm">
                Когда новая неделя будет открыта в `race_weeks`, здесь появится ее живой рейтинг и текущий статус.
              </p>
            </div>
          ) : rows.length === 0 ? (
            <p className="app-text-secondary mt-4 text-sm">Пока в текущей неделе нет результатов.</p>
          ) : (
            <>
              {currentUserRow ? (
                <div className="app-surface-muted mt-4 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="app-text-primary text-sm font-semibold">
                        Ты — {currentUserRow.rank} место
                      </p>
                      <p className="app-text-secondary mt-1 text-sm">{currentUserRow.totalXp} XP</p>
                      {statusText ? (
                        <p className="app-text-primary mt-2 text-sm font-medium">{statusText}</p>
                      ) : null}
                      {gapToTop3 !== null && gapToTop3 > 0 ? (
                        <p className="app-text-secondary mt-2 text-sm">До подиума: {gapToTop3} XP</p>
                      ) : null}
                      {userBelow && gapToBehind !== null && gapToBehind <= 20 ? (
                        <p className="app-text-secondary mt-2 text-sm">{userBelow.displayName} дышит в спину: {gapToBehind} XP</p>
                      ) : null}
                      {movementEstimateText ? (
                        <p className="app-text-secondary mt-2 text-sm">{movementEstimateText}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      {userAbove && gapToNext !== null && gapToNext > 0 ? (
                        <p className="app-text-secondary">До {userAbove.displayName}: {gapToNext} XP</p>
                      ) : currentUserRow.rank === 1 ? (
                        <p className="app-text-secondary">Ты лидер</p>
                      ) : null}
                      {userBelow && gapToBehind !== null ? (
                        <p className="app-text-secondary mt-1">Отрыв: {gapToBehind} XP</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="mt-4 space-y-2">
                {rows.map((row, index) => {
                  const isCurrentUser = row.user_id === user.id
                  const isPodiumRow = row.rank > 0 && row.rank <= 3
                  const previousRow = index > 0 ? rows[index - 1] : null
                  const nextRow = index < rows.length - 1 ? rows[index + 1] : null
                  const gapAbove = previousRow ? Math.max(previousRow.totalXp - row.totalXp, 0) : null
                  const gapBelow = nextRow ? Math.max(row.totalXp - nextRow.totalXp, 0) : null

                  return (
                    <div
                      key={row.user_id}
                      className={`rounded-2xl border p-4 shadow-sm ${getRowHighlightClass({
                        isCurrentUser,
                        rank: row.rank,
                        gapAbove,
                        gapBelow,
                      })}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p
                            className={`app-text-primary truncate text-sm ${
                              isCurrentUser || isPodiumRow ? 'font-semibold' : 'font-medium'
                            }`}
                          >
                            {row.rank}. {row.displayName}
                          </p>
                        </div>
                        <p
                          className={`app-text-primary shrink-0 text-sm ${
                            isCurrentUser || isPodiumRow ? 'font-semibold' : 'font-medium'
                          }`}
                        >
                          {row.totalXp} XP
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
    </WorkoutDetailShell>
  )
}
