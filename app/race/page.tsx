'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { CalendarRange, ChevronRight, Medal, Trophy } from 'lucide-react'
import WorkoutDetailShell from '@/components/WorkoutDetailShell'
import { getBootstrapUser } from '@/lib/auth'
import { formatRaceWeekDateRange } from '@/lib/race-badges'
import { loadLatestFinalizedRaceWeek, type RaceWeekSummary } from '@/lib/race-results-client'
import { loadWeeklyXpLeaderboard, type WeeklyXpLeaderboard } from '@/lib/weekly-xp'
import type { User } from '@supabase/supabase-js'

type LeaderboardRow = WeeklyXpLeaderboard['rows'][number]

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

function getWeekStatusMeta(status: 'scheduled' | 'active' | 'finalized') {
  if (status === 'active') {
    return {
      label: 'Идет сейчас',
      badgeClass:
        'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200',
    }
  }

  if (status === 'finalized') {
    return {
      label: 'Завершена',
      badgeClass:
        'border-black/10 bg-black/[0.05] text-black/70 dark:border-white/10 dark:bg-white/[0.08] dark:text-white/70',
    }
  }

  return {
    label: 'Запланирована',
    badgeClass:
      'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-200',
  }
}

function getPodiumCardClass(rank: number, featured: boolean) {
  if (rank === 1 || featured) {
    return 'border-yellow-500/25 bg-[linear-gradient(180deg,rgba(250,204,21,0.18),rgba(250,204,21,0.04))] dark:border-yellow-300/20 dark:bg-[linear-gradient(180deg,rgba(250,204,21,0.14),rgba(250,204,21,0.03))]'
  }

  if (rank === 2) {
    return 'border-black/10 bg-black/[0.035] dark:border-white/10 dark:bg-white/[0.05]'
  }

  return 'border-orange-500/15 bg-orange-500/[0.06] dark:border-orange-300/15 dark:bg-orange-300/[0.05]'
}

function getPodiumRankLabel(rank: number) {
  if (rank === 1) return '1 место'
  if (rank === 2) return '2 место'
  if (rank === 3) return '3 место'
  return `${rank} место`
}

function PodiumCard({
  row,
  isCurrentUser,
  featured = false,
}: {
  row: LeaderboardRow
  isCurrentUser: boolean
  featured?: boolean
}) {
  const icon =
    row.rank === 1 ? (
      <Trophy className="h-5 w-5" strokeWidth={2} />
    ) : (
      <Medal className="h-5 w-5" strokeWidth={2} />
    )

  return (
    <Link
      href={`/users/${row.user_id}`}
      className={`block rounded-[24px] border p-4 shadow-sm transition-colors ${getPodiumCardClass(
        row.rank,
        featured
      )}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="app-text-primary inline-flex items-center gap-2 text-sm font-semibold">
              {icon}
              {getPodiumRankLabel(row.rank)}
            </span>
            {isCurrentUser ? (
              <span className="rounded-full border border-black/10 px-2 py-1 text-[11px] font-medium text-black/70 dark:border-white/10 dark:text-white/70">
                Ты
              </span>
            ) : null}
          </div>
          <p className={`app-text-primary mt-3 truncate font-semibold ${featured ? 'text-2xl' : 'text-lg'}`}>
            {row.displayName}
          </p>
          <p className="app-text-secondary mt-1 text-sm">Недельный результат</p>
        </div>
        <ChevronRight className="app-text-secondary mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <p className={`app-text-primary font-semibold ${featured ? 'text-3xl' : 'text-2xl'}`}>{row.totalXp} XP</p>
          <p className="app-text-secondary text-xs uppercase tracking-[0.18em]">Гонка недели</p>
      </div>
    </Link>
  )
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
  const currentUserId = user?.id ?? ''
  const gapToNext = typeof leaderboard?.gapToNext === 'number' ? leaderboard.gapToNext : null
  const gapToBehind = typeof leaderboard?.gapToBehind === 'number' ? leaderboard.gapToBehind : null
  const currentUserIndex = currentUserRow ? rows.findIndex((row) => row.user_id === currentUserRow.user_id) : -1
  const userAbove = currentUserIndex > 0 ? rows[currentUserIndex - 1] : null
  const userBelow = currentUserIndex >= 0 && currentUserIndex < rows.length - 1 ? rows[currentUserIndex + 1] : null
  const podiumRows = rows.slice(0, 3)
  const featuredRow = podiumRows[0] ?? null
  const supportingPodiumRows = podiumRows.slice(1)
  const remainingRows = rows.slice(podiumRows.length)
  const thirdPlaceRow = rows.find((row) => row.rank === 3) ?? null
  const isCurrentUserInLeaderboard = rows.some((row) => row.user_id === currentUserId)
  const isCurrentUserInPodium = podiumRows.some((row) => row.user_id === user?.id)
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
  const weekStatusMeta = week ? getWeekStatusMeta(week.status) : null

  if (!loadingUser && !user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

  const isPageLoading = loadingUser || isLoading

  return (
    <WorkoutDetailShell
      title="Гонка недели"
      fallbackHref="/dashboard"
      pinnedHeader
      scrollContentClassName="pt-4 md:pt-4"
    >
      <div className="space-y-4 pb-4">
        <section className="app-card overflow-hidden rounded-[28px] border shadow-sm">
          <div className="bg-[linear-gradient(180deg,rgba(0,0,0,0.03),transparent)] p-5 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-black/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-black/65 dark:border-white/10 dark:text-white/65">
                    Гонка недели
                  </span>
                  {weekStatusMeta ? (
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${weekStatusMeta.badgeClass}`}>
                      {weekStatusMeta.label}
                    </span>
                  ) : (
                    <span className="rounded-full border border-black/10 px-2.5 py-1 text-[11px] font-medium text-black/65 dark:border-white/10 dark:text-white/65">
                      Ожидает запуска
                    </span>
                  )}
                </div>
                <h1 className="app-text-primary mt-3 text-3xl font-bold tracking-tight">Гонка недели</h1>
                <p className="app-text-secondary mt-2 max-w-[38rem] text-sm leading-6">
                  Фиксированная неделя с живым рейтингом по XP. Все позиции обновляются по текущим результатам без ручного пересчета.
                </p>
              </div>
              <div className="rounded-2xl border border-black/10 p-3 text-black/70 dark:border-white/10 dark:text-white/70">
                <Trophy className="h-5 w-5" strokeWidth={2} />
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div className="app-surface-muted rounded-[24px] p-4">
                <p className="app-text-secondary text-xs uppercase tracking-[0.18em]">Текущий период</p>
                <div className="mt-2 flex items-center gap-2">
                  <CalendarRange className="app-text-secondary h-4 w-4 shrink-0" strokeWidth={2} />
                  <p className="app-text-primary text-lg font-semibold">
                    {week ? formatRaceWeekDateRange(week) : 'Активной недели сейчас нет'}
                  </p>
                </div>
                <p className="app-text-secondary mt-2 text-sm">
                  {week
                    ? 'Результаты ниже отражают текущую фиксированную неделю.'
                    : 'Когда новая неделя откроется, здесь появятся статус, дата и живой рейтинг.'}
                </p>
              </div>

              {latestFinalizedRaceWeekError ? (
                <p className="text-sm text-red-600">Не удалось загрузить последнюю завершенную неделю</p>
              ) : showHistoryLink ? (
                <Link
                  href={`/race/history/${latestFinalizedRaceWeek!.id}`}
                  className="app-button-secondary inline-flex min-h-11 items-center justify-center rounded-xl border px-4 py-2 text-sm"
                >
                  Итоги прошлой недели
                </Link>
              ) : null}
            </div>
          </div>
        </section>

        {isPageLoading ? (
          <section className="app-card rounded-[28px] border p-4 shadow-sm">
            <div className="space-y-3">
              <div className="skeleton-line h-5 w-32" />
              <div className="skeleton-line h-28 w-full rounded-[24px]" />
              <div className="grid grid-cols-2 gap-3">
                <div className="skeleton-line h-24 w-full rounded-[24px]" />
                <div className="skeleton-line h-24 w-full rounded-[24px]" />
              </div>
              {[0, 1, 2].map((item) => (
                <div key={item} className="skeleton-line h-16 w-full rounded-2xl" />
              ))}
            </div>
          </section>
        ) : error ? (
          <section className="app-card rounded-[28px] border p-5 shadow-sm">
            <p className="app-text-primary text-base font-semibold">Не удалось загрузить гонку недели</p>
            <p className="app-text-secondary mt-2 text-sm">Попробуй обновить экран немного позже.</p>
          </section>
        ) : !week ? (
          <section className="app-card rounded-[28px] border p-6 shadow-sm">
            <div className="mx-auto max-w-md text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-black/10 dark:border-white/10">
                <CalendarRange className="app-text-secondary h-5 w-5" strokeWidth={2} />
              </div>
              <h2 className="app-text-primary mt-4 text-xl font-semibold">Сейчас нет активной недели</h2>
              <p className="app-text-secondary mt-2 text-sm leading-6">
                Экран гонки готов, но новая фиксированная неделя еще не открыта. Как только она станет активной, здесь появятся
                подиум, ранжирование и твой текущий результат.
              </p>
            </div>
          </section>
        ) : rows.length === 0 ? (
          <section className="app-card rounded-[28px] border p-6 shadow-sm">
            <div className="mx-auto max-w-md text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-black/10 dark:border-white/10">
                <Trophy className="app-text-secondary h-5 w-5" strokeWidth={2} />
              </div>
              <h2 className="app-text-primary mt-4 text-xl font-semibold">Неделя уже идет, но таблица пока пустая</h2>
              <p className="app-text-secondary mt-2 text-sm leading-6">
                Как только появятся первые XP за пробежки и лайки, здесь сформируется подиум и полный рейтинг участников.
              </p>
            </div>
          </section>
        ) : (
          <>
            <section className="space-y-3">
              <div className="px-1">
                <p className="app-text-primary text-lg font-semibold">Лидеры недели</p>
                <p className="app-text-secondary mt-1 text-sm">Топ-3 участников по текущему недельному XP.</p>
              </div>

              {featuredRow ? (
                <PodiumCard row={featuredRow} isCurrentUser={featuredRow.user_id === currentUserId} featured />
              ) : null}

              {supportingPodiumRows.length > 0 ? (
                <div className={`grid gap-3 ${supportingPodiumRows.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {supportingPodiumRows.map((row) => (
                    <PodiumCard key={row.user_id} row={row} isCurrentUser={row.user_id === currentUserId} />
                  ))}
                </div>
              ) : null}
            </section>

            {currentUserRow && !isCurrentUserInPodium && !isCurrentUserInLeaderboard ? (
              <section className="app-card rounded-[28px] border p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-black/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-black/65 dark:border-white/10 dark:text-white/65">
                        Мой результат
                      </span>
                      {statusText ? (
                        <span className="app-text-secondary rounded-full border border-black/10 px-2.5 py-1 text-[11px] font-medium dark:border-white/10">
                          {statusText}
                        </span>
                      ) : null}
                    </div>
                    <p className="app-text-primary mt-3 text-xl font-semibold">
                      {currentUserRow.rank} место · {currentUserRow.totalXp} XP
                    </p>
                    <div className="app-text-secondary mt-2 space-y-1 text-sm">
                      {userAbove && gapToNext !== null && gapToNext > 0 ? (
                        <p>
                          До {userAbove.displayName}: {gapToNext} XP
                        </p>
                      ) : null}
                      {gapToTop3 !== null && gapToTop3 > 0 ? <p>До топ-3: {gapToTop3} XP</p> : null}
                      {userBelow && gapToBehind !== null && gapToBehind <= 20 ? (
                        <p>
                          {userBelow.displayName} рядом: {gapToBehind} XP
                        </p>
                      ) : null}
                      {movementEstimateText ? <p>{movementEstimateText}</p> : null}
                    </div>
                  </div>
                  <div className="app-surface-muted rounded-2xl px-4 py-3 text-right">
                    <p className="app-text-secondary text-xs uppercase tracking-[0.18em]">Weekly XP</p>
                    <p className="app-text-primary mt-1 text-2xl font-semibold">{currentUserRow.totalXp}</p>
                  </div>
                </div>
              </section>
            ) : null}

            {remainingRows.length > 0 ? (
              <section className="app-card rounded-[28px] border p-4 shadow-sm">
                <div className="px-1">
                  <p className="app-text-primary text-lg font-semibold">Полный рейтинг</p>
                  <p className="app-text-secondary mt-1 text-sm">Остальные участники текущей недели.</p>
                </div>

                <div className="mt-4 space-y-2">
                  {remainingRows.map((row, index) => {
                    const absoluteIndex = index + podiumRows.length
                    const isCurrentUser = row.user_id === currentUserId
                    const previousRow = absoluteIndex > 0 ? rows[absoluteIndex - 1] : null
                    const nextRow = absoluteIndex < rows.length - 1 ? rows[absoluteIndex + 1] : null
                    const gapAbove = previousRow ? Math.max(previousRow.totalXp - row.totalXp, 0) : null
                    const gapBelow = nextRow ? Math.max(row.totalXp - nextRow.totalXp, 0) : null

                    return (
                      <Link
                        key={row.user_id}
                        href={`/users/${row.user_id}`}
                        className={`block rounded-2xl border p-4 shadow-sm transition-colors ${getRowHighlightClass({
                          isCurrentUser,
                          rank: row.rank,
                          gapAbove,
                          gapBelow,
                        })}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="app-surface-muted flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold">
                            #{row.rank}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className={`app-text-primary truncate text-sm ${isCurrentUser ? 'font-semibold' : 'font-medium'}`}>
                                {row.displayName}
                              </p>
                              {isCurrentUser ? (
                                <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] font-medium text-black/65 dark:border-white/10 dark:text-white/65">
                                  Ты
                                </span>
                              ) : null}
                            </div>
                            {gapAbove !== null && gapAbove > 0 ? (
                              <p className="app-text-secondary mt-1 text-xs">До следующего места: {gapAbove} XP</p>
                            ) : (
                              <p className="app-text-secondary mt-1 text-xs">Недельный результат</p>
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            <p className={`app-text-primary text-sm ${isCurrentUser ? 'font-semibold' : 'font-medium'}`}>{row.totalXp} XP</p>
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </section>
            ) : (
              <section className="app-card rounded-[28px] border p-4 shadow-sm">
                <p className="app-text-primary text-sm font-medium">Пока на экране только подиум.</p>
                <p className="app-text-secondary mt-1 text-sm">
                  Как только участников станет больше, остальные места появятся в полном рейтинге ниже.
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </WorkoutDetailShell>
  )
}
