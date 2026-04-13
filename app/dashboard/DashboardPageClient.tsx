'use client'

import { Activity, Bell, Plus, Target, Trophy, User } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import ChallengeBadgeArtwork from '@/components/ChallengeBadgeArtwork'
import UnreadBadge from '@/components/chat/UnreadBadge'
import InfiniteWorkoutFeed from '@/components/InfiniteWorkoutFeed'
import LevelOverviewSheet from '@/components/LevelOverviewSheet'
import UserIdentitySummary from '@/components/UserIdentitySummary'
import WeeklyLeaderboard from '@/components/WeeklyLeaderboard'
import { loadRecentAffectedChallengeIds, prioritizeChallengesByIds } from '@/lib/challenge-ux'
import {
  loadLatestFinalizedRaceWeek,
  loadRaceWeekUserBadge,
  loadRaceWeekUserResult,
  type RaceWeekResultRow,
  type RaceWeekSummary,
} from '@/lib/race-results-client'
import {
  INBOX_UNREAD_UPDATED_EVENT,
  INBOX_UNREAD_UPDATED_STORAGE_KEY,
  loadInboxUnreadCount,
} from '@/lib/app-events-client'
import { loadDashboardOverview } from '@/lib/dashboard'
import type { DashboardActiveChallenge, DashboardOverview } from '@/lib/dashboard-overview'
import { formatDistanceKm } from '@/lib/format'
import { getProfileDisplayName } from '@/lib/profiles'
import { formatRaceWeekDateRange, getRaceBadgeLabel } from '@/lib/race-badges'
import { RUNS_UPDATED_EVENT, RUNS_UPDATED_STORAGE_KEY } from '@/lib/runs-refresh'
import { loadWeeklyXpLeaderboard, type WeeklyXpLeaderboard } from '@/lib/weekly-xp'
import { getLevelProgressFromXP, getRankTitleFromLevel } from '@/lib/xp'

type DashboardInitialUser = {
  id: string
  email: string | null
}

type DashboardInitialProfileSummary = {
  name: string | null
  nickname: string | null
  email: string | null
}

type DashboardInitialStats = {
  totalKmThisMonth: number
  runsCount: number
  totalXp: number
}

type DashboardInitialLevelProgress = {
  level: number
  nextLevelXP: number | null
  currentLevelXp: number
  xpToNextLevel: number
  progressPercent: number
}

type LastWeekResultsCardData = {
  weekId: string
  userResult: RaceWeekResultRow | null
  badgeText: string
  weekRangeLabel: string
}

const dashboardChallengeTypeLabels: Record<DashboardActiveChallenge['period_type'], string> = {
  challenge: 'По расписанию',
  weekly: 'Еженедельный',
  monthly: 'Ежемесячный',
  lifetime: 'Достижение',
}

const dashboardCardFocusRingClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/20'

const dashboardClickableCardClass = `app-card mb-4 block overflow-hidden rounded-xl border p-4 shadow-sm transition-[transform,box-shadow] hover:shadow-md active:scale-[0.995] ${dashboardCardFocusRingClass}`

const dashboardHeaderActionClass = `app-card relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border shadow-sm transition-[transform,box-shadow] hover:shadow-md active:scale-[0.98] ${dashboardCardFocusRingClass}`

function formatDashboardChallengeDate(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  })
}

function formatDashboardChallengeRange(challenge: DashboardActiveChallenge) {
  if (challenge.period_type !== 'challenge' || !challenge.period_start || !challenge.period_end) {
    return null
  }

  const startLabel = formatDashboardChallengeDate(challenge.period_start)
  const endLabel = formatDashboardChallengeDate(challenge.period_end)

  if (!startLabel || !endLabel) {
    return null
  }

  return `${startLabel} - ${endLabel}`
}

function formatDashboardChallengeProgress(challenge: DashboardActiveChallenge) {
  if (challenge.goal_unit === 'distance_km') {
    return `${formatDistanceKm(challenge.progress_value)} / ${formatDistanceKm(challenge.goal_target)} км`
  }

  return `${Math.round(challenge.progress_value)} / ${Math.round(challenge.goal_target)} тренировок`
}

function formatDashboardChallengeRemaining(challenge: DashboardActiveChallenge) {
  const remainingValue = Math.max(challenge.goal_target - challenge.progress_value, 0)

  if (challenge.goal_unit === 'distance_km') {
    return `Осталось: ${formatDistanceKm(remainingValue)} км`
  }

  const roundedRemaining = Math.max(Math.ceil(remainingValue), 0)
  return `Осталось: ${roundedRemaining} ${roundedRemaining === 1 ? 'тренировка' : roundedRemaining < 5 ? 'тренировки' : 'тренировок'}`
}

function getDashboardChallengeDaysLeft(challenge: DashboardActiveChallenge) {
  if (challenge.period_type !== 'challenge' || !challenge.period_end) {
    return null
  }

  const periodEndTimestamp = new Date(challenge.period_end).getTime()

  if (Number.isNaN(periodEndTimestamp)) {
    return null
  }

  const remainingMs = periodEndTimestamp - Date.now()

  if (remainingMs <= 0) {
    return 0
  }

  return Math.ceil(remainingMs / (1000 * 60 * 60 * 24))
}

function formatDashboardChallengeDaysLeft(challenge: DashboardActiveChallenge) {
  const daysLeft = getDashboardChallengeDaysLeft(challenge)

  if (daysLeft === null) {
    return null
  }

  return `До конца: ${daysLeft} ${daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'}`
}

function isDashboardChallengeNearCompletion(challenge: DashboardActiveChallenge) {
  return challenge.percent >= 80 && challenge.percent < 100
}

function DashboardChallengeCard({
  challenge,
  rail = false,
}: {
  challenge: DashboardActiveChallenge
  rail?: boolean
}) {
  const dateRange = formatDashboardChallengeRange(challenge)
  const daysLeft = formatDashboardChallengeDaysLeft(challenge)

  return (
    <Link
      href="/challenges"
      aria-label={`Открыть челленджи: ${challenge.title}`}
      className={`app-card block overflow-hidden rounded-2xl border p-3.5 shadow-sm ring-1 ring-black/5 transition-all duration-200 ease-out motion-reduce:transition-none dark:ring-white/10 ${rail ? 'w-[84vw] max-w-[320px] shrink-0 snap-start sm:w-[320px]' : ''} ${dashboardCardFocusRingClass}`}
    >
      <div className="flex items-start gap-3">
        <ChallengeBadgeArtwork
          badgeUrl={challenge.badge_url}
          title={challenge.title}
          className="h-12 w-12 shrink-0 rounded-2xl"
          placeholderLabel="Badge"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="app-text-primary break-words text-sm font-semibold sm:text-[15px]">{challenge.title}</h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="app-text-secondary rounded-full border px-2 py-1 text-[11px] font-medium">
                  {dashboardChallengeTypeLabels[challenge.period_type]}
                </span>
                {dateRange ? (
                  <span className="app-text-secondary text-xs">{dateRange}</span>
                ) : null}
              </div>
            </div>
            {isDashboardChallengeNearCompletion(challenge) ? (
              <span className="shrink-0 text-xs font-medium text-orange-600">Почти готово</span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mt-3">
        <div className="app-progress-track h-2 w-full overflow-hidden rounded-full">
          <div
            className="app-accent-bg h-full rounded-full"
            style={{ width: `${challenge.percent}%` }}
          />
        </div>
        <div className="mt-2 space-y-1">
          <p className="app-text-secondary text-sm">Прогресс: {formatDashboardChallengeProgress(challenge)}</p>
          <p className="app-text-secondary text-sm">{formatDashboardChallengeRemaining(challenge)}</p>
          {daysLeft !== null ? (
            <p className="app-text-secondary text-xs">{daysLeft}</p>
          ) : null}
        </div>
      </div>
    </Link>
  )
}

function DashboardChallengePlaceholderCard() {
  return (
    <div
      className="app-card rounded-xl border p-4 shadow-sm"
      role="status"
      aria-live="polite"
      aria-label="Загружаем челленджи"
    >
      <div className="flex items-start gap-3">
        <div className="app-surface-muted flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ring-1 ring-black/10 dark:ring-white/15">
          <div className="skeleton-line h-8 w-8 rounded-xl" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="app-text-primary text-sm font-medium">Загружаем челленджи…</p>
          <div className="mt-2 skeleton-line h-5 w-36" />
          <div className="mt-2 flex items-center gap-2">
            <div className="skeleton-line h-6 w-24 rounded-full" />
            <div className="skeleton-line h-4 w-20" />
          </div>
        </div>
      </div>
      <div className="mt-3">
        <div className="skeleton-line h-2 w-full" />
        <div className="mt-2 space-y-2">
          <div className="skeleton-line h-4 w-44" />
          <div className="skeleton-line h-4 w-40" />
          <div className="skeleton-line h-4 w-32" />
        </div>
      </div>
    </div>
  )
}

function DashboardSecondaryCardPlaceholder({
  title,
}: {
  title: string
}) {
  return (
    <div
      className="app-card min-h-[188px] rounded-xl border p-4 shadow-sm"
      role="status"
      aria-live="polite"
      aria-label={title}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="skeleton-line h-6 w-44" />
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <div className="skeleton-line h-3 w-12" />
              <div className="skeleton-line h-5 w-14" />
            </div>
            <div className="space-y-2">
              <div className="skeleton-line h-3 w-10" />
              <div className="skeleton-line h-5 w-16" />
            </div>
            <div className="space-y-2">
              <div className="skeleton-line h-3 w-12" />
              <div className="skeleton-line h-5 w-20" />
            </div>
          </div>
          <div className="mt-4 skeleton-line h-4 w-36" />
        </div>
      </div>
    </div>
  )
}

function DashboardSecondaryEmptyCard({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <section className="app-card min-h-[188px] rounded-xl border p-4 shadow-sm">
      <h2 className="app-text-primary text-lg font-semibold">{title}</h2>
      <p className="app-text-secondary mt-3 text-sm">{description}</p>
    </section>
  )
}

export default function DashboardPageClient({
  initialUser,
  initialProfileSummary,
  initialStats,
  initialLevelProgress,
  initialActiveChallenges,
  initialAllChallengesCompleted,
  initialInboxUnreadCount,
}: {
  initialUser: DashboardInitialUser
  initialProfileSummary: DashboardInitialProfileSummary
  initialStats: DashboardInitialStats
  initialLevelProgress: DashboardInitialLevelProgress
  initialActiveChallenges: DashboardActiveChallenge[]
  initialAllChallengesCompleted: boolean
  initialInboxUnreadCount: number
}) {
  const [shouldLoadSecondaryContent, setShouldLoadSecondaryContent] = useState(false)
  const [hasLoadedOverviewDetails] = useState(true)
  const [showXpModal, setShowXpModal] = useState(false)
  const [inboxUnreadCount, setInboxUnreadCount] = useState(initialInboxUnreadCount)
  const [recentlyAffectedChallengeIds] = useState<string[]>(() => loadRecentAffectedChallengeIds())
  const inboxUnreadRefreshPromiseRef = useRef<Promise<void> | null>(null)
  const isMountedRef = useRef(false)
  const refreshDashboardDataPromiseRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setShouldLoadSecondaryContent(true)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [])

  const refreshInboxUnreadCount = useCallback(() => {
    if (inboxUnreadRefreshPromiseRef.current) {
      return inboxUnreadRefreshPromiseRef.current
    }

    const refreshPromise = (async () => {
      const count = await loadInboxUnreadCount()

      if (isMountedRef.current && count !== null) {
        setInboxUnreadCount(count)
      }
    })()

    inboxUnreadRefreshPromiseRef.current = refreshPromise

    return refreshPromise.finally(() => {
      if (inboxUnreadRefreshPromiseRef.current === refreshPromise) {
        inboxUnreadRefreshPromiseRef.current = null
      }
    })
  }, [])

  useEffect(() => {
    isMountedRef.current = true

    void refreshInboxUnreadCount()

    return () => {
      isMountedRef.current = false
    }
  }, [initialUser.id, refreshInboxUnreadCount])

  useEffect(() => {
    function handleWindowFocus() {
      void refreshInboxUnreadCount()
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void refreshInboxUnreadCount()
      }
    }

    function handleInboxUnreadUpdated() {
      void refreshInboxUnreadCount()
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === INBOX_UNREAD_UPDATED_STORAGE_KEY) {
        void refreshInboxUnreadCount()
      }
    }

    window.addEventListener('focus', handleWindowFocus)
    window.addEventListener(INBOX_UNREAD_UPDATED_EVENT, handleInboxUnreadUpdated)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('storage', handleStorage)

    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener(INBOX_UNREAD_UPDATED_EVENT, handleInboxUnreadUpdated)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('storage', handleStorage)
    }
  }, [refreshInboxUnreadCount])

  const swrBaseOptions = useMemo(() => ({
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    keepPreviousData: true,
    dedupingInterval: 15000,
    focusThrottleInterval: 15000,
  }), [])
  const overviewKey = shouldLoadSecondaryContent ? (['dashboard-overview', initialUser.id] as const) : null
  const weeklyRaceKey = shouldLoadSecondaryContent ? (['weekly-race', initialUser.id] as const) : null
  const latestFinalizedRaceWeekKey = shouldLoadSecondaryContent ? (['latest-finalized-race-week'] as const) : null
  const initialOverview = useMemo<DashboardOverview>(() => ({
    stats: initialStats,
    profileSummary: initialProfileSummary,
    activeChallenges: initialActiveChallenges,
    allChallengesCompleted: initialAllChallengesCompleted,
  }), [initialActiveChallenges, initialAllChallengesCompleted, initialProfileSummary, initialStats])

  const {
    data: overview,
    error: overviewError,
    isLoading: overviewLoading,
    mutate: mutateOverview,
  } = useSWR(overviewKey, ([, userId]: readonly [string, string]) => loadDashboardOverview(userId), {
    ...swrBaseOptions,
    fallbackData: initialOverview,
  })

  const {
    data: weeklyRace,
    error: weeklyRaceError,
    isLoading: weeklyRaceLoading,
    mutate: mutateWeeklyRace,
  } = useSWR<WeeklyXpLeaderboard>(weeklyRaceKey, ([, userId]: readonly [string, string]) => loadWeeklyXpLeaderboard(userId), {
    ...swrBaseOptions,
  })

  const {
    data: latestFinalizedRaceWeek,
    isLoading: latestFinalizedRaceWeekLoading,
    mutate: mutateLatestFinalizedRaceWeek,
  } = useSWR<RaceWeekSummary | null>(
    latestFinalizedRaceWeekKey,
    () => loadLatestFinalizedRaceWeek(),
    {
      ...swrBaseOptions,
      dedupingInterval: 60000,
      focusThrottleInterval: 60000,
    }
  )

  const lastWeekResultsKey = shouldLoadSecondaryContent && latestFinalizedRaceWeek?.id
    ? (['last-week-results', latestFinalizedRaceWeek.id, initialUser.id] as const)
    : null

  const {
    data: lastWeekResults,
    isLoading: lastWeekResultsLoading,
    mutate: mutateLastWeekResults,
  } = useSWR<LastWeekResultsCardData>(
    lastWeekResultsKey,
    ([, weekId, userId]: readonly [string, string, string]) =>
      Promise.all([
        loadRaceWeekUserResult(weekId, userId),
        loadRaceWeekUserBadge(weekId, userId),
      ]).then(([userResult, badge]) => ({
        weekId,
        userResult,
        badgeText: getRaceBadgeLabel(badge?.badgeCode, badge?.sourceRank ?? userResult?.rank ?? null),
        weekRangeLabel: latestFinalizedRaceWeek ? formatRaceWeekDateRange(latestFinalizedRaceWeek) : '',
      })),
    {
      ...swrBaseOptions,
      dedupingInterval: 60000,
      focusThrottleInterval: 60000,
    }
  )

  const refreshDashboardData = useCallback(() => {
    if (refreshDashboardDataPromiseRef.current) {
      return refreshDashboardDataPromiseRef.current
    }

    const refreshPromise = (async () => {
      await Promise.all([
        mutateOverview(),
        mutateWeeklyRace(),
        mutateLatestFinalizedRaceWeek(),
        mutateLastWeekResults(),
      ])
    })()

    refreshDashboardDataPromiseRef.current = refreshPromise

    return refreshPromise.finally(() => {
      if (refreshDashboardDataPromiseRef.current === refreshPromise) {
        refreshDashboardDataPromiseRef.current = null
      }
    })
  }, [mutateLastWeekResults, mutateLatestFinalizedRaceWeek, mutateOverview, mutateWeeklyRace])

  useEffect(() => {
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
  }, [refreshDashboardData])

  const stats = overview?.stats ?? initialStats
  const activeChallenges = useMemo(
    () => prioritizeChallengesByIds(
      (overview?.activeChallenges ?? initialActiveChallenges).filter((challenge) => !challenge.isCompleted),
      recentlyAffectedChallengeIds
    ),
    [initialActiveChallenges, overview?.activeChallenges, recentlyAffectedChallengeIds]
  )
  const allChallengesCompleted = overview?.allChallengesCompleted ?? initialAllChallengesCompleted
  const levelProgress = hasLoadedOverviewDetails && stats
    ? getLevelProgressFromXP(stats.totalXp)
    : initialLevelProgress
  const profileName = getProfileDisplayName(
    {
      name: overview?.profileSummary.name ?? initialProfileSummary.name,
      nickname: overview?.profileSummary.nickname ?? initialProfileSummary.nickname,
      email: overview?.profileSummary.email ?? initialProfileSummary.email ?? initialUser.email,
    },
    'Бегун'
  )
  const overviewStateError = !hasLoadedOverviewDetails && !stats
    ? 'Не удалось загрузить прогресс'
    : ''
  const headerDisplayName = `Привет, ${profileName}`
  const headerLevelLabel = levelProgress
    ? `Уровень ${levelProgress.level}`
    : 'Загружаем прогресс...'
  const showOverviewSkeleton = !stats && overviewLoading && !overview && !overviewError
  const showChallengesPlaceholder = !shouldLoadSecondaryContent
    || (
      overview === initialOverview
      && activeChallenges.length === 0
      && !allChallengesCompleted
    )
  const weeklyLeaderboardLoading = !shouldLoadSecondaryContent || weeklyRaceLoading
  const lastWeekResultsCard = latestFinalizedRaceWeek && lastWeekResults
    ? {
        weekId: latestFinalizedRaceWeek.id,
        userResult: lastWeekResults.userResult,
        badgeText: lastWeekResults.badgeText,
        weekRangeLabel: lastWeekResults.weekRangeLabel,
      }
    : null
  const shouldShowLastWeekResultsCard = new Date().getDay() === 1
  const showLastWeekResultsPlaceholder = !shouldLoadSecondaryContent
    || (shouldShowLastWeekResultsCard && latestFinalizedRaceWeekLoading)
    || (shouldShowLastWeekResultsCard && Boolean(latestFinalizedRaceWeek?.id) && lastWeekResultsLoading)
  const rawXpProgressPercent = levelProgress?.progressPercent
  const xpProgressPercent = typeof rawXpProgressPercent === 'number' && Number.isFinite(rawXpProgressPercent)
    ? Math.min(Math.max(rawXpProgressPercent, 0), 100)
    : 0
  const currentRankTitle = levelProgress ? getRankTitleFromLevel(levelProgress.level) : ''
  const featuredChallenge = activeChallenges[0] ?? null
  const hasMultipleActiveChallenges = activeChallenges.length > 1

  return (
    <main className="min-h-screen pt-[env(safe-area-inset-top)] md:pt-0">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <div className="mb-6 flex items-start justify-between gap-2 sm:gap-3">
          <UserIdentitySummary
            className="flex-1"
            loadingIdentity={false}
            loadingLevel={false}
            displayName={headerDisplayName}
            levelLabel={headerLevelLabel}
          />
          <div className="flex items-center gap-1.5 self-start sm:gap-2">
            <Link
              href="/runs"
              aria-label="Добавить тренировку"
              className={dashboardHeaderActionClass}
            >
              <Plus className="h-5 w-5" strokeWidth={2.1} />
            </Link>
            <Link
              href="/activity/inbox"
              aria-label="Открыть входящие"
              className={dashboardHeaderActionClass}
            >
              <Bell className="h-5 w-5" strokeWidth={1.9} />
              <UnreadBadge
                count={inboxUnreadCount}
                maxDisplayCount={99}
                className="absolute -right-1 -top-1"
              />
            </Link>
            <Link
              href="/profile"
              aria-label="Открыть профиль"
              className={dashboardHeaderActionClass}
            >
              <User className="h-5 w-5" strokeWidth={1.9} />
            </Link>
          </div>
        </div>
        <div className="mb-4">
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
            <Link href="/activity" className={dashboardClickableCardClass}>
              <p className="app-text-secondary flex items-center gap-2 text-sm font-medium">
                <Activity className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span>Мой прогресс</span>
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
            </Link>
          ) : (
            <Link href="/activity" className={dashboardClickableCardClass}>
              <p className="app-text-secondary flex items-center gap-2 text-sm font-medium">
                <Activity className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span>Мой прогресс</span>
              </p>
              <p className="app-text-secondary mt-3 text-sm">Данные появятся после первой тренировки</p>
            </Link>
          )}
          <section className="mb-4 min-h-[236px]">
            <div className="mb-3 flex items-center gap-2">
              <p className="app-text-secondary flex items-center gap-2 text-sm font-medium">
                <Target className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span>Челленджи</span>
              </p>
            </div>
            {showChallengesPlaceholder ? (
              <DashboardChallengePlaceholderCard />
            ) : featuredChallenge ? (
              hasMultipleActiveChallenges ? (
                <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="flex snap-x snap-mandatory gap-3">
                    {activeChallenges.map((challenge) => (
                      <DashboardChallengeCard
                        key={`${challenge.id}:${challenge.period_start ?? 'active'}`}
                        challenge={challenge}
                        rail
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <DashboardChallengeCard challenge={featuredChallenge} />
              )
            ) : allChallengesCompleted ? (
              <Link href="/challenges" className={dashboardClickableCardClass}>
                <p className="app-text-secondary flex items-center gap-2 text-sm font-medium">
                  <Target className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                  <span>Челленджи</span>
                </p>
                <p className="app-text-secondary mt-3 text-sm">Все активные челленджи уже выполнены</p>
                <p className="app-text-secondary mt-2 text-sm">Открой достижения и новые цели</p>
              </Link>
            ) : (
              <section className="app-card rounded-xl border p-4 shadow-sm">
                <p className="app-text-secondary flex items-center gap-2 text-sm font-medium">
                  <Target className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                  <span>Челленджи</span>
                </p>
                <p className="app-text-secondary mt-3 text-sm">Сейчас нет активных челленджей.</p>
                <p className="app-text-secondary mt-2 text-sm">Загляни в раздел челленджей, чтобы посмотреть доступные цели и достижения.</p>
              </section>
            )}
          </section>
          {stats && levelProgress ? (
            <button
              type="button"
              onClick={() => setShowXpModal(true)}
              className={`app-card mb-4 block w-full overflow-hidden rounded-xl border p-4 text-left shadow-sm transition-[transform,box-shadow] hover:shadow-md active:scale-[0.995] ${dashboardCardFocusRingClass}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="app-text-secondary flex items-center gap-2 text-sm font-medium">
                    <Trophy className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                    <span>Уровень {levelProgress.level}</span>
                  </p>
                  <p className="app-text-secondary mt-1 text-sm">{currentRankTitle}</p>
                </div>
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
            </button>
          ) : null}
          <Link
            href="/race"
            className={`block rounded-xl ${dashboardCardFocusRingClass}`}
            aria-label="Открыть гонку недели"
          >
            <WeeklyLeaderboard
              leaderboard={weeklyRace ?? null}
              currentUserId={initialUser.id}
              loading={weeklyLeaderboardLoading}
              error={shouldLoadSecondaryContent && weeklyRaceError ? 'Не удалось загрузить рейтинг' : ''}
              compact
            />
          </Link>
          {shouldShowLastWeekResultsCard ? (
            <section className="mb-4 min-h-[188px]">
              {showLastWeekResultsPlaceholder ? (
              <DashboardSecondaryCardPlaceholder title="Загружаем итоги прошлой недели" />
            ) : lastWeekResultsCard ? (
              <Link href={`/race/history/${lastWeekResultsCard.weekId}`} className={dashboardClickableCardClass}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="app-text-secondary text-sm font-medium">Итоги прошлой недели</p>
                    {lastWeekResultsCard.weekRangeLabel ? (
                      <p className="app-text-secondary mt-1 text-sm">{lastWeekResultsCard.weekRangeLabel}</p>
                    ) : null}
                    {lastWeekResultsCard.userResult ? (
                      <>
                        <p className="app-text-primary mt-3 text-2xl font-semibold tracking-tight">
                          {lastWeekResultsCard.badgeText}
                        </p>
                        <p className="app-text-secondary mt-1 text-sm">
                          {lastWeekResultsCard.userResult.totalXp} XP за неделю
                        </p>
                        {lastWeekResultsCard.userResult.raceBonusXp > 0 ? (
                          <p className="app-text-secondary mt-3 text-sm">{`Бонус недели +${lastWeekResultsCard.userResult.raceBonusXp} XP`}</p>
                        ) : null}
                      </>
                    ) : (
                      <p className="app-text-secondary mt-3 text-sm">Ты не участвовал в прошлой неделе</p>
                    )}
                  </div>
                </div>
              </Link>
            ) : (
              <DashboardSecondaryEmptyCard
                title="Итоги прошлой недели"
                description="Итоги появятся после завершения недели гонки."
              />
              )}
            </section>
          ) : null}
          <section className="min-h-[284px]">
            <h2 className="app-text-primary mb-3 text-lg font-semibold">Лента</h2>
            <InfiniteWorkoutFeed
              currentUserId={initialUser.id}
              enabled={shouldLoadSecondaryContent}
              pageSize={10}
              scrollRestorationKey="dashboard-feed"
              emptyTitle="Пока нет тренировок"
              showLevelSubtitle
            />
          </section>
        </div>
      </div>
      <LevelOverviewSheet
        open={showXpModal}
        totalXp={stats?.totalXp ?? initialStats.totalXp}
        onClose={() => setShowXpModal(false)}
      />
    </main>
  )
}
