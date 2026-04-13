'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import ChallengesSection from '@/components/ChallengesSection'
import InnerPageHeader from '@/components/InnerPageHeader'
import WeeklyLeaderboard from '@/components/WeeklyLeaderboard'
import { getBootstrapUser } from '@/lib/auth'
import { loadChallengesOverview, type ChallengesOverview } from '@/lib/challenges'
import { formatAveragePace, formatDistanceKm } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { loadWeeklyXpLeaderboard, type WeeklyXpLeaderboard } from '@/lib/weekly-xp'

type ClubTab = 'challenges' | 'leaderboard'
type ClubStatsPeriod = 'week' | 'month'

type WeeklyRunRow = {
  user_id: string
  distance_km: number | null
  created_at?: string | null
  duration_minutes?: number | null
  duration_seconds?: number | null
  moving_time_seconds?: number | null
  elevation_gain_meters?: number | null
}

type ProfileAccessRow = {
  id: string
  app_access_status: 'active' | 'blocked' | null
}

type ClubWeeklyStats = {
  totalDistanceKm: number
  totalRuns: number
  totalMovingTimeSeconds: number
  totalElevationGainMeters: number
  userDistanceKm: number
}

type ClubStatsByPeriod = Record<ClubStatsPeriod, ClubWeeklyStats>

function toSafeNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0
}

function resolveDurationSeconds(run: Pick<WeeklyRunRow, 'moving_time_seconds' | 'duration_seconds' | 'duration_minutes'>) {
  if (Number.isFinite(run.moving_time_seconds) && (run.moving_time_seconds ?? 0) > 0) {
    return Math.round(run.moving_time_seconds ?? 0)
  }

  if (Number.isFinite(run.duration_seconds) && (run.duration_seconds ?? 0) > 0) {
    return Math.round(run.duration_seconds ?? 0)
  }

  if (Number.isFinite(run.duration_minutes) && (run.duration_minutes ?? 0) > 0) {
    return Math.round(Number(run.duration_minutes ?? 0) * 60)
  }

  return 0
}

function buildClubWeeklyStats(runs: WeeklyRunRow[], userId: string): ClubWeeklyStats {
  return runs.reduce<ClubWeeklyStats>((stats, run) => {
    const distanceKm = Math.max(0, toSafeNumber(run.distance_km))
    const durationSeconds = resolveDurationSeconds(run)
    const elevationGainMeters = Math.max(0, toSafeNumber(run.elevation_gain_meters))

    stats.totalDistanceKm += distanceKm
    stats.totalRuns += 1
    stats.totalMovingTimeSeconds += durationSeconds
    stats.totalElevationGainMeters += elevationGainMeters

    if (run.user_id === userId) {
      stats.userDistanceKm += distanceKm
    }

    return stats
  }, {
    totalDistanceKm: 0,
    totalRuns: 0,
    totalMovingTimeSeconds: 0,
    totalElevationGainMeters: 0,
    userDistanceKm: 0,
  })
}

function formatContributionPercent(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(value, 100)) : 0
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(safeValue)}%`
}

function getCurrentMonthRange() {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  return {
    startsAt: monthStart.toISOString(),
    endsAt: nextMonthStart.toISOString(),
  }
}

function isRunInRange(runCreatedAt: string | null | undefined, startsAt: string, endsAt: string) {
  if (!runCreatedAt) {
    return false
  }

  const runTimestamp = new Date(runCreatedAt).getTime()
  const startTimestamp = new Date(startsAt).getTime()
  const endTimestamp = new Date(endsAt).getTime()

  if (Number.isNaN(runTimestamp) || Number.isNaN(startTimestamp) || Number.isNaN(endTimestamp)) {
    return false
  }

  return runTimestamp >= startTimestamp && runTimestamp < endTimestamp
}

export default function ClubPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<ClubTab>('challenges')
  const [statsPeriod, setStatsPeriod] = useState<ClubStatsPeriod>('week')
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [challengesOverview, setChallengesOverview] = useState<ChallengesOverview | null>(null)
  const [challengesLoading, setChallengesLoading] = useState(true)
  const [challengesError, setChallengesError] = useState('')
  const [leaderboard, setLeaderboard] = useState<WeeklyXpLeaderboard | null>(null)
  const [clubStats, setClubStats] = useState<ClubStatsByPeriod | null>(null)
  const [leaderboardLoading, setLeaderboardLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [leaderboardError, setLeaderboardError] = useState('')
  const [statsError, setStatsError] = useState('')
  const [hasLoadedChallengesTab, setHasLoadedChallengesTab] = useState(false)
  const [hasLoadedLeaderboardTab, setHasLoadedLeaderboardTab] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function loadUser() {
      try {
        const nextUser = await getBootstrapUser()

        if (!isMounted) return

        setUser(nextUser)

        if (!nextUser) {
          router.replace('/login')
        }
      } finally {
        if (isMounted) {
          setAuthLoading(false)
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
      setChallengesOverview(null)
      setChallengesLoading(false)
      setChallengesError('')
      setHasLoadedChallengesTab(false)
      setLeaderboard(null)
      setClubStats(null)
      setLeaderboardLoading(false)
      setStatsLoading(false)
      setLeaderboardError('')
      setStatsError('')
      setHasLoadedLeaderboardTab(false)
      return
    }
  }, [user])

  useEffect(() => {
    if (activeTab !== 'challenges' || hasLoadedChallengesTab) {
      return
    }

    let isMounted = true

    async function loadChallengesTabData() {
      setChallengesError('')
      setChallengesLoading(true)

      try {
        const nextOverview = await loadChallengesOverview({ includeCompleted: false })

        if (!isMounted) return

        setChallengesOverview(nextOverview)
      } catch {
        if (!isMounted) return

        setChallengesOverview(null)
        setChallengesError('Не удалось загрузить челленджи')
      } finally {
        if (isMounted) {
          setChallengesLoading(false)
          setHasLoadedChallengesTab(true)
        }
      }
    }

    void loadChallengesTabData()

    return () => {
      isMounted = false
    }
  }, [activeTab, hasLoadedChallengesTab])

  useEffect(() => {
    if (!user) {
      return
    }

    if (activeTab !== 'leaderboard' || hasLoadedLeaderboardTab) {
      return
    }

    const userId = user.id
    let isMounted = true

    async function loadLeaderboardTabData() {
      setLeaderboardError('')
      setStatsError('')
      setLeaderboardLoading(true)
      setStatsLoading(true)

      try {
        const nextLeaderboard = await loadWeeklyXpLeaderboard(userId)

        if (!isMounted) return

        setLeaderboard(nextLeaderboard)
        setLeaderboardLoading(false)

        if (!nextLeaderboard.week) {
          setClubStats(null)
          setStatsLoading(false)
          return
        }

        const currentMonth = getCurrentMonthRange()
        const queryStartsAt = new Date(
          Math.min(new Date(nextLeaderboard.week.startsAt).getTime(), new Date(currentMonth.startsAt).getTime())
        ).toISOString()
        const queryEndsAt = new Date(
          Math.max(new Date(nextLeaderboard.week.endsAt).getTime(), new Date(currentMonth.endsAt).getTime())
        ).toISOString()

        const { data: runsData, error: runsError } = await supabase
          .from('runs')
          .select('user_id, distance_km, duration_minutes, duration_seconds, moving_time_seconds, elevation_gain_meters, created_at')
          .gte('created_at', queryStartsAt)
          .lt('created_at', queryEndsAt)

        if (!isMounted) return

        if (runsError) {
          setClubStats(null)
          setStatsError('Не удалось загрузить статистику клуба')
          setStatsLoading(false)
          return
        }

        const allRuns = (runsData ?? []) as WeeklyRunRow[]
        const userIds = Array.from(new Set(allRuns.map((run) => run.user_id)))
        const { data: profilesData, error: profilesError } = userIds.length === 0
          ? { data: [] as ProfileAccessRow[], error: null }
          : await supabase
              .from('profiles')
              .select('id, app_access_status')
              .in('id', userIds)

        if (!isMounted) return

        if (profilesError) {
          setClubStats(null)
          setStatsError('Не удалось загрузить статистику клуба')
          setStatsLoading(false)
          return
        }

        const activeUserIds = new Set(
          ((profilesData as ProfileAccessRow[] | null) ?? [])
            .filter((profile) => profile.app_access_status === 'active')
            .map((profile) => profile.id)
        )
        const activeRuns = allRuns.filter((run) => activeUserIds.has(run.user_id))
        const weekRuns = activeRuns.filter((run) =>
          isRunInRange(run.created_at, nextLeaderboard.week!.startsAt, nextLeaderboard.week!.endsAt)
        )
        const monthRuns = activeRuns.filter((run) =>
          isRunInRange(run.created_at, currentMonth.startsAt, currentMonth.endsAt)
        )

        setClubStats({
          week: buildClubWeeklyStats(weekRuns, userId),
          month: buildClubWeeklyStats(monthRuns, userId),
        })
      } catch {
        if (!isMounted) return

        setLeaderboard(null)
        setClubStats(null)
        setLeaderboardError('Не удалось загрузить рейтинг')
      } finally {
        if (isMounted) {
          setLeaderboardLoading(false)
          setStatsLoading(false)
          setHasLoadedLeaderboardTab(true)
        }
      }
    }

    void loadLeaderboardTabData()

    return () => {
      isMounted = false
    }
  }, [activeTab, hasLoadedLeaderboardTab, user])

  if (!authLoading && !user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

  const selectedClubStats = clubStats?.[statsPeriod] ?? null
  const totalDistanceKm = selectedClubStats?.totalDistanceKm ?? 0
  const userDistanceKm = selectedClubStats?.userDistanceKm ?? 0
  const contributionPercent = totalDistanceKm > 0 ? (userDistanceKm / totalDistanceKm) * 100 : 0
  const hasActiveRaceWeek = Boolean(leaderboard?.week)
  const currentUserId = user?.id ?? ''
  const statsPeriodLabel = statsPeriod === 'week' ? 'неделю' : 'месяц'
  const contributionPeriodLabel = statsPeriod === 'week' ? 'текущую неделю' : 'текущий месяц'

  return (
    <main className="min-h-screen">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30">
        <div className="pointer-events-auto mx-auto max-w-xl px-4 md:px-4">
          <InnerPageHeader title="Клуб" fallbackHref="/" />
        </div>
      </div>

      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <div aria-hidden="true" className="invisible">
          <InnerPageHeader title="Клуб" fallbackHref="/" />
        </div>

        <div className="mt-4">
          <div className="app-surface-muted mb-4 grid grid-cols-2 rounded-xl p-1">
            <button
              type="button"
              onClick={() => setActiveTab('challenges')}
              className={`min-h-11 rounded-lg px-4 py-3 text-sm font-medium ${
                activeTab === 'challenges' ? 'app-card shadow-sm' : 'app-text-secondary'
              }`}
            >
              Челленджи
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('leaderboard')}
              className={`min-h-11 rounded-lg px-4 py-3 text-sm font-medium ${
                activeTab === 'leaderboard' ? 'app-card shadow-sm' : 'app-text-secondary'
              }`}
            >
              Рейтинг
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'challenges' ? (
        <ChallengesSection
          showTitle={false}
          overview={challengesOverview}
          loading={authLoading || challengesLoading}
          error={challengesError}
        />
      ) : (
        <div className="mx-auto max-w-xl px-4 pb-4 md:px-4">
          {statsLoading ? (
            <>
              <div className="app-card mb-4 rounded-2xl border p-4 shadow-sm">
                <div className="skeleton-line h-4 w-28" />
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="skeleton-line h-4 w-20" />
                    <div className="skeleton-line h-6 w-24" />
                  </div>
                  <div className="space-y-2">
                    <div className="skeleton-line h-4 w-20" />
                    <div className="skeleton-line h-6 w-20" />
                  </div>
                  <div className="space-y-2">
                    <div className="skeleton-line h-4 w-24" />
                    <div className="skeleton-line h-6 w-24" />
                  </div>
                  <div className="space-y-2">
                    <div className="skeleton-line h-4 w-24" />
                    <div className="skeleton-line h-6 w-24" />
                  </div>
                </div>
              </div>
              <div className="app-card mb-4 rounded-2xl border p-4 shadow-sm">
                <div className="skeleton-line h-4 w-24" />
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="skeleton-line h-4 w-28" />
                    <div className="skeleton-line h-6 w-24" />
                  </div>
                  <div className="space-y-2">
                    <div className="skeleton-line h-4 w-24" />
                    <div className="skeleton-line h-6 w-20" />
                  </div>
                </div>
              </div>
            </>
          ) : hasActiveRaceWeek && selectedClubStats ? (
            <>
              <div className="app-surface-muted mb-4 inline-grid grid-cols-2 rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => setStatsPeriod('week')}
                  className={`min-h-11 rounded-lg px-4 py-3 text-sm font-medium ${
                    statsPeriod === 'week' ? 'app-card shadow-sm' : 'app-text-secondary'
                  }`}
                >
                  Неделя
                </button>
                <button
                  type="button"
                  onClick={() => setStatsPeriod('month')}
                  className={`min-h-11 rounded-lg px-4 py-3 text-sm font-medium ${
                    statsPeriod === 'month' ? 'app-card shadow-sm' : 'app-text-secondary'
                  }`}
                >
                  Месяц
                </button>
              </div>

              <section className="app-card mb-4 rounded-2xl border p-4 shadow-sm">
                <p className="app-text-primary text-lg font-semibold">Статистика клуба за {statsPeriodLabel}</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <p className="app-text-secondary text-sm">Дистанция</p>
                    <p className="app-text-primary mt-1 text-lg font-semibold">{formatDistanceKm(selectedClubStats.totalDistanceKm)} км</p>
                  </div>
                  <div>
                    <p className="app-text-secondary text-sm">Тренировки</p>
                    <p className="app-text-primary mt-1 text-lg font-semibold">{selectedClubStats.totalRuns}</p>
                  </div>
                  <div>
                    <p className="app-text-secondary text-sm">Средний темп</p>
                    <p className="app-text-primary mt-1 text-lg font-semibold">{formatAveragePace(selectedClubStats.totalMovingTimeSeconds, selectedClubStats.totalDistanceKm)}</p>
                  </div>
                  <div>
                    <p className="app-text-secondary text-sm">Набор высоты</p>
                    <p className="app-text-primary mt-1 text-lg font-semibold">{Math.round(selectedClubStats.totalElevationGainMeters)} м</p>
                  </div>
                </div>
              </section>

              <section className="app-card mb-4 rounded-2xl border p-4 shadow-sm">
                <p className="app-text-primary text-lg font-semibold">Твой вклад</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <p className="app-text-secondary text-sm">Твоя дистанция</p>
                    <p className="app-text-primary mt-1 text-lg font-semibold">{formatDistanceKm(userDistanceKm)} км</p>
                  </div>
                  <div>
                    <p className="app-text-secondary text-sm">Доля клуба</p>
                    <p className="app-text-primary mt-1 text-lg font-semibold">{formatContributionPercent(contributionPercent)}</p>
                  </div>
                </div>
                <p className="app-text-secondary mt-3 text-sm">
                  {formatDistanceKm(userDistanceKm)} из {formatDistanceKm(totalDistanceKm)} км за {contributionPeriodLabel}.
                </p>
              </section>
            </>
          ) : !leaderboardError && !statsError ? (
            <div className="app-card mb-4 rounded-2xl border p-4 shadow-sm">
              <p className="app-text-secondary text-sm">Статистика недели появится, когда начнется текущая гонка.</p>
            </div>
          ) : null}

          {statsError ? (
            <div className="app-card mb-4 rounded-2xl border p-4 shadow-sm">
              <p className="text-sm text-red-600">{statsError}</p>
            </div>
          ) : null}

          <WeeklyLeaderboard
            leaderboard={leaderboard}
            currentUserId={currentUserId}
            loading={authLoading || leaderboardLoading}
            error={leaderboardError}
            href="/race"
          />
        </div>
      )}
    </main>
  )
}
