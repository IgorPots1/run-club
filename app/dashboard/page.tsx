'use client'

import { Footprints, Heart, Route, Target, Trophy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import useSWR from 'swr'
import { getBootstrapUser } from '@/lib/auth'
import WeeklyLeaderboard from '@/components/WeeklyLeaderboard'
import WorkoutFeedCard from '@/components/WorkoutFeedCard'
import { loadDashboardOverview, loadDashboardRuns, loadUserProfileSummary } from '@/lib/dashboard'
import { formatDistanceKm } from '@/lib/format'
import type { ChallengeWithProgress } from '@/lib/challenges'
import { ensureProfileExists } from '@/lib/profiles'
import { toggleRunLike } from '@/lib/run-likes'
import { loadWeeklyXpLeaderboard, type WeeklyXpLeaderboard } from '@/lib/weekly-xp'
import { getLevelProgressFromXP } from '@/lib/xp'
import { supabase } from '../../lib/supabase'
import type { User } from '@supabase/supabase-js'

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [showXpModal, setShowXpModal] = useState(false)
  const [pendingRunIds, setPendingRunIds] = useState<string[]>([])
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadUser() {
      try {
        if (!isMounted) return

        const nextUser = await getBootstrapUser()
        setUser(nextUser)

        if (nextUser) {
          void ensureProfileExists(nextUser)
        }

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

  const swrBaseOptions = {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  }
  const overviewKey = user ? (['dashboard-overview', user.id] as const) : null
  const runsKey = user ? (['dashboard-runs', user.id] as const) : null
  const weeklyRaceKey = user ? (['weekly-race', user.id] as const) : null
  const profileKey = user ? (['dashboard-profile', user.id] as const) : null

  const {
    data: profileSummary,
    error: profileError,
  } = useSWR(
    profileKey,
    ([, userId]: readonly [string, string]) => loadUserProfileSummary(userId),
    swrBaseOptions
  )

  const {
    data: overview,
    error: overviewError,
    isLoading: overviewLoading,
    mutate: mutateOverview,
  } = useSWR(overviewKey, ([, userId]: readonly [string, string]) => loadDashboardOverview(userId), swrBaseOptions)

  const {
    data: runs,
    error: runsError,
    isLoading: runsLoading,
    mutate: mutateRuns,
  } = useSWR(runsKey, ([, userId]: readonly [string, string]) => loadDashboardRuns(userId), {
    ...swrBaseOptions,
    refreshInterval: 30000,
  })

  const {
    data: weeklyRace,
    error: weeklyRaceError,
    isLoading: weeklyRaceLoading,
    mutate: mutateWeeklyRace,
  } = useSWR<WeeklyXpLeaderboard>(weeklyRaceKey, ([, userId]: readonly [string, string]) => loadWeeklyXpLeaderboard(userId), {
    ...swrBaseOptions,
    refreshInterval: 30000,
  })

  async function handleLikeToggle(runId: string) {
    if (!user) {
      router.replace('/login')
      return
    }

    if (pendingRunIds.includes(runId)) return

    const currentRun = runs?.find((run) => run.id === runId)
    if (!currentRun) return

    const wasLiked = currentRun.likedByMe

    setActionError('')
    setPendingRunIds((prev) => [...prev, runId])

    try {
      await mutateRuns(
        (currentRuns = []) =>
          currentRuns.map((run) =>
            run.id === runId
              ? {
                  ...run,
                  likedByMe: !wasLiked,
                  likesCount: Math.max(0, run.likesCount + (wasLiked ? -1 : 1)),
                }
              : run
          ),
        false
      )

      const { error: likeError } = await toggleRunLike(runId, user.id, wasLiked)

      if (likeError) {
        setActionError('Не удалось обновить лайк')
        await mutateRuns()
        return
      }

      void mutateRuns()
      void mutateWeeklyRace()
      void mutateOverview()
    } catch {
      setActionError('Не удалось обновить лайк')
      await mutateRuns()
    } finally {
      setPendingRunIds((prev) => prev.filter((id) => id !== runId))
    }
  }

  if (loading) return <main className="min-h-screen flex items-center justify-center p-4">Загрузка...</main>
  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

  const stats = overview?.stats ?? null
  const activeChallenge: ChallengeWithProgress | null = overview?.activeChallenge ?? null
  const allChallengesCompleted = overview?.allChallengesCompleted ?? false
  const levelProgress = stats ? getLevelProgressFromXP(stats.totalXp) : null
  const greetingLevel = levelProgress?.level ?? 1
  const activityError = actionError || (runsError ? 'Не удалось загрузить тренировки' : '')
  const profileName = profileSummary?.name || user.email?.split('@')[0] || 'бегун'
  const overviewStateError = overviewError ? 'Не удалось загрузить прогресс' : ''
  const profileStateError = profileError ? 'Не удалось загрузить профиль' : ''

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-xl p-4">
        <div className="mb-6 space-y-1">
          <h1 className="app-text-primary text-2xl font-bold">Главная</h1>
          <div className="min-w-0 space-y-1">
            <p className="app-text-primary text-lg font-semibold">Привет, {profileName}</p>
            <p className="app-text-secondary text-sm">Уровень {greetingLevel}</p>
          </div>
        </div>
        {profileStateError ? <p className="mb-4 text-sm text-red-600">{profileStateError}</p> : null}

        <div className="mb-4">
          <Link
            href="/runs"
            className="app-button-primary mb-4 mt-4 block min-h-12 w-full rounded-xl px-4 py-3 text-center text-base font-semibold shadow-sm shadow-black/15 ring-1 ring-black/5 sm:text-lg dark:ring-white/10"
          >
            + Добавить тренировку
          </Link>
          {overviewLoading && !overview ? (
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
                <Footprints className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span>Твой прогресс</span>
              </p>
              <div className="mt-3 space-y-1">
                <p className="app-text-primary text-lg font-semibold sm:text-xl">{formatDistanceKm(stats.totalKmThisMonth)} км в этом месяце</p>
                <p className="app-text-secondary text-sm">{stats.runsCount} тренировок</p>
                <p className="app-text-secondary text-sm">+{stats.totalXp} XP</p>
              </div>
            </div>
          ) : (
            <div className="app-card mb-4 rounded-xl border p-4 shadow-sm">
              <p className="app-text-secondary flex items-center gap-2 text-sm font-medium">
                <Footprints className="h-4 w-4 shrink-0" strokeWidth={1.9} />
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
              <p className="app-text-secondary mt-3 text-sm">Все челленджи уже выполнены</p>
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
                  className="app-accent-bg h-full rounded-full"
                  style={{ width: `${levelProgress.progressPercent}%` }}
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
            currentUserId={user.id}
            loading={weeklyRaceLoading}
            error={weeklyRaceError ? 'Не удалось загрузить рейтинг' : ''}
          />
          <h2 className="app-text-primary text-lg font-semibold mb-3">Последние тренировки</h2>
          {activityError ? <p className="mb-3 text-sm text-red-600">{activityError}</p> : null}
          <div className="space-y-3">
            {runsLoading && !runs ? (
              <>
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
              </>
            ) : !runs || runs.length === 0 ? (
              <div className="app-text-secondary mt-10 text-center">
                <p>Пока нет тренировок</p>
              </div>
            ) : (
              runs.map((run) => (
                <WorkoutFeedCard
                  key={run.id}
                  rawTitle={run.title}
                  distanceKm={run.distance_km}
                  pace={run.pace}
                  xp={run.xp}
                  createdAt={run.created_at}
                  displayName={run.displayName}
                  avatarUrl={run.avatar_url}
                  likesCount={run.likesCount}
                  likedByMe={run.likedByMe}
                  pending={pendingRunIds.includes(run.id)}
                  onToggleLike={() => handleLikeToggle(run.id)}
                />
              ))
            )}
          </div>
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
