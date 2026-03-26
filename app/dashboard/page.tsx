'use client'

import { Activity, Footprints, Heart, Route, Target, Trophy } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import useSWR from 'swr'
import { getBootstrapUser } from '@/lib/auth'
import InfiniteWorkoutFeed from '@/components/InfiniteWorkoutFeed'
import UserIdentitySummary from '@/components/UserIdentitySummary'
import WeeklyLeaderboard from '@/components/WeeklyLeaderboard'
import { loadDashboardOverview } from '@/lib/dashboard'
import { formatDistanceKm } from '@/lib/format'
import type { ChallengeWithProgress } from '@/lib/challenges'
import { getProfileDisplayName } from '@/lib/profiles'
import { RUNS_UPDATED_EVENT, RUNS_UPDATED_STORAGE_KEY } from '@/lib/runs-refresh'
import { loadWeeklyXpLeaderboard, type WeeklyXpLeaderboard } from '@/lib/weekly-xp'
import { getLevelProgressFromXP } from '@/lib/xp'
import type { User } from '@supabase/supabase-js'

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [shouldLoadSecondaryContent, setShouldLoadSecondaryContent] = useState(false)
  const [showXpModal, setShowXpModal] = useState(false)
  const refreshDashboardDataPromiseRef = useRef<Promise<void> | null>(null)

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
          setLoading(false)
        }
      }
    }

    void loadUser()

    return () => {
      isMounted = false
    }
  }, [router])

  useEffect(() => {
    if (!user) {
      setShouldLoadSecondaryContent(false)
      return
    }

    let timeoutId: number | null = null
    const frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        setShouldLoadSecondaryContent(true)
      }, 120)
    })

    return () => {
      window.cancelAnimationFrame(frameId)

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [user])

  const swrBaseOptions = useMemo(() => ({
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    keepPreviousData: true,
    dedupingInterval: 15000,
    focusThrottleInterval: 15000,
  }), [])
  const overviewKey = user ? (['dashboard-overview', user.id] as const) : null
  const weeklyRaceKey = user && shouldLoadSecondaryContent ? (['weekly-race', user.id] as const) : null

  const {
    data: overview,
    error: overviewError,
    isLoading: overviewLoading,
    mutate: mutateOverview,
  } = useSWR(overviewKey, ([, userId]: readonly [string, string]) => loadDashboardOverview(userId), swrBaseOptions)

  const {
    data: weeklyRace,
    error: weeklyRaceError,
    isLoading: weeklyRaceLoading,
    mutate: mutateWeeklyRace,
  } = useSWR<WeeklyXpLeaderboard>(weeklyRaceKey, ([, userId]: readonly [string, string]) => loadWeeklyXpLeaderboard(userId), {
    ...swrBaseOptions,
  })

  const refreshDashboardData = useCallback(() => {
    if (refreshDashboardDataPromiseRef.current) {
      return refreshDashboardDataPromiseRef.current
    }

    const refreshPromise = (async () => {
      await Promise.all([
        mutateOverview(),
        mutateWeeklyRace(),
      ])
    })()

    refreshDashboardDataPromiseRef.current = refreshPromise

    return refreshPromise.finally(() => {
      if (refreshDashboardDataPromiseRef.current === refreshPromise) {
        refreshDashboardDataPromiseRef.current = null
      }
    })
  }, [mutateOverview, mutateWeeklyRace])

  useEffect(() => {
    if (!user) return

    function handleRunsUpdated() {
      void refreshDashboardData()
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === RUNS_UPDATED_STORAGE_KEY) {
        void refreshDashboardData()
      }
    }

    window.addEventListener(RUNS_UPDATED_EVENT, handleRunsUpdated)
    window.addEventListener('storage', handleStorage)

    return () => {
      window.removeEventListener(RUNS_UPDATED_EVENT, handleRunsUpdated)
      window.removeEventListener('storage', handleStorage)
    }
  }, [refreshDashboardData, user])

  if (!user && !loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

  const isBootstrappingUser = loading && !user
  const stats = overview?.stats ?? null
  const activeChallenge: ChallengeWithProgress | null = overview?.activeChallenge ?? null
  const allChallengesCompleted = overview?.allChallengesCompleted ?? false
  const levelProgress = stats ? getLevelProgressFromXP(stats.totalXp) : null
  const profileName = getProfileDisplayName(
    {
      name: overview?.profileSummary.name ?? null,
      nickname: overview?.profileSummary.nickname ?? null,
      email: overview?.profileSummary.email ?? user?.email ?? null,
    },
    'Бегун'
  )
  const overviewStateError = overviewError ? 'Не удалось загрузить прогресс' : ''
  const headerDisplayName = user ? `Привет, ${profileName}` : 'Привет!'
  const headerLevelLabel = levelProgress
    ? `Уровень ${levelProgress.level}`
    : user
      ? 'Загружаем прогресс...'
      : null
  const showOverviewSkeleton = isBootstrappingUser || (overviewLoading && !overview && !overviewError)
  const showSecondarySkeleton = isBootstrappingUser || !shouldLoadSecondaryContent
  const weeklyLeaderboardLoading = showSecondarySkeleton || weeklyRaceLoading
  const rawXpProgressPercent = levelProgress?.progressPercent
  const xpProgressPercent = typeof rawXpProgressPercent === 'number' && Number.isFinite(rawXpProgressPercent)
    ? Math.min(Math.max(rawXpProgressPercent, 0), 100)
    : 0

  return (
    <main className="min-h-screen pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <div className="mb-6 space-y-1">
          <h1 className="app-text-primary text-2xl font-bold">Главная</h1>
          <UserIdentitySummary
            loadingIdentity={false}
            loadingLevel={false}
            displayName={headerDisplayName}
            levelLabel={headerLevelLabel}
          />
        </div>
        <div className="mb-4">
          <Link
            href="/runs"
            className="app-button-primary mb-4 mt-4 block min-h-13 w-full rounded-xl px-4 py-3.5 text-center text-base font-semibold shadow-sm shadow-black/15 ring-1 ring-black/5 sm:text-lg dark:ring-white/10"
          >
            + Добавить тренировку
          </Link>
          {showOverviewSkeleton ? (
            <>
              <div className="app-card mb-4 rounded-xl border p-4 shadow-sm">
                <div className="skeleton-line h-4 w-28" />
                <div className="mt-3 space-y-2">
                  <div className="skeleton-line h-6 w-40" />
                  <div className="skeleton-line h-4 w-24" />
                  <div className="skeleton-line h-4 w-20" />
                </div>
              </div>
              <div className="app-card mb-4 rounded-xl border p-4 shadow-sm">
                <div className="skeleton-line h-4 w-32" />
                <div className="mt-3 space-y-3">
                  <div className="skeleton-line h-6 w-44" />
                  <div className="skeleton-line h-2 w-full" />
                  <div className="skeleton-line h-4 w-36" />
                </div>
              </div>
              <div className="app-card mb-4 rounded-xl border p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="skeleton-line h-4 w-24" />
                  <div className="skeleton-line h-8 w-28" />
                </div>
                <div className="mt-3 skeleton-line h-2 w-full" />
                <div className="mt-3 space-y-2">
                  <div className="skeleton-line h-6 w-36" />
                  <div className="skeleton-line h-4 w-40" />
                </div>
              </div>
            </>
          ) : overviewStateError ? (
            <div className="app-card mb-4 rounded-xl border p-4 shadow-sm">
              <p className="text-sm text-red-600">{overviewStateError}</p>
            </div>
          ) : stats ? (
            <div className="app-card mb-4 overflow-hidden rounded-xl border p-4 shadow-sm">
              <p className="app-text-secondary flex items-center gap-2 text-sm font-medium">
                <Activity className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span>Твой прогресс</span>
              </p>
              <div className="mt-3 space-y-2">
                <div className="space-y-0.5">
                  <p className="app-text-primary text-3xl font-bold tracking-tight sm:text-4xl">
                    {formatDistanceKm(stats.totalKmThisMonth)} км
                  </p>
                  <p className="app-text-secondary text-sm">в этом месяце</p>
                </div>
                <p className="app-text-secondary text-sm">
                  {stats.runsCount} тренировок • +{stats.totalXp} XP
                </p>
              </div>
            </div>
          ) : (
            <div className="app-card mb-4 rounded-xl border p-4 shadow-sm">
              <p className="app-text-secondary flex items-center gap-2 text-sm font-medium">
                <Activity className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span>Твой прогресс</span>
              </p>
              <p className="app-text-secondary mt-3 text-sm">Данные появятся после первой тренировки</p>
            </div>
          )}
          {activeChallenge ? (
            <div className="app-card mb-4 overflow-hidden rounded-xl border p-4 shadow-sm">
              <p className="app-text-secondary flex items-center gap-2 text-sm font-medium">
                <Target className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span>Активный челлендж</span>
              </p>
              <h2 className="app-text-primary mt-3 break-words text-lg font-semibold">{activeChallenge.title}</h2>
              {activeChallenge.progressItems[0] ? (
                <div className="mt-3">
                  <div className="app-progress-track h-2 w-full overflow-hidden rounded-full">
                    <div
                      className="app-accent-bg h-full rounded-full"
                      style={{ width: `${activeChallenge.progressItems[0].percent}%` }}
                    />
                  </div>
                  <p className="app-text-secondary mt-2 text-sm">Прогресс: {activeChallenge.progressItems[0].label}</p>
                </div>
              ) : (
                <p className="app-text-secondary mt-2 text-sm">Прогресс появится после первой тренировки</p>
              )}
            </div>
          ) : allChallengesCompleted ? (
            <div className="app-card mb-4 rounded-xl border p-4 shadow-sm">
              <p className="app-text-secondary flex items-center gap-2 text-sm font-medium">
                <Target className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span>Активный челлендж</span>
              </p>
              <p className="app-text-secondary mt-3 text-sm">Все активные челленджи уже выполнены</p>
              <Link
                href="/club"
                className="app-button-secondary mt-3 inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm"
              >
                Открыть достижения
              </Link>
            </div>
          ) : null}
          {stats && levelProgress ? (
            <div className="app-card mb-4 overflow-hidden rounded-xl border p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <p className="app-text-secondary flex items-center gap-2 text-sm font-medium">
                  <Trophy className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                  <span>Уровень {levelProgress.level}</span>
                </p>
                <button
                  type="button"
                  onClick={() => setShowXpModal(true)}
                  className="app-button-secondary min-h-10 shrink-0 rounded-lg border px-3 py-2 text-xs"
                >
                  Как начисляется XP
                </button>
              </div>
              <div className="app-progress-track mt-3 h-2 w-full overflow-hidden rounded-full">
                <div
                  className="app-accent-bg h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
                  style={{ width: `${xpProgressPercent}%` }}
                />
              </div>
              <p className="app-text-primary mt-3 break-words text-lg font-semibold">
                {stats.totalXp} / {levelProgress.nextLevelXP ?? 'Максимум'} XP
              </p>
              <p className="app-text-secondary mt-1 text-sm">
                {levelProgress.nextLevelXP === null
                  ? 'Максимальный уровень достигнут'
                  : `До следующего уровня: ${levelProgress.xpToNextLevel} XP`}
              </p>
            </div>
          ) : null}
          <WeeklyLeaderboard
            leaderboard={weeklyRace ?? null}
            currentUserId={user?.id ?? ''}
            loading={weeklyLeaderboardLoading}
            error={!showSecondarySkeleton && weeklyRaceError ? 'Не удалось загрузить рейтинг' : ''}
          />
          <h2 className="app-text-primary mb-3 text-lg font-semibold">Лента</h2>
          {showSecondarySkeleton ? (
            <div className="space-y-3">
              <div className="app-card rounded-xl border p-4 shadow-sm">
                <div className="skeleton-line h-5 w-32" />
                <div className="mt-2 skeleton-line h-4 w-24" />
                <div className="mt-3 space-y-2">
                  <div className="skeleton-line h-4 w-20" />
                  <div className="skeleton-line h-4 w-16" />
                  <div className="skeleton-line h-4 w-24" />
                </div>
              </div>
              <div className="app-card rounded-xl border p-4 shadow-sm">
                <div className="skeleton-line h-5 w-36" />
                <div className="mt-2 skeleton-line h-4 w-28" />
                <div className="mt-3 space-y-2">
                  <div className="skeleton-line h-4 w-24" />
                  <div className="skeleton-line h-4 w-16" />
                  <div className="skeleton-line h-4 w-20" />
                </div>
              </div>
            </div>
          ) : (
            <InfiniteWorkoutFeed
              currentUserId={user?.id ?? null}
              pageSize={10}
              emptyTitle="Пока нет тренировок"
              showLevelSubtitle
              onSuccessfulLikeToggle={() => {
                void refreshDashboardData()
              }}
            />
          )}
        </div>
      </div>
      {showXpModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center">
          <div className="app-card w-full max-w-sm rounded-2xl p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <h2 className="app-text-primary text-lg font-semibold">Как начисляется XP</h2>
              <button
                type="button"
                onClick={() => setShowXpModal(false)}
                className="app-text-secondary text-sm"
              >
                Закрыть
              </button>
            </div>
            <div className="app-text-secondary mt-4 space-y-3 text-sm">
              <p className="flex items-center gap-2">
                <Footprints className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span>Завершённая тренировка — 50 XP</span>
              </p>
              <p className="flex items-center gap-2">
                <Route className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span>1 км бега — 10 XP</span>
              </p>
              <p className="flex items-center gap-2">
                <Heart className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span>Лайк за тренировку — 5 XP</span>
              </p>
              <p className="flex items-center gap-2">
                <Target className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span>Челлендж — XP зависит от награды челленджа</span>
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
