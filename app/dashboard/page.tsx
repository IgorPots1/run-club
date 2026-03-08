'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import useSWR from 'swr'
import WeeklyLeaderboard from '@/components/WeeklyLeaderboard'
import RunLikeControl from '@/components/RunLikeControl'
import { loadDashboardOverview, loadDashboardRuns, loadUserProfileSummary } from '@/lib/dashboard'
import type { ChallengeWithProgress } from '@/lib/challenges'
import { toggleRunLike } from '@/lib/run-likes'
import { loadWeeklyXpLeaderboard, type WeeklyXpLeaderboard } from '@/lib/weekly-xp'
import { supabase } from '../../lib/supabase'
import type { User } from '@supabase/supabase-js'

function getLevelProgress(totalXp: number) {
  const level = Math.floor(totalXp / 200) + 1
  const nextLevelXp = level * 200
  const currentLevelXp = totalXp - (level - 1) * 200
  const xpToNextLevel = nextLevelXp - totalXp

  return {
    level,
    nextLevelXp,
    currentLevelXp,
    xpToNextLevel,
    progressPercent: Math.min((currentLevelXp / 200) * 100, 100),
  }
}

function formatRunDate(date: string) {
  return new Date(date).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  })
}

function getInitials(label: string) {
  const trimmed = label.trim()
  return (trimmed[0] ?? '?').toUpperCase()
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [showXpModal, setShowXpModal] = useState(false)
  const [pendingRunIds, setPendingRunIds] = useState<string[]>([])
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setLoading(false)
      if (!user) router.push('/login')
    })
  }, [router])

  const swrBaseOptions = {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  }
  const overviewKey = user ? (['dashboard-overview', user.id] as const) : null
  const runsKey = user ? (['dashboard-runs', user.id] as const) : null
  const weeklyRaceKey = user ? (['weekly-race', user.id] as const) : null
  const profileKey = user ? (['dashboard-profile', user.id] as const) : null

  const { data: profileSummary } = useSWR(
    profileKey,
    ([, userId]: readonly [string, string]) => loadUserProfileSummary(userId),
    swrBaseOptions
  )

  const {
    data: overview,
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
      router.push('/login')
      return
    }

    if (pendingRunIds.includes(runId)) return

    const currentRun = runs?.find((run) => run.id === runId)
    if (!currentRun) return

    const wasLiked = currentRun.likedByMe

    setActionError('')
    setPendingRunIds((prev) => [...prev, runId])
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
    } else {
      void mutateRuns()
      void mutateWeeklyRace()
      void mutateOverview()
    }

    setPendingRunIds((prev) => prev.filter((id) => id !== runId))
  }

  if (loading) return <main className="min-h-screen flex items-center justify-center p-4">Загрузка...</main>
  if (!user) return null

  const stats = overview?.stats ?? null
  const activeChallenge: ChallengeWithProgress | null = overview?.activeChallenge ?? null
  const allChallengesCompleted = overview?.allChallengesCompleted ?? false
  const levelProgress = stats ? getLevelProgress(stats.totalXp) : null
  const activityError = actionError || (runsError ? 'Не удалось загрузить тренировки' : '')
  const profileName = profileSummary?.name || user.email?.split('@')[0] || 'бегун'

  return (
    <main className="min-h-screen">
      <div className="p-4">
        <div className="mb-6 space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">Главная</h1>
          <div className="space-y-0.5">
            <p className="text-lg font-semibold text-gray-900">Привет, {profileName}</p>
            {user.email ? <p className="text-sm text-gray-500">{user.email}</p> : null}
          </div>
        </div>

        <div className="mb-4">
          <Link
            href="/runs"
            className="block mt-4 w-full rounded-xl bg-black text-white py-3 text-lg font-medium text-center mb-4"
          >
            ➕ Добавить тренировку
          </Link>
          {overviewLoading && !overview ? (
            <>
              <div className="mb-4 rounded-xl border bg-white p-4 shadow-sm">
                <div className="skeleton-line h-4 w-28" />
                <div className="mt-3 space-y-2">
                  <div className="skeleton-line h-6 w-40" />
                  <div className="skeleton-line h-4 w-24" />
                  <div className="skeleton-line h-4 w-20" />
                </div>
              </div>
              <div className="mb-4 rounded-xl border bg-white p-4 shadow-sm">
                <div className="skeleton-line h-4 w-32" />
                <div className="mt-3 space-y-3">
                  <div className="skeleton-line h-6 w-44" />
                  <div className="skeleton-line h-2 w-full" />
                  <div className="skeleton-line h-4 w-36" />
                </div>
              </div>
              <div className="mb-4 rounded-xl border bg-white p-4 shadow-sm">
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
          ) : stats ? (
            <div className="mb-4 rounded-xl border bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-500">🏃 Твой прогресс</p>
              <div className="mt-3 space-y-1">
                <p className="text-xl font-semibold">{stats.totalKmThisMonth.toFixed(1)} км в этом месяце</p>
                <p className="text-sm text-gray-600">{stats.runsCount} тренировок</p>
                <p className="text-sm text-gray-600">+{stats.totalXp} XP</p>
              </div>
            </div>
          ) : null}
          {activeChallenge ? (
            <div className="mb-4 rounded-xl border bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-500">🎯 Активный челлендж</p>
              <h2 className="mt-3 text-lg font-semibold">{activeChallenge.title}</h2>
              {activeChallenge.progressItems[0] ? (
                <div className="mt-3">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-black"
                      style={{ width: `${activeChallenge.progressItems[0].percent}%` }}
                    />
                  </div>
                  <p className="mt-2 text-sm text-gray-600">Прогресс: {activeChallenge.progressItems[0].label}</p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-gray-600">Прогресс появится после первой тренировки</p>
              )}
            </div>
          ) : allChallengesCompleted ? (
            <div className="mb-4 rounded-xl border bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-500">🎯 Активный челлендж</p>
              <p className="mt-3 text-sm text-gray-600">Все челленджи уже выполнены</p>
            </div>
          ) : null}
          {stats && levelProgress ? (
            <div className="mb-4 rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-gray-500">🏆 Уровень {levelProgress.level}</p>
                <button
                  type="button"
                  onClick={() => setShowXpModal(true)}
                  className="rounded-lg border px-3 py-1 text-xs text-gray-600"
                >
                  Как начисляется XP
                </button>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-black"
                  style={{ width: `${levelProgress.progressPercent}%` }}
                />
              </div>
              <p className="mt-3 text-lg font-semibold">{stats.totalXp} / {levelProgress.nextLevelXp} XP</p>
              <p className="mt-1 text-sm text-gray-600">До следующего уровня: {levelProgress.xpToNextLevel} XP</p>
            </div>
          ) : null}
          <WeeklyLeaderboard
            leaderboard={weeklyRace ?? null}
            currentUserId={user.id}
            loading={weeklyRaceLoading}
            error={weeklyRaceError ? 'Не удалось загрузить рейтинг' : ''}
          />
          <h2 className="text-lg font-semibold mb-3">Последние тренировки</h2>
          {activityError ? <p className="mb-3 text-sm text-red-600">{activityError}</p> : null}
          <div className="space-y-3">
            {runsLoading && !runs ? (
              <>
                <div className="rounded-xl border bg-white p-4 shadow-sm">
                  <div className="skeleton-line h-5 w-32" />
                  <div className="mt-2 skeleton-line h-4 w-24" />
                  <div className="mt-3 space-y-2">
                    <div className="skeleton-line h-4 w-20" />
                    <div className="skeleton-line h-4 w-16" />
                    <div className="skeleton-line h-4 w-24" />
                  </div>
                </div>
                <div className="rounded-xl border bg-white p-4 shadow-sm">
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
              <div className="mt-10 text-center text-gray-500">
                <p>Пока нет тренировок</p>
              </div>
            ) : (
              runs.map((run) => (
                <div key={run.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {run.avatar_url ? (
                        <Image
                          src={run.avatar_url}
                          alt=""
                          width={40}
                          height={40}
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-600">
                          {getInitials(run.displayName)}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-gray-900">{run.displayName}</p>
                      </div>
                    </div>
                    <p className="shrink-0 text-sm text-gray-500">{formatRunDate(run.created_at)}</p>
                  </div>

                  <div className="mt-4">
                    <p className="text-lg font-semibold text-gray-900">🏃 {run.title} - {run.distance_km} км</p>
                  </div>

                  <div className="mt-3">
                    <p className="text-sm font-semibold text-amber-600">⚡ +{run.xp} XP</p>
                  </div>

                  <div className="mt-4">
                    <RunLikeControl
                      likesCount={run.likesCount}
                      likedByMe={run.likedByMe}
                      pending={pendingRunIds.includes(run.id)}
                      onToggle={() => handleLikeToggle(run.id)}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      {showXpModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold">Как начисляется XP</h2>
              <button
                type="button"
                onClick={() => setShowXpModal(false)}
                className="text-sm text-gray-500"
              >
                Закрыть
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-gray-700">
              <p>🏃 Завершённая тренировка — 50 XP</p>
              <p>📏 1 км бега — 10 XP</p>
              <p>❤️ Лайк за тренировку — 5 XP</p>
              <p>🎯 Челлендж — XP зависит от награды челленджа</p>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
