'use client'

import { ChevronDown, CheckCircle2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ChallengeBadgeArtwork from '@/components/ChallengeBadgeArtwork'
import { getBootstrapUser } from '@/lib/auth'
import {
  loadChallengesOverview,
  type ChallengeListItem,
  type ChallengesOverview,
} from '@/lib/challenges'
import { formatDistanceKm } from '@/lib/format'

type ChallengesSectionProps = {
  showTitle?: boolean
  overview?: ChallengesOverview | null
  loading?: boolean
  error?: string
}

const challengeTypeLabel: Record<ChallengeListItem['period_type'], string> = {
  challenge: 'По расписанию',
  weekly: 'Еженедельный',
  monthly: 'Ежемесячный',
  lifetime: 'Достижение',
}

function buildEmptyOverview(): ChallengesOverview {
  return {
    active: [],
    upcoming: [],
    completed: [],
  }
}

function formatChallengeDate(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  })
}

function formatChallengeRange(item: ChallengeListItem) {
  if (item.period_type !== 'challenge' || !item.period_start || !item.period_end) {
    return null
  }

  const startLabel = formatChallengeDate(item.period_start)
  const endLabel = formatChallengeDate(item.period_end)

  if (!startLabel || !endLabel) {
    return null
  }

  return `${startLabel} - ${endLabel}`
}

function formatChallengeProgress(item: ChallengeListItem) {
  if (item.goal_unit === 'distance_km') {
    return `${formatDistanceKm(item.progress_value)} / ${formatDistanceKm(item.goal_target)} км`
  }

  return `${Math.round(item.progress_value)} / ${Math.round(item.goal_target)} тренировок`
}

function formatChallengeRemaining(item: ChallengeListItem) {
  const remainingValue = Math.max(item.goal_target - item.progress_value, 0)

  if (item.goal_unit === 'distance_km') {
    return `Осталось: ${formatDistanceKm(remainingValue)} км`
  }

  const roundedRemaining = Math.max(Math.ceil(remainingValue), 0)
  return `Осталось: ${roundedRemaining} ${roundedRemaining === 1 ? 'тренировка' : roundedRemaining < 5 ? 'тренировки' : 'тренировок'}`
}

function ChallengeCard({ item }: { item: ChallengeListItem }) {
  const isCompleted = item.status === 'completed'
  const isUpcoming = item.status === 'upcoming'
  const dateRange = formatChallengeRange(item)

  return (
    <div className="app-card overflow-hidden rounded-2xl border p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <ChallengeBadgeArtwork
          badgeUrl={item.badge_url}
          title={item.title}
          className="h-14 w-14 shrink-0 rounded-2xl"
          placeholderLabel="Badge"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="app-text-primary break-words text-lg font-semibold">{item.title}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="app-text-secondary shrink-0 rounded-full border px-2 py-1 text-[11px] font-medium">
                  {challengeTypeLabel[item.period_type]}
                </span>
                {dateRange ? (
                  <span className="app-text-secondary text-xs">{dateRange}</span>
                ) : null}
                {isCompleted ? (
                  <span className="shrink-0 text-xs font-medium text-green-700">Выполнено</span>
                ) : null}
                {isUpcoming ? (
                  <span className="shrink-0 text-xs font-medium text-blue-700">Скоро стартует</span>
                ) : null}
              </div>
            </div>
          </div>
          {item.description ? (
            <p className="app-text-secondary mt-2 break-words text-sm">{item.description}</p>
          ) : null}
          {item.xp_reward > 0 ? (
            <p className="mt-3 text-sm font-medium text-green-700">
              {isCompleted ? `Получено +${item.xp_reward} XP` : `+${item.xp_reward} XP`}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-4">
        {isCompleted ? (
          <p className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={1.9} />
            <span>Цель закрыта в текущем периоде</span>
          </p>
        ) : null}
        <div className="app-progress-track h-2 w-full overflow-hidden rounded-full">
          <div
            className="app-accent-bg h-full rounded-full"
            style={{ width: `${item.percent}%` }}
          />
        </div>
        <div className="mt-2 space-y-1">
          <p className="app-text-secondary break-words text-sm">Прогресс: {formatChallengeProgress(item)}</p>
          {!isCompleted && !isUpcoming ? (
            <p className="app-text-secondary break-words text-sm">{formatChallengeRemaining(item)}</p>
          ) : null}
          {isUpcoming && dateRange ? (
            <p className="app-text-secondary break-words text-sm">Старт по расписанию: {dateRange}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function ChallengesSection({
  showTitle = true,
  overview,
  loading,
  error,
}: ChallengesSectionProps) {
  const router = useRouter()
  const [internalOverview, setInternalOverview] = useState<ChallengesOverview>(buildEmptyOverview)
  const [internalLoading, setInternalLoading] = useState(true)
  const [internalError, setInternalError] = useState('')
  const [activeExpanded, setActiveExpanded] = useState(true)
  const [upcomingExpanded, setUpcomingExpanded] = useState(false)
  const isControlledByParent =
    typeof overview !== 'undefined' ||
    typeof loading !== 'undefined' ||
    typeof error !== 'undefined'

  useEffect(() => {
    if (isControlledByParent) {
      return
    }

    let isMounted = true

    async function loadData() {
      setInternalError('')

      try {
        if (!isMounted) return

        const user = await getBootstrapUser()

        if (!user) {
          router.replace('/login')
          return
        }

        const nextOverview = await loadChallengesOverview({ includeCompleted: false })

        if (!isMounted) return

        setInternalOverview(nextOverview)
      } catch (loadError) {
        console.error('[challenges] failed to load challenge section', loadError)
        if (isMounted) {
          setInternalError('Не удалось загрузить челленджи')
        }
      } finally {
        if (isMounted) {
          setInternalLoading(false)
        }
      }
    }

    void loadData()

    return () => {
      isMounted = false
    }
  }, [isControlledByParent, router])

  const resolvedOverview = overview ?? internalOverview
  const resolvedLoading = loading ?? internalLoading
  const resolvedError = error ?? internalError
  const activeItems = resolvedOverview.active
  const upcomingItems = resolvedOverview.upcoming
  return (
    <div className="mx-auto max-w-xl p-4 md:max-w-none">
      {showTitle ? <h1 className="app-text-primary mb-4 text-2xl font-bold">Челленджи</h1> : null}
      {resolvedLoading ? (
        <p>Загрузка...</p>
      ) : (
        <>
          {resolvedError ? <p className="mb-4 text-sm text-red-600">{resolvedError}</p> : null}
          <div className="space-y-5">
            <section className="app-card overflow-hidden rounded-2xl border shadow-sm">
              <button
                type="button"
                onClick={() => setActiveExpanded((current) => !current)}
                className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left"
                aria-expanded={activeExpanded}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="app-surface-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] dark:border-white/[0.08]">
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${activeExpanded ? 'rotate-0' : '-rotate-90'}`}
                      strokeWidth={2}
                    />
                  </div>
                  <div className="min-w-0">
                    <h2 className="app-text-primary text-base font-semibold">Активные</h2>
                  </div>
                </div>
                <span className="app-text-secondary shrink-0 text-sm">{activeItems.length}</span>
              </button>
              {activeExpanded ? (
                <div className="space-y-4 border-t border-black/[0.06] px-4 py-4 dark:border-white/[0.08]">
                  {activeItems.length === 0 ? (
                    <div className="app-surface-muted rounded-2xl border p-4">
                      <p className="app-text-secondary text-sm">Все активные челленджи уже закрыты.</p>
                      <p className="app-text-secondary mt-2 text-sm">Скоро появятся новые цели.</p>
                    </div>
                  ) : (
                    activeItems.map((item) => (
                      <ChallengeCard key={`${item.id}:${item.period_start ?? 'active'}`} item={item} />
                    ))
                  )}
                </div>
              ) : null}
            </section>

            <section className="app-card overflow-hidden rounded-2xl border shadow-sm">
              <button
                type="button"
                onClick={() => setUpcomingExpanded((current) => !current)}
                className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left"
                aria-expanded={upcomingExpanded}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="app-surface-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] dark:border-white/[0.08]">
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${upcomingExpanded ? 'rotate-0' : '-rotate-90'}`}
                      strokeWidth={2}
                    />
                  </div>
                  <div className="min-w-0">
                    <h2 className="app-text-primary text-base font-semibold">Скоро</h2>
                  </div>
                </div>
                <span className="app-text-secondary shrink-0 text-sm">{upcomingItems.length}</span>
              </button>
              {upcomingExpanded ? (
                <div className="space-y-4 border-t border-black/[0.06] px-4 py-4 dark:border-white/[0.08]">
                  {upcomingItems.length === 0 ? (
                    <div className="app-surface-muted rounded-2xl border p-4">
                      <p className="app-text-secondary text-sm">Скоро стартующих челленджей пока нет.</p>
                      <p className="app-text-secondary mt-2 text-sm">Как только появятся новые окна, они будут здесь.</p>
                    </div>
                  ) : (
                    upcomingItems.map((item) => (
                      <ChallengeCard key={`${item.id}:${item.period_start ?? 'upcoming'}`} item={item} />
                    ))
                  )}
                </div>
              ) : null}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
