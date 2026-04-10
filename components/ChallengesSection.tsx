'use client'

import { CheckCircle2 } from 'lucide-react'
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
  showAchievements?: boolean
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
  showAchievements = true,
}: ChallengesSectionProps) {
  const router = useRouter()
  const [overview, setOverview] = useState<ChallengesOverview>(buildEmptyOverview)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadData() {
      setError('')

      try {
        if (!isMounted) return

        const user = await getBootstrapUser()

        if (!user) {
          router.replace('/login')
          return
        }

        const nextOverview = await loadChallengesOverview()

        if (!isMounted) return

        setOverview(nextOverview)
      } catch (loadError) {
        console.error('[challenges] failed to load challenge section', loadError)
        if (isMounted) {
          setError('Не удалось загрузить челленджи')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    void loadData()

    return () => {
      isMounted = false
    }
  }, [router])

  const activeItems = overview.active
  const upcomingItems = overview.upcoming
  const completedItems = showAchievements
    ? overview.completed
    : overview.completed.filter((item) => item.period_type !== 'lifetime')
  const hasAnyItems = activeItems.length > 0 || upcomingItems.length > 0 || completedItems.length > 0

  return (
    <div className="mx-auto max-w-xl p-4 md:max-w-none">
      {showTitle ? <h1 className="app-text-primary mb-4 text-2xl font-bold">Челленджи</h1> : null}
      {loading ? (
        <p>Загрузка...</p>
      ) : (
        <>
          {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}
          {!hasAnyItems ? (
            <div className="app-text-secondary mt-10 text-center">
              <p>Челленджи скоро появятся.</p>
              <p className="mt-2 text-sm">Загляните позже за новыми целями.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="app-text-primary text-lg font-semibold">Активные</h2>
                  <span className="app-text-secondary text-sm">{activeItems.length}</span>
                </div>
                <div className="space-y-4">
                  {activeItems.length === 0 ? (
                    <div className="app-card rounded-2xl border p-4 shadow-sm">
                      <p className="app-text-secondary text-sm">Все активные челленджи уже закрыты.</p>
                      <p className="app-text-secondary mt-2 text-sm">Скоро появятся новые цели.</p>
                    </div>
                  ) : (
                    activeItems.map((item) => (
                      <ChallengeCard key={`${item.id}:${item.period_start ?? 'active'}`} item={item} />
                    ))
                  )}
                </div>
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="app-text-primary text-lg font-semibold">Скоро</h2>
                  <span className="app-text-secondary text-sm">{upcomingItems.length}</span>
                </div>
                <div className="space-y-4">
                  {upcomingItems.length === 0 ? (
                    <div className="app-card rounded-2xl border p-4 shadow-sm">
                      <p className="app-text-secondary text-sm">Скоро стартующих челленджей пока нет.</p>
                      <p className="app-text-secondary mt-2 text-sm">Как только появятся новые окна, они будут здесь.</p>
                    </div>
                  ) : (
                    upcomingItems.map((item) => (
                      <ChallengeCard key={`${item.id}:${item.period_start ?? 'upcoming'}`} item={item} />
                    ))
                  )}
                </div>
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="app-text-primary text-lg font-semibold">Завершенные</h2>
                  <span className="app-text-secondary text-sm">{completedItems.length}</span>
                </div>
                <div className="space-y-4">
                  {completedItems.length === 0 ? (
                    <div className="app-card rounded-2xl border p-4 shadow-sm">
                      <p className="app-text-secondary text-sm">Завершенных челленджей пока нет.</p>
                      <p className="app-text-secondary mt-2 text-sm">Закрытые цели появятся в этом разделе.</p>
                    </div>
                  ) : (
                    completedItems.map((item) => (
                      <ChallengeCard key={`${item.id}:${item.period_start ?? 'completed'}`} item={item} />
                    ))
                  )}
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  )
}
