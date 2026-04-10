'use client'

import { CheckCircle2, ChevronRight, LoaderCircle, Trash2, Trophy } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import ActivityReturnState from '@/components/ActivityReturnState'
import ActivityDistanceChart from '@/components/ActivityDistanceChart'
import ActivitySummaryGrid from '@/components/ActivitySummaryGrid'
import ConfirmActionSheet from '@/components/ConfirmActionSheet'
import { getBootstrapUser } from '@/lib/auth'
import { isRaceEventUpcoming, loadRaceEvents } from '@/lib/race-events'
import type { User } from '@supabase/supabase-js'
import {
  buildActivitySummary,
  getRunsForPeriod,
  type ActivityRunRow,
  loadActivityRuns,
  type ActivityPeriod,
} from '@/lib/activity'
import { loadUserAchievements, type UserAchievement } from '@/lib/achievements-client'
import {
  formatAveragePace,
  formatDistanceKm,
  formatDurationCompact,
  formatRunDateLabel,
  formatRunSourceLabel,
  formatRunTimestampLabel,
} from '@/lib/format'
import { deleteRun } from '@/lib/runs'
import { dispatchRunsUpdatedEvent, RUNS_UPDATED_EVENT, RUNS_UPDATED_STORAGE_KEY } from '@/lib/runs-refresh'

const PERIOD_OPTIONS: { id: ActivityPeriod; label: string }[] = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'year', label: 'Год' },
  { id: 'all', label: 'Все' },
]

const DEFAULT_WORKOUT_NAME = 'Бег'
const FASTEST_RUN_MIN_DISTANCE_KM = 3

function formatDistance(value: number) {
  return formatDistanceKm(value)
}

function formatInsightValueWithDate(value: string, dateString: string | null | undefined) {
  if (!dateString) {
    return value
  }

  const dateLabel = formatRunDateLabel(dateString)
  return dateLabel === 'Дата неизвестна' ? value : `${value} · ${dateLabel}`
}

function getMovingTimeSeconds(run: Pick<ActivityRunRow, 'moving_time_seconds'>) {
  if (!Number.isFinite(run.moving_time_seconds) || (run.moving_time_seconds ?? 0) <= 0) {
    return null
  }

  return Math.round(run.moving_time_seconds ?? 0)
}

function startOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function startOfWeek(date: Date) {
  const next = startOfDay(date)
  const day = next.getDay()
  const diff = day === 0 ? -6 : 1 - day
  next.setDate(next.getDate() + diff)
  return next
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function getPreviousPeriodRange(period: ActivityPeriod, now: Date = new Date()) {
  if (period === 'week') {
    const currentStart = startOfWeek(now)
    return {
      start: addDays(currentStart, -7),
      end: currentStart,
      label: 'к прошлой неделе',
    }
  }

  if (period === 'month') {
    const currentStart = startOfMonth(now)
    return {
      start: new Date(currentStart.getFullYear(), currentStart.getMonth() - 1, 1),
      end: currentStart,
      label: 'к прошлому месяцу',
    }
  }

  if (period === 'year') {
    const currentStart = startOfYear(now)
    return {
      start: new Date(currentStart.getFullYear() - 1, 0, 1),
      end: currentStart,
      label: 'к прошлому году',
    }
  }

  return null
}

function formatTwoDigits(value: number) {
  return String(value).padStart(2, '0')
}

function getRunDisplayName(run: Pick<ActivityRunRow, 'name' | 'title'>) {
  return run.name?.trim() || run.title?.trim() || DEFAULT_WORKOUT_NAME
}

function getRunDurationSeconds(run: Pick<ActivityRunRow, 'duration_minutes' | 'duration_seconds'>) {
  if (Number.isFinite(run.duration_seconds) && (run.duration_seconds ?? 0) > 0) {
    return Math.round(run.duration_seconds ?? 0)
  }

  return Math.round(Number(run.duration_minutes ?? 0) * 60)
}

function formatDurationMinutesLabel(totalMinutes: number) {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    return '0 мин'
  }

  if (totalMinutes < 60) {
    return `${totalMinutes} мин`
  }

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (minutes === 0) {
    return `${hours} ч`
  }

  return `${hours} ч ${minutes} мин`
}

function formatPreciseDurationLabel(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '0:00'
  }

  const normalizedSeconds = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(normalizedSeconds / 3600)
  const minutes = Math.floor((normalizedSeconds % 3600) / 60)
  const seconds = normalizedSeconds % 60

  if (hours > 0) {
    return `${hours}:${formatTwoDigits(minutes)}:${formatTwoDigits(seconds)}`
  }

  return `${minutes}:${formatTwoDigits(seconds)}`
}

function formatRunDurationLabel(run: Pick<ActivityRunRow, 'duration_minutes' | 'duration_seconds'>) {
  const totalSeconds = getRunDurationSeconds(run)

  if (Number.isFinite(run.duration_seconds) && (run.duration_seconds ?? 0) > 0) {
    return formatPreciseDurationLabel(totalSeconds)
  }

  return formatDurationMinutesLabel(Number(run.duration_minutes ?? 0))
}

function formatPreciseDistanceKm(value: number) {
  const fixed = value.toFixed(2)

  if (fixed.endsWith('00')) {
    return value.toFixed(1)
  }

  if (fixed.endsWith('0')) {
    return fixed.slice(0, -1)
  }

  return fixed
}

function formatDistanceKmLabel(run: Pick<ActivityRunRow, 'distance_km' | 'external_source'>) {
  const distanceValue = Number(run.distance_km ?? 0)

  if (run.external_source === 'strava') {
    return formatPreciseDistanceKm(distanceValue)
  }

  return formatDistanceKm(distanceValue)
}

function formatPaceLabel(totalSeconds: number, distanceKm: number) {
  if (distanceKm <= 0 || totalSeconds <= 0) return ''

  const paceSeconds = Math.round(totalSeconds / distanceKm)
  const minutes = Math.floor(paceSeconds / 60)
  const seconds = paceSeconds % 60

  return `${minutes}:${formatTwoDigits(seconds)}/км`
}

function formatRunPace(run: Pick<ActivityRunRow, 'distance_km' | 'duration_minutes' | 'duration_seconds'>) {
  const totalSeconds = getRunDurationSeconds(run)
  const distanceValue = Number(run.distance_km ?? 0)

  return formatPaceLabel(totalSeconds, distanceValue)
}

function formatRunMetaLabel(run: Pick<ActivityRunRow, 'created_at' | 'external_source' | 'xp'>) {
  const parts = [
    formatRunTimestampLabel(run.created_at, run.external_source),
    `⚡ +${Math.max(0, Math.round(Number(run.xp ?? 0)))} XP`,
  ]
  const sourceLabel = formatRunSourceLabel(run.external_source)

  if (sourceLabel) {
    parts.push(sourceLabel)
  }

  return parts.join(' • ')
}

function formatElevationGainLabel(totalElevationGainMeters: number) {
  if (!Number.isFinite(totalElevationGainMeters) || totalElevationGainMeters <= 0) {
    return ''
  }

  return `${Math.round(totalElevationGainMeters)} м`
}

function getAchievementCardClass(achievement: Pick<UserAchievement, 'source_type' | 'badge_code'>) {
  if (achievement.source_type === 'challenge') {
    return 'app-card rounded-2xl border border-emerald-300/60 bg-emerald-50/80 p-4 shadow-sm dark:border-emerald-400/20 dark:bg-emerald-400/10'
  }

  const badgeCode = achievement.badge_code

  if (badgeCode === 'weekly_race_1' || badgeCode === 'race_week_winner') {
    return 'app-card rounded-2xl border border-amber-300/80 bg-amber-50/90 p-4 shadow-sm dark:border-amber-400/30 dark:bg-amber-400/12'
  }

  if (badgeCode === 'weekly_race_2') {
    return 'app-card rounded-2xl border border-slate-300/70 bg-slate-50/85 p-4 shadow-sm dark:border-slate-400/25 dark:bg-slate-400/10'
  }

  if (badgeCode === 'weekly_race_3') {
    return 'app-card rounded-2xl border border-orange-300/75 bg-orange-50/85 p-4 shadow-sm dark:border-orange-400/25 dark:bg-orange-400/10'
  }

  if (badgeCode === 'race_week_top_3') {
    return 'app-card rounded-2xl border border-slate-300/70 bg-slate-50/85 p-4 shadow-sm dark:border-slate-400/25 dark:bg-slate-400/10'
  }

  if (badgeCode === 'race_week_top_10') {
    return 'app-card rounded-2xl border border-black/[0.07] bg-black/[0.025] p-4 shadow-sm dark:border-white/[0.1] dark:bg-white/[0.045]'
  }

  return 'app-card app-surface-muted rounded-2xl border border-black/[0.05] p-4 shadow-sm dark:border-white/[0.08]'
}

function getAchievementRankClass(badgeCode: string | null | undefined) {
  if (badgeCode === 'weekly_race_1' || badgeCode === 'race_week_winner') {
    return 'border border-amber-300/80 bg-amber-100/80 text-amber-900 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100'
  }

  if (badgeCode === 'weekly_race_2') {
    return 'border border-slate-300/80 bg-slate-100/90 text-slate-700 dark:border-slate-300/20 dark:bg-slate-300/10 dark:text-slate-100'
  }

  if (badgeCode === 'weekly_race_3') {
    return 'border border-orange-300/80 bg-orange-100/90 text-orange-800 dark:border-orange-300/20 dark:bg-orange-300/10 dark:text-orange-100'
  }

  if (badgeCode === 'race_week_top_3') {
    return 'border border-slate-300/80 bg-slate-100/90 text-slate-700 dark:border-slate-300/20 dark:bg-slate-300/10 dark:text-slate-100'
  }

  return 'border border-black/[0.06] bg-black/[0.04] text-black/70 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-white/80'
}

function getAchievementIconWrapperClass(achievement: Pick<UserAchievement, 'source_type' | 'badge_code'>) {
  if (achievement.source_type === 'challenge') {
    return 'border border-emerald-300/70 bg-emerald-100/90 text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-100'
  }

  if (achievement.badge_code === 'weekly_race_1' || achievement.badge_code === 'race_week_winner') {
    return 'border border-amber-300/80 bg-amber-100/90 text-amber-700 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100'
  }

  if (achievement.badge_code === 'weekly_race_2') {
    return 'border border-slate-300/80 bg-slate-100/90 text-slate-700 dark:border-slate-300/20 dark:bg-slate-300/10 dark:text-slate-100'
  }

  if (achievement.badge_code === 'weekly_race_3') {
    return 'border border-orange-300/80 bg-orange-100/90 text-orange-700 dark:border-orange-300/20 dark:bg-orange-300/10 dark:text-orange-100'
  }

  if (achievement.badge_code === 'race_week_top_3') {
    return 'border border-slate-300/80 bg-slate-100/90 text-slate-700 dark:border-slate-300/20 dark:bg-slate-300/10 dark:text-slate-100'
  }

  return 'border border-black/[0.06] bg-black/[0.04] text-black/65 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-white/80'
}

function AchievementIcon({ achievement }: { achievement: Pick<UserAchievement, 'source_type' | 'badge_code'> }) {
  const iconClassName = 'h-[18px] w-[18px]'

  if (achievement.source_type === 'challenge') {
    return <CheckCircle2 className={iconClassName} strokeWidth={2} />
  }

  return <Trophy className={iconClassName} strokeWidth={2} />
}

function getCompactAchievementSubtitle(achievement: Pick<UserAchievement, 'source_type' | 'subtitle'>) {
  if (achievement.source_type === 'challenge') {
    return 'Челлендж завершён'
  }

  return achievement.subtitle
}

export default function ActivityPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loadingUser, setLoadingUser] = useState(true)
  const [period, setPeriod] = useState<ActivityPeriod>('week')
  const [actionError, setActionError] = useState('')
  const [pendingDeleteRun, setPendingDeleteRun] = useState<ActivityRunRow | null>(null)
  const [deletingRunIds, setDeletingRunIds] = useState<string[]>([])
  const suppressNextRunsUpdatedRefreshRef = useRef(false)
  const prepareRunDetailNavigationRef = useRef<(runId: string) => void>(() => {})

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

  const { data: runs, error, isLoading, mutate } = useSWR(
    user ? (['activity-runs', user.id] as const) : null,
    ([, userId]: readonly [string, string]) => loadActivityRuns(userId),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      dedupingInterval: 15000,
      focusThrottleInterval: 15000,
    }
  )
  const {
    data: achievements,
    error: achievementsError,
    isLoading: isAchievementsLoading,
  } = useSWR(
    user ? (['activity-achievements', user.id] as const) : null,
    () => loadUserAchievements(),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      dedupingInterval: 60000,
      focusThrottleInterval: 60000,
    }
  )
  const {
    data: raceEvents,
    error: raceEventsLoadError,
  } = useSWR(
    user ? (['race-events', user.id] as const) : null,
    () => loadRaceEvents(),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      dedupingInterval: 15000,
      focusThrottleInterval: 15000,
    }
  )

  const summary = useMemo(() => buildActivitySummary(runs ?? [], period), [runs, period])
  const filteredRuns = useMemo(() => getRunsForPeriod(runs ?? [], period), [runs, period])
  const chartTitle =
    period === 'year'
      ? 'Дистанция по месяцам'
      : period === 'all'
        ? 'Дистанция по годам'
        : 'Дистанция по дням'
  const shouldRenderEmptyState = summary.chartData.length === 0
  const deletingActiveRun = pendingDeleteRun ? deletingRunIds.includes(pendingDeleteRun.id) : false
  const summaryMetrics = useMemo(
    () => {
      const metrics = [
        {
          id: 'distance',
          label: 'Дистанция',
          value: `${formatDistance(summary.totalDistance)} км`,
        },
        {
          id: 'runs',
          label: 'Пробежки',
          value: String(summary.totalWorkouts),
        },
        {
          id: 'moving-time',
          label: 'В движении',
          value: formatDurationCompact(summary.totalMovingTimeSeconds),
        },
        {
          id: 'average-pace',
          label: 'Средний темп',
          value: formatAveragePace(summary.totalMovingTimeSeconds, summary.totalDistance),
        },
      ]
      const elevationLabel = formatElevationGainLabel(summary.totalElevationGainMeters)

      if (elevationLabel) {
        metrics.push({
          id: 'elevation-gain',
          label: 'Набор высоты',
          value: elevationLabel,
        })
      }

      return metrics
    },
    [summary]
  )
  const activityInsights = useMemo(() => {
    const longestRun = filteredRuns.reduce<ActivityRunRow | null>((bestRun, run) => {
      const distanceKm = Number(run.distance_km ?? 0)

      if (distanceKm <= 0) {
        return bestRun
      }

      if (!bestRun || distanceKm > Number(bestRun.distance_km ?? 0)) {
        return run
      }

      return bestRun
    }, null)

    const fastestRun = filteredRuns.reduce<ActivityRunRow | null>((bestRun, run) => {
      const distanceKm = Number(run.distance_km ?? 0)
      const movingTimeSeconds = getMovingTimeSeconds(run)

      if (distanceKm < FASTEST_RUN_MIN_DISTANCE_KM || !movingTimeSeconds) {
        return bestRun
      }

      const paceSeconds = movingTimeSeconds / distanceKm

      if (!Number.isFinite(paceSeconds) || paceSeconds <= 0) {
        return bestRun
      }

      if (!bestRun) {
        return run
      }

      const bestDistanceKm = Number(bestRun.distance_km ?? 0)
      const bestMovingTimeSeconds = getMovingTimeSeconds(bestRun)

      if (!bestMovingTimeSeconds || bestDistanceKm <= 0) {
        return run
      }

      const bestPaceSeconds = bestMovingTimeSeconds / bestDistanceKm
      return paceSeconds < bestPaceSeconds ? run : bestRun
    }, null)

    return {
      longestRun,
      fastestRun,
    }
  }, [filteredRuns])
  const progressInsight = useMemo(() => {
    const previousRange = getPreviousPeriodRange(period)

    if (!previousRange) {
      return null
    }

    const previousDistance = (runs ?? []).reduce((sum, run) => {
      const createdAt = new Date(run.created_at)

      if (Number.isNaN(createdAt.getTime()) || createdAt < previousRange.start || createdAt >= previousRange.end) {
        return sum
      }

      return sum + Math.max(0, Number(run.distance_km ?? 0))
    }, 0)

    if (!Number.isFinite(previousDistance) || previousDistance <= 0) {
      return null
    }

    const changePercent = Math.round(((summary.totalDistance - previousDistance) / previousDistance) * 100)

    if (!Number.isFinite(changePercent)) {
      return null
    }

    return {
      value: `${changePercent > 0 ? '+' : ''}${changePercent}%`,
      subtext: previousRange.label,
    }
  }, [period, runs, summary.totalDistance])
  const insightItems = useMemo(() => {
    const items: Array<{
      id: string
      label: string
      value: string
      subtext?: string
      tone?: 'positive' | 'negative'
    }> = []

    if (activityInsights.longestRun) {
      items.push({
        id: 'longest-run',
        label: 'Самый длинный',
        value: formatInsightValueWithDate(
          `${formatDistance(Number(activityInsights.longestRun.distance_km ?? 0))} км`,
          activityInsights.longestRun.created_at
        ),
      })
    }

    if (activityInsights.fastestRun) {
      items.push({
        id: 'fastest-run',
        label: 'Самый быстрый',
        value: formatInsightValueWithDate(
          formatAveragePace(
            getMovingTimeSeconds(activityInsights.fastestRun) ?? 0,
            Number(activityInsights.fastestRun.distance_km ?? 0)
          ),
          activityInsights.fastestRun.created_at
        ),
      })
    }

    if (summary.totalWorkouts > 0) {
      items.push({
        id: 'average-distance',
        label: 'В среднем',
        value: `${formatDistance(summary.totalDistance / summary.totalWorkouts)} км`,
        subtext: 'за тренировку',
      })
    }

    if (progressInsight) {
      items.push({
        id: 'progress',
        label: 'Прогресс',
        value: progressInsight.value,
        subtext: progressInsight.subtext,
        tone: progressInsight.value.startsWith('-') ? 'negative' : 'positive',
      })
    }

    return items
  }, [activityInsights, progressInsight, summary.totalDistance, summary.totalWorkouts])
  const upcomingRaceEventsCount = useMemo(
    () => (raceEvents ?? []).filter((raceEvent) => isRaceEventUpcoming(raceEvent)).length,
    [raceEvents]
  )
  const pastRaceEventsCount = useMemo(
    () => (raceEvents ?? []).filter((raceEvent) => !isRaceEventUpcoming(raceEvent)).length,
    [raceEvents]
  )

  useEffect(() => {
    if (!user) return

    function handleRunsUpdated() {
      if (suppressNextRunsUpdatedRefreshRef.current) {
        suppressNextRunsUpdatedRefreshRef.current = false
        return
      }

      void mutate()
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === RUNS_UPDATED_STORAGE_KEY) {
        void mutate()
      }
    }

    window.addEventListener(RUNS_UPDATED_EVENT, handleRunsUpdated)
    window.addEventListener('storage', handleStorage)

    return () => {
      window.removeEventListener(RUNS_UPDATED_EVENT, handleRunsUpdated)
      window.removeEventListener('storage', handleStorage)
    }
  }, [mutate, user])

  const handleRequestDelete = useCallback((run: ActivityRunRow) => {
    if (!user || run.user_id !== user.id || deletingRunIds.includes(run.id)) {
      return
    }

    setActionError('')
    setPendingDeleteRun(run)
  }, [deletingRunIds, user])

  const handleConfirmDelete = useCallback(async () => {
    if (!user || !pendingDeleteRun || pendingDeleteRun.user_id !== user.id) {
      return
    }

    const runId = pendingDeleteRun.id

    if (deletingRunIds.includes(runId)) {
      return
    }

    setActionError('')
    setDeletingRunIds((prev) => [...prev, runId])

    try {
      const { error: deleteError } = await deleteRun(runId)

      if (deleteError) {
        setActionError('Не удалось удалить тренировку')
        return
      }

      await mutate(
        (currentRuns) => (currentRuns ?? []).filter((run) => run.id !== runId),
        { revalidate: false }
      )
      setPendingDeleteRun(null)
      suppressNextRunsUpdatedRefreshRef.current = true
      dispatchRunsUpdatedEvent()
    } catch {
      setActionError('Не удалось удалить тренировку')
    } finally {
      setDeletingRunIds((prev) => prev.filter((id) => id !== runId))
    }
  }, [deletingRunIds, mutate, pendingDeleteRun, user])

  const handleOpenRunDetail = useCallback((runId: string) => {
    if (!runId) {
      return
    }

    prepareRunDetailNavigationRef.current(runId)
    router.push(`/runs/${runId}`)
  }, [router])

  if (!loadingUser && !user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

  const shouldShowPrimaryLoading = loadingUser || (isLoading && !runs)

  return (
    <main className="min-h-screen pt-[env(safe-area-inset-top)] md:pt-0">
      <ActivityReturnState
        period={period}
        onRestorePeriod={setPeriod}
        restoreReady={!loadingUser && !isLoading}
        onReady={(prepare) => {
          prepareRunDetailNavigationRef.current = prepare
        }}
      />
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:max-w-7xl md:px-8 md:py-6">
        <div className="mb-5 md:mb-8">
          <h1 className="app-text-primary text-2xl font-bold">Активность</h1>
          <p className="app-text-secondary mt-1 text-sm">Твоя беговая статистика за выбранный период.</p>
        </div>

        <div className="mb-5 space-y-3 md:mb-8">
          <Link
            href="/runs"
            className="app-card flex items-start justify-between gap-3 rounded-2xl p-4 shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:ring-white/10"
          >
            <div className="min-w-0">
              <p className="app-text-primary text-base font-semibold">Тренировки</p>
              <p className="app-text-secondary mt-1 text-sm">
                Добавь новую тренировку и смотри историю ниже.
              </p>
              <p className="app-text-secondary mt-2 text-xs font-medium">
                Добавить и посмотреть историю
              </p>
            </div>
            <ChevronRight className="app-text-muted mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          </Link>

          <Link
            href="/activity/shoes"
            className="app-card flex items-start justify-between gap-3 rounded-2xl p-4 shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:ring-white/10"
          >
            <div className="min-w-0">
              <p className="app-text-primary text-base font-semibold">Кроссовки</p>
              <p className="app-text-secondary mt-1 text-sm">
                Добавляй пары и следи за их пробегом в одном месте.
              </p>
              <p className="app-text-secondary mt-2 text-xs font-medium">
                Пары и пробег
              </p>
            </div>
            <ChevronRight className="app-text-muted mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          </Link>

          <Link
            href="/races"
            className="app-card flex items-start justify-between gap-3 rounded-2xl p-4 shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:ring-white/10"
          >
            <div className="min-w-0">
              <p className="app-text-primary text-base font-semibold">Старты</p>
              <p className="app-text-secondary mt-1 text-sm">
                Календарь стартов, результаты и связанные тренировки.
              </p>
              {!raceEventsLoadError ? (
                <p className="app-text-secondary mt-2 text-xs font-medium">
                  Предстоящие: {upcomingRaceEventsCount} • Прошедшие: {pastRaceEventsCount}
                </p>
              ) : (
                <p className="mt-2 text-xs font-medium text-red-600">Не удалось загрузить сводку стартов</p>
              )}
            </div>
            <ChevronRight className="app-text-muted mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          </Link>
        </div>

        <div className="mb-5 flex flex-wrap gap-2 md:mb-8 md:gap-2.5">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setPeriod(option.id)}
              className={`min-h-11 rounded-full border px-4 py-2 text-sm font-medium ${
                period === option.id ? 'app-button-primary' : 'app-button-secondary'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {shouldShowPrimaryLoading ? (
          <>
            <div className="app-card rounded-2xl p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 md:p-5">
              <div className="skeleton-line h-4 w-28" />
              <div className="mt-3 skeleton-line h-9 w-36" />
              <div className="mt-4 skeleton-line h-4 w-28" />
              <div className="mt-2 skeleton-line h-7 w-24" />
            </div>
            <div className="app-card mt-4 rounded-2xl p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 md:p-5">
              <div className="skeleton-line h-4 w-24" />
              <div className="mt-3 skeleton-line h-52 w-full md:h-56" />
            </div>
          </>
        ) : error ? (
          <div className="app-card rounded-2xl p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 md:p-5">
            <p className="text-sm text-red-600">Не удалось загрузить активность</p>
          </div>
        ) : runs && runs.length === 0 ? (
          <div className="app-card rounded-2xl p-5 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10 md:p-6">
            <p className="app-text-secondary text-sm">Статистика появится после первой тренировки.</p>
            <p className="app-text-secondary mt-2 text-sm">Добавьте пробежку и возвращайтесь за графиком.</p>
          </div>
        ) : (
          <>
            <div className="space-y-4 md:space-y-5">
              <ActivitySummaryGrid
                title="Сводка по периоду"
                subtitle="Твои ключевые показатели за выбранный диапазон."
                metrics={summaryMetrics}
                compact
                className="bg-black/[0.015] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.035)] dark:bg-white/[0.025] dark:ring-white/8 md:p-5"
                metricClassName="bg-black/[0.02] dark:bg-white/[0.03]"
                valueClassName="font-semibold"
              />

              {insightItems.length > 0 ? (
                <ActivitySummaryGrid
                  title="Инсайты"
                  metrics={insightItems}
                  compact
                />
              ) : null}

              <div className="app-card mt-2 min-w-0 overflow-hidden rounded-2xl p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 md:mt-3 md:p-5">
                <p className="app-text-secondary text-sm font-medium">{chartTitle}</p>
                {shouldRenderEmptyState ? (
                  <div className="app-text-secondary mt-6 text-center text-sm">
                    <p>За этот период пока нет данных.</p>
                    <p className="mt-2">Попробуйте выбрать другой диапазон.</p>
                  </div>
                ) : (
                  <div className="mt-3 w-full md:mt-3.5">
                    <ActivityDistanceChart
                      key={period}
                      data={summary.chartData}
                      mode={period}
                      heightClassName="h-[220px] md:h-[300px]"
                    />
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {!loadingUser && !isLoading && !error ? (
          <section className="mt-5 md:mt-8">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="app-text-primary text-lg font-semibold">Достижения</h2>
              <Link href="/activity/achievements" className="app-text-secondary text-sm font-medium">
                Все достижения
              </Link>
            </div>
            {isAchievementsLoading && !achievements ? (
              <div className="app-card rounded-2xl p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
                <div className="skeleton-line h-4 w-32" />
                <div className="mt-3 skeleton-line h-4 w-24" />
              </div>
            ) : achievementsError ? (
              <div className="app-card rounded-2xl p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
                <p className="text-sm text-red-600">Не удалось загрузить достижения</p>
              </div>
            ) : !achievements || achievements.length === 0 ? (
              <div className="app-card rounded-2xl p-5 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10 md:p-6">
                <p className="app-text-secondary text-sm">Пока нет достижений</p>
              </div>
            ) : (
              <div className="space-y-3">
                {achievements.slice(0, 3).map((achievement) => (
                  achievement.source_type === 'weekly_race' && achievement.href ? (
                    <button
                      key={achievement.id}
                      type="button"
                      onClick={() => router.push(achievement.href!)}
                      className={`${getAchievementCardClass(achievement)} block w-full cursor-pointer text-left transition-transform transition-shadow hover:shadow-md active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/20`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${getAchievementIconWrapperClass(achievement)}`}
                            aria-hidden="true"
                          >
                            <AchievementIcon achievement={achievement} />
                          </div>
                          <div className="min-w-0">
                            <p className="app-text-primary text-base font-semibold">
                              {achievement.label}
                            </p>
                            <p className="app-text-secondary mt-1 text-sm">
                              {getCompactAchievementSubtitle(achievement)}
                            </p>
                          </div>
                        </div>
                        {achievement.rank ? (
                          <p
                            className={`max-w-full break-words rounded-full px-2.5 py-1 text-xs font-semibold ${getAchievementRankClass(achievement.badge_code)}`}
                          >
                            #{achievement.rank}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  ) : (
                    <div
                      key={achievement.id}
                      className={getAchievementCardClass(achievement)}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${getAchievementIconWrapperClass(achievement)}`}
                            aria-hidden="true"
                          >
                            <AchievementIcon achievement={achievement} />
                          </div>
                          <div className="min-w-0">
                            <p className="app-text-primary text-base font-semibold">
                              {achievement.label}
                            </p>
                            <p className="app-text-secondary mt-1 text-sm">
                              {getCompactAchievementSubtitle(achievement)}
                            </p>
                          </div>
                        </div>
                        {achievement.source_type === 'weekly_race' && achievement.rank ? (
                          <p
                            className={`max-w-full break-words rounded-full px-2.5 py-1 text-xs font-semibold ${getAchievementRankClass(achievement.badge_code)}`}
                          >
                            #{achievement.rank}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  )
                ))}
              </div>
            )}
          </section>
        ) : null}

        {!loadingUser && !isLoading && !error ? (
          <section className="mt-5 md:mt-8">
            <h2 className="app-text-primary mb-3 text-lg font-semibold">Тренировки</h2>
            {actionError ? <p className="mb-3 text-sm text-red-600">{actionError}</p> : null}
            {filteredRuns.length === 0 ? (
              <div className="app-card rounded-2xl p-5 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10 md:p-6">
                <p className="app-text-secondary text-sm">За этот период тренировок нет</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredRuns.map((run) => (
                  <div
                    key={run.id}
                    className="compact-run-card app-card overflow-hidden rounded-2xl border border-black/5 px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-shadow duration-200 ease-in-out hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:border-white/10"
                  >
                    <div className="compact-run-card-layout flex flex-col gap-4 sm:flex-row sm:items-start">
                      <button
                        type="button"
                        onClick={() => handleOpenRunDetail(run.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="app-text-primary break-words text-[15px] font-semibold leading-5">
                          {getRunDisplayName(run)}
                        </p>
                        <div className="compact-run-card-primary compact-run-card-title app-text-primary mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold leading-tight sm:text-base">
                          <span className="break-words">{formatDistanceKmLabel(run)} км</span>
                          <span className="app-text-secondary">•</span>
                          <span className="break-words">{formatRunDurationLabel(run)}</span>
                          {formatRunPace(run) ? (
                            <>
                              <span className="app-text-secondary">•</span>
                              <span className="break-words">{formatRunPace(run)}</span>
                            </>
                          ) : null}
                        </div>
                        <p className="compact-run-card-secondary compact-run-card-meta app-text-secondary mt-1.5 break-words text-sm">
                          {formatRunMetaLabel(run)}
                        </p>
                      </button>
                      {run.user_id === user.id ? (
                        <button
                          type="button"
                          onClick={() => handleRequestDelete(run)}
                          disabled={deletingRunIds.includes(run.id)}
                          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-red-500/20 px-3 py-2 text-red-500 transition-colors disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/25 sm:min-w-11 sm:w-auto sm:shrink-0"
                          aria-label={deletingRunIds.includes(run.id) ? 'Тренировка удаляется' : 'Удалить тренировку'}
                        >
                          {deletingRunIds.includes(run.id) ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
                          )}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>
      <ConfirmActionSheet
        open={Boolean(pendingDeleteRun)}
        title="Удалить тренировку?"
        description="Это действие нельзя отменить."
        confirmLabel={deletingActiveRun ? 'Удаляем...' : 'Удалить'}
        cancelLabel="Отмена"
        loading={deletingActiveRun}
        destructive
        onConfirm={() => {
          void handleConfirmDelete()
        }}
        onCancel={() => {
          if (!deletingActiveRun) {
            setPendingDeleteRun(null)
          }
        }}
      />
    </main>
  )
}
