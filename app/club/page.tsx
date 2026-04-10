'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import ChallengesSection from '@/components/ChallengesSection'
import InnerPageHeader from '@/components/InnerPageHeader'
import WeeklyLeaderboard from '@/components/WeeklyLeaderboard'
import { getBootstrapUser } from '@/lib/auth'
import { formatAveragePace, formatDistanceKm } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { loadWeeklyXpLeaderboard, type WeeklyXpLeaderboard } from '@/lib/weekly-xp'

type ClubTab = 'challenges' | 'leaderboard'

type WeeklyRunRow = {
  user_id: string
  distance_km: number | null
  duration_minutes?: number | null
  duration_seconds?: number | null
  moving_time_seconds?: number | null
  elevation_gain_meters?: number | null
}

type ClubWeeklyStats = {
  totalDistanceKm: number
  totalRuns: number
  totalMovingTimeSeconds: number
  totalElevationGainMeters: number
  userDistanceKm: number
}

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

export default function ClubPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<ClubTab>('challenges')
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [leaderboard, setLeaderboard] = useState<WeeklyXpLeaderboard | null>(null)
  const [clubStats, setClubStats] = useState<ClubWeeklyStats | null>(null)
  const [leaderboardLoading, setLeaderboardLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [leaderboardError, setLeaderboardError] = useState('')
  const [statsError, setStatsError] = useState('')

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
      setLeaderboard(null)
      setClubStats(null)
      setLeaderboardLoading(false)
      setStatsLoading(false)
      return
    }

    let isMounted = true

    async function loadClubData() {
      setLeaderboardError('')
      setStatsError('')
      setLeaderboardLoading(true)
      setStatsLoading(true)

      try {
        const nextLeaderboard = await loadWeeklyXpLeaderboard(user.id)

        if (!isMounted) return

        setLeaderboard(nextLeaderboard)
        setLeaderboardLoading(false)

        if (!nextLeaderboard.week) {
          setClubStats(null)
          setStatsLoading(false)
          return
        }

        const { data: runsData, error: runsError } = await supabase
          .from('runs')
          .select('user_id, distance_km, duration_minutes, duration_seconds, moving_time_seconds, elevation_gain_meters')
          .gte('created_at', nextLeaderboard.week.startsAt)
          .lt('created_at', nextLeaderboard.week.endsAt)

        if (!isMounted) return

        if (runsError) {
          setClubStats(null)
          setStatsError('Не удалось загрузить статистику клуба')
          setStatsLoading(false)
          return
        }

        setClubStats(buildClubWeeklyStats((runsData ?? []) as WeeklyRunRow[], user.id))
      } catch {
        if (!isMounted) return

        setLeaderboard(null)
        setClubStats(null)
        setLeaderboardError('Не удалось загрузить рейтинг')
      } finally {
        if (isMounted) {
          setLeaderboardLoading(false)
          setStatsLoading(false)
        }
      }
    }

    void loadClubData()

    return () => {
      isMounted = false
    }
  }, [user])

  if (authLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        Загрузка...
      </main>
    )
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

  const totalDistanceKm = clubStats?.totalDistanceKm ?? 0
  const userDistanceKm = clubStats?.userDistanceKm ?? 0
  const contributionPercent = totalDistanceKm > 0 ? (userDistanceKm / totalDistanceKm) * 100 : 0
  const hasActiveRaceWeek = Boolean(leaderboard?.week)

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
        <ChallengesSection showTitle={false} />
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
          ) : hasActiveRaceWeek && clubStats ? (
            <>
              <section className="app-card mb-4 rounded-2xl border p-4 shadow-sm">
                <p className="app-text-primary text-lg font-semibold">Статистика клуба за неделю</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <p className="app-text-secondary text-sm">Дистанция</p>
                    <p className="app-text-primary mt-1 text-lg font-semibold">{formatDistanceKm(clubStats.totalDistanceKm)} км</p>
                  </div>
                  <div>
                    <p className="app-text-secondary text-sm">Тренировки</p>
                    <p className="app-text-primary mt-1 text-lg font-semibold">{clubStats.totalRuns}</p>
                  </div>
                  <div>
                    <p className="app-text-secondary text-sm">Средний темп</p>
                    <p className="app-text-primary mt-1 text-lg font-semibold">{formatAveragePace(clubStats.totalMovingTimeSeconds, clubStats.totalDistanceKm)}</p>
                  </div>
                  <div>
                    <p className="app-text-secondary text-sm">Набор высоты</p>
                    <p className="app-text-primary mt-1 text-lg font-semibold">{Math.round(clubStats.totalElevationGainMeters)} м</p>
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
                  {formatDistanceKm(userDistanceKm)} из {formatDistanceKm(totalDistanceKm)} км за текущую неделю.
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
            currentUserId={user.id}
            loading={leaderboardLoading}
            error={leaderboardError}
          />

          <div className="mb-4">
            <Link href="/race" className="app-text-secondary text-sm underline underline-offset-4">
              Открыть экран гонки недели
            </Link>
          </div>
        </div>
      )}
    </main>
  )
}
