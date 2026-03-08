'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import WeeklyLeaderboard from '@/components/WeeklyLeaderboard'
import { loadLikeXpByUser } from '@/lib/likes-xp'
import RunLikeControl from '@/components/RunLikeControl'
import { getChallengeProgress, type Challenge, type ChallengeWithProgress, type RunRecord } from '@/lib/challenges'
import { loadRunLikesSummary, subscribeToRunLikes, toggleRunLike } from '@/lib/run-likes'
import { loadChallengeXpByUser } from '@/lib/user-challenges'
import { loadWeeklyXpLeaderboard, type WeeklyXpLeaderboard } from '@/lib/weekly-xp'
import { supabase } from '../../lib/supabase'
import type { User } from '@supabase/supabase-js'

type RunItem = {
  id: string
  user_id: string
  title: string
  distance_km: number
  xp: number
  created_at: string
  displayName: string
  likesCount: number
  likedByMe: boolean
}

type ProgressStats = {
  totalKmThisMonth: number
  runsCount: number
  totalXp: number
}

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

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [showXpModal, setShowXpModal] = useState(false)
  const [runs, setRuns] = useState<RunItem[]>([])
  const [stats, setStats] = useState<ProgressStats | null>(null)
  const [activeChallenge, setActiveChallenge] = useState<ChallengeWithProgress | null>(null)
  const [allChallengesCompleted, setAllChallengesCompleted] = useState(false)
  const [weeklyRace, setWeeklyRace] = useState<WeeklyXpLeaderboard | null>(null)
  const [weeklyRaceLoading, setWeeklyRaceLoading] = useState(true)
  const [weeklyRaceError, setWeeklyRaceError] = useState('')
  const [pendingRunIds, setPendingRunIds] = useState<string[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setLoading(false)
      if (!user) router.push('/login')
    })
  }, [router])

  useEffect(() => {
    if (!user) return
    const currentUser = user

    function getMonthStart(date: Date) {
      return new Date(date.getFullYear(), date.getMonth(), 1)
    }

    async function loadRuns() {
      try {
        setWeeklyRaceLoading(true)
        const weeklyRaceRequest = loadWeeklyXpLeaderboard(currentUser.id)
          .then((data) => ({ data, error: '' }))
          .catch(() => ({ data: null, error: 'Не удалось загрузить рейтинг' }))
        const [
          { data: runs, error: runsError },
          { data: profiles, error: profilesError },
          { likesByRunId, likedRunIds },
          { data: myRuns, error: myRunsError },
          { data: challenges, error: challengesError },
          challengeXpByUser,
          likeXpByUser,
          weeklyXpLeaderboard,
        ] = await Promise.all([
          supabase
            .from('runs')
            .select('id, user_id, title, distance_km, xp, created_at')
            .order('created_at', { ascending: false }),
          supabase.from('profiles').select('id, name, email, avatar_url'),
          loadRunLikesSummary(currentUser.id),
          supabase
            .from('runs')
            .select('distance_km, xp, created_at')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('challenges')
            .select('id, title, description, goal_km, goal_runs, xp_reward')
            .order('created_at', { ascending: true }),
          loadChallengeXpByUser(),
          loadLikeXpByUser(),
          weeklyRaceRequest,
        ])

        if (runsError || profilesError || myRunsError || challengesError) {
          setError('Не удалось загрузить тренировки')
          return
        }

        const profileById = Object.fromEntries((profiles ?? []).map((profile) => [profile.id, profile]))
        const items = (runs ?? []).map((run) => {
          const profile = profileById[run.user_id]
          return {
            id: run.id,
            user_id: run.user_id,
            title: run.title || 'Тренировка',
            distance_km: run.distance_km,
            xp: run.xp,
            created_at: run.created_at,
            displayName: profile?.name?.trim() || profile?.email || '—',
            likesCount: likesByRunId[run.id] ?? 0,
            likedByMe: likedRunIds.has(run.id),
          }
        })

        const currentUserRuns = (myRuns as RunRecord[] | null) ?? []
        const monthStart = getMonthStart(new Date()).getTime()
        const totalKmThisMonth = currentUserRuns.reduce((sum, run) => {
          const runTime = new Date(run.created_at).getTime()
          return runTime >= monthStart ? sum + Number(run.distance_km ?? 0) : sum
        }, 0)
        const runsCount = currentUserRuns.length
        const totalRunXp = ((myRuns as ({ xp: number | null } & RunRecord)[] | null) ?? []).reduce(
          (sum, run) => sum + Number(run.xp ?? 0),
          0
        )

        setStats({
          totalKmThisMonth,
          runsCount,
          totalXp: totalRunXp + (challengeXpByUser[currentUser.id] ?? 0) + (likeXpByUser[currentUser.id] ?? 0),
        })

        const challengeItems = ((challenges as Challenge[] | null) ?? []).map((challenge) =>
          getChallengeProgress(challenge, currentUserRuns)
        )
        const firstActiveChallenge = challengeItems.find((challenge) => !challenge.isCompleted) ?? null
        setActiveChallenge(firstActiveChallenge)
        setAllChallengesCompleted(challengeItems.length > 0 && !firstActiveChallenge)
        setWeeklyRace(weeklyXpLeaderboard.data)
        setWeeklyRaceError(weeklyXpLeaderboard.error)
        setWeeklyRaceLoading(false)

        setRuns(items)
      } catch {
        setWeeklyRaceLoading(false)
        setError('Не удалось загрузить тренировки')
      }
    }

    void loadRuns()
    const unsubscribe = subscribeToRunLikes(() => {
      void loadRuns()
    })

    return () => {
      unsubscribe()
    }
  }, [user])

  async function handleLikeToggle(runId: string) {
    if (!user) {
      router.push('/login')
      return
    }

    if (pendingRunIds.includes(runId)) return

    const currentRun = runs.find((run) => run.id === runId)
    if (!currentRun) return

    const wasLiked = currentRun.likedByMe
    const previousRuns = runs

    setError('')
    setPendingRunIds((prev) => [...prev, runId])
    setRuns((prev) =>
      prev.map((run) =>
        run.id === runId
          ? {
              ...run,
              likedByMe: !wasLiked,
              likesCount: Math.max(0, run.likesCount + (wasLiked ? -1 : 1)),
            }
          : run
      )
    )

    const { error: likeError } = await toggleRunLike(runId, user.id, wasLiked)

    if (likeError) {
      setRuns(previousRuns)
      setError('Не удалось обновить лайк')
    }

    setPendingRunIds((prev) => prev.filter((id) => id !== runId))
  }

  if (loading) return <main className="min-h-screen flex items-center justify-center p-4">Загрузка...</main>
  if (!user) return null

  const levelProgress = stats ? getLevelProgress(stats.totalXp) : null

  return (
    <main className="min-h-screen">
      <div className="p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-4">Главная</h1>
          <p className="text-sm text-gray-600">{user.email}</p>
        </div>

        <div className="mb-4">
          <Link
            href="/runs"
            className="block mt-4 w-full rounded-xl bg-black text-white py-3 text-lg font-medium text-center mb-4"
          >
            ➕ Добавить тренировку
          </Link>
          {stats ? (
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
            leaderboard={weeklyRace}
            currentUserId={user.id}
            loading={weeklyRaceLoading}
            error={weeklyRaceError}
          />
          <h2 className="text-lg font-semibold mb-3">Последние тренировки</h2>
          {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
          <div className="space-y-3">
            {runs.length === 0 ? (
              <div className="mt-10 text-center text-gray-500">
                <p>Пока нет тренировок</p>
              </div>
            ) : (
              runs.map((run) => (
                <div key={run.id} className="border rounded-xl p-4 shadow-sm bg-white">
                  <p className="font-medium">{run.title}</p>
                  <p className="text-sm text-gray-600 mt-1">{run.displayName}</p>
                  <p className="text-sm mt-1">🏃 {run.distance_km} км</p>
                  <p className="text-sm mt-1">+{run.xp} XP</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {new Date(run.created_at).toLocaleDateString('ru-RU', {
                      day: 'numeric',
                      month: 'long'
                    })}
                  </p>
                  <RunLikeControl
                    likesCount={run.likesCount}
                    likedByMe={run.likedByMe}
                    pending={pendingRunIds.includes(run.id)}
                    onToggle={() => handleLikeToggle(run.id)}
                  />
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
