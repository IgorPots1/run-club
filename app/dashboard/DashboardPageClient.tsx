'use client'

import { Activity, Target, Trophy } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import ChallengeBadgeArtwork from '@/components/ChallengeBadgeArtwork'
import InfiniteWorkoutFeed from '@/components/InfiniteWorkoutFeed'
import LevelOverviewSheet from '@/components/LevelOverviewSheet'
import UserIdentitySummary from '@/components/UserIdentitySummary'
import WeeklyLeaderboard from '@/components/WeeklyLeaderboard'
import {
  loadLatestFinalizedRaceWeek,
  loadRaceWeekUserBadge,
  loadRaceWeekUserResult,
  type RaceWeekResultRow,
  type RaceWeekSummary,
} from '@/lib/race-results-client'
import { loadDashboardOverview } from '@/lib/dashboard'
import type { DashboardActiveChallenge, DashboardOverview } from '@/lib/dashboard-overview'
import { formatDistanceKm } from '@/lib/format'
import { getProfileDisplayName } from '@/lib/profiles'
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
}

const dashboardChallengeTypeLabels: Record<DashboardActiveChallenge['period_type'], string> = {
  challenge: 'По расписанию',
  weekly: 'Еженедельный',
  monthly: 'Ежемесячный',
  lifetime: 'Достижение',
}

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
  featured,
}: {
  challenge: DashboardActiveChallenge
  featured: boolean
}) {
  const dateRange = formatDashboardChallengeRange(challenge)
  const daysLeft = formatDashboardChallengeDaysLeft(challenge)

  return (
    <article
      data-challenge-card={challenge.id}
      className={`app-card w-[86%] shrink-0 snap-center overflow-hidden rounded-xl border p-4 shadow-sm transition-all duration-200 ease-out motion-reduce:transition-none sm:w-[420px] ${
        featured
          ? 'scale-100 opacity-100 shadow-md ring-1 ring-black/5 dark:ring-white/10'
          : 'scale-[0.985] opacity-80 shadow-sm'
      }`}
    >
      <div className="flex items-start gap-3">
        <ChallengeBadgeArtwork
          badgeUrl={challenge.badge_url}
          title={challenge.title}
          className="h-14 w-14 shrink-0 rounded-2xl"
          placeholderLabel="Badge"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="app-text-primary break-words text-base font-semibold">{challenge.title}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="app-text-secondary rounded-full border px-2 py-1 text-[11px] font-medium">
                  {dashboardChallengeTypeLabels[challenge.period_type]}
                </span>
                {dateRange ? (
                  <span className="app-text-secondary text-xs">{dateRange}</span>
                ) : null}
              </div>
            </div>
            {isDashboardChallengeNearCompletion(challenge) ? (
              <span className="shrink-0 text-xs font-medium text-orange-600">Почти готово 🔥</span>
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
            <p className="app-text-secondary text-sm">{daysLeft}</p>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function getRaceBadgeText(badgeCode: string | null | undefined, rank: number | null | undefined) {
  if (badgeCode === 'race_week_winner') {
    return 'Победитель недели'
  }

  if (badgeCode === 'race_week_top_3') {
    return 'Топ-3'
  }

  if (badgeCode === 'race_week_top_10') {
    return 'Топ-10'
  }

  if (typeof rank === 'number' && rank > 0) {
    return `#${rank}`
  }

  return 'Без бейджа'
}

export default function DashboardPageClient({
  initialUser,
  initialProfileSummary,
  initialStats,
  initialLevelProgress,
  initialActiveChallenges,
  initialAllChallengesCompleted,
}: {
  initialUser: DashboardInitialUser
  initialProfileSummary: DashboardInitialProfileSummary
  initialStats: DashboardInitialStats
  initialLevelProgress: DashboardInitialLevelProgress
  initialActiveChallenges: DashboardActiveChallenge[]
  initialAllChallengesCompleted: boolean
}) {
  const router = useRouter()
  const [shouldLoadSecondaryContent, setShouldLoadSecondaryContent] = useState(false)
  const [hasLoadedOverviewDetails, setHasLoadedOverviewDetails] = useState(false)
  const [showXpModal, setShowXpModal] = useState(false)
  const [featuredChallengeId, setFeaturedChallengeId] = useState<string | null>(
    initialActiveChallenges[0]?.id ?? null
  )
  const refreshDashboardDataPromiseRef = useRef<Promise<void> | null>(null)
  const challengeRailRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setShouldLoadSecondaryContent(true)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [])

  const swrBaseOptions = useMemo(() => ({
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    keepPreviousData: true,
    dedupingInterval: 15000,
    focusThrottleInterval: 15000,
  }), [])
  const overviewKey = ['dashboard-overview', initialUser.id] as const
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
    revalidateOnMount: false,
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
  } = useSWR<LastWeekResultsCardData>(
    lastWeekResultsKey,
    ([, weekId, userId]: readonly [string, string, string]) =>
      Promise.all([
        loadRaceWeekUserResult(weekId, userId),
        loadRaceWeekUserBadge(weekId, userId),
      ]).then(([userResult, badge]) => ({
        weekId,
        userResult,
        badgeText: getRaceBadgeText(badge?.badgeCode, badge?.sourceRank ?? userResult?.rank ?? null),
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
    if (!shouldLoadSecondaryContent) {
      return
    }

    let isActive = true

    void mutateOverview().finally(() => {
      if (isActive) {
        setHasLoadedOverviewDetails(true)
      }
    })

    return () => {
      isActive = false
    }
  }, [mutateOverview, shouldLoadSecondaryContent])

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
  const activeChallenges = overview?.activeChallenges ?? initialActiveChallenges
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
  const weeklyLeaderboardLoading = !shouldLoadSecondaryContent || weeklyRaceLoading
  const lastWeekResultsCard = latestFinalizedRaceWeek && lastWeekResults
    ? {
        weekId: latestFinalizedRaceWeek.id,
        userResult: lastWeekResults.userResult,
        badgeText: lastWeekResults.badgeText,
      }
    : null
  const rawXpProgressPercent = levelProgress?.progressPercent
  const xpProgressPercent = typeof rawXpProgressPercent === 'number' && Number.isFinite(rawXpProgressPercent)
    ? Math.min(Math.max(rawXpProgressPercent, 0), 100)
    : 0
  const currentRankTitle = levelProgress ? getRankTitleFromLevel(levelProgress.level) : ''
  const resolvedFeaturedChallengeId = featuredChallengeId && activeChallenges.some((challenge) => challenge.id === featuredChallengeId)
    ? featuredChallengeId
    : activeChallenges[0]?.id ?? null

  useEffect(() => {
    const railElement = challengeRailRef.current

    if (!railElement || activeChallenges.length === 0 || typeof IntersectionObserver === 'undefined') {
      return
    }

    const cardElements = Array.from(railElement.querySelectorAll<HTMLElement>('[data-challenge-card]'))

    if (cardElements.length === 0) {
      return
    }

    const visibleRatios = new Map<string, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        let hasVisibleEntry = false

        for (const entry of entries) {
          const challengeId = entry.target.getAttribute('data-challenge-card')

          if (!challengeId) {
            continue
          }

          const ratio = entry.isIntersecting ? entry.intersectionRatio : 0
          visibleRatios.set(challengeId, ratio)

          if (ratio > 0) {
            hasVisibleEntry = true
          }
        }

        if (!hasVisibleEntry && visibleRatios.size === 0) {
          return
        }

        let nextFeaturedChallengeId = activeChallenges[0]?.id ?? null
        let nextFeaturedRatio = -1

        for (const challenge of activeChallenges) {
          const ratio = visibleRatios.get(challenge.id) ?? 0

          if (ratio > nextFeaturedRatio) {
            nextFeaturedRatio = ratio
            nextFeaturedChallengeId = challenge.id
          }
        }

        setFeaturedChallengeId(nextFeaturedChallengeId)
      },
      {
        root: railElement,
        threshold: [0.35, 0.5, 0.65, 0.8, 0.95],
      }
    )

    for (const cardElement of cardElements) {
      observer.observe(cardElement)
    }

    return () => {
      observer.disconnect()
    }
  }, [activeChallenges])

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
          {activeChallenges.length > 0 ? (
            <section className="mb-4">
              <div className="mb-3 flex items-center gap-2">
                <p className="app-text-secondary flex items-center gap-2 text-sm font-medium">
                  <Target className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                  <span>Челленджи</span>
                </p>
              </div>
              <div
                ref={challengeRailRef}
                className="-mx-4 overflow-x-auto overscroll-x-contain px-4 pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              >
                <div className="flex snap-x snap-mandatory gap-3 pr-12">
                  {activeChallenges.map((challenge) => (
                    <DashboardChallengeCard
                      key={challenge.id}
                      challenge={challenge}
                      featured={resolvedFeaturedChallengeId === challenge.id}
                    />
                  ))}
                </div>
              </div>
            </section>
          ) : allChallengesCompleted ? (
            <div className="app-card mb-4 rounded-xl border p-4 shadow-sm">
              <p className="app-text-secondary flex items-center gap-2 text-sm font-medium">
                <Target className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span>Челленджи</span>
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
            <button
              type="button"
              onClick={() => setShowXpModal(true)}
              className="app-card mb-4 block w-full overflow-hidden rounded-xl border p-4 text-left shadow-sm transition-transform active:scale-[0.995]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="app-text-secondary flex items-center gap-2 text-sm font-medium">
                    <Trophy className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                    <span>Уровень {levelProgress.level}</span>
                  </p>
                  <p className="app-text-secondary mt-1 text-sm">{currentRankTitle}</p>
                </div>
                <span className="app-text-secondary shrink-0 text-xs font-medium">Открыть</span>
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
          <div
            role="button"
            tabIndex={0}
            onClick={(event) => {
              const target = event.target as HTMLElement
              if (target.closest('a,button')) {
                return
              }

              router.push('/race')
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return

              const target = event.target as HTMLElement
              if (target.closest('a,button')) {
                return
              }

              event.preventDefault()
              router.push('/race')
            }}
            className="cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/20"
            aria-label="Открыть гонку недели"
          >
            <WeeklyLeaderboard
              leaderboard={weeklyRace ?? null}
              currentUserId={initialUser.id}
              loading={weeklyLeaderboardLoading}
              error={shouldLoadSecondaryContent && weeklyRaceError ? 'Не удалось загрузить рейтинг' : ''}
            />
          </div>
          {lastWeekResultsCard ? (
            <div className="app-card mb-4 overflow-hidden rounded-xl border p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="app-text-primary text-lg font-semibold">🏆 Итоги прошлой недели</h2>
                  {lastWeekResultsCard.userResult ? (
                    <>
                      <div className="mt-3 grid grid-cols-3 gap-3">
                        <div>
                          <p className="app-text-secondary text-xs uppercase tracking-wide">Ранг</p>
                          <p className="app-text-primary mt-1 text-lg font-semibold">#{lastWeekResultsCard.userResult.rank}</p>
                        </div>
                        <div>
                          <p className="app-text-secondary text-xs uppercase tracking-wide">XP</p>
                          <p className="app-text-primary mt-1 text-lg font-semibold">{lastWeekResultsCard.userResult.totalXp}</p>
                        </div>
                        <div>
                          <p className="app-text-secondary text-xs uppercase tracking-wide">Бейдж</p>
                          <p className="app-text-primary mt-1 text-sm font-semibold">{lastWeekResultsCard.badgeText}</p>
                        </div>
                      </div>
                      {lastWeekResultsCard.userResult.raceBonusXp > 0 ? (
                        <p className="app-text-secondary mt-3 text-sm">{`Бонус недели +${lastWeekResultsCard.userResult.raceBonusXp} XP`}</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="app-text-secondary mt-3 text-sm">Ты не участвовал</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => router.push(`/race/history/${lastWeekResultsCard.weekId}`)}
                  className="app-button-secondary min-h-10 shrink-0 rounded-lg border px-3 py-2 text-sm"
                >
                  Открыть
                </button>
              </div>
            </div>
          ) : null}
          <h2 className="app-text-primary mb-3 text-lg font-semibold">Лента</h2>
          <InfiniteWorkoutFeed
            currentUserId={initialUser.id}
            enabled={shouldLoadSecondaryContent}
            pageSize={10}
            emptyTitle="Пока нет тренировок"
            showLevelSubtitle
          />
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
