'use server'

import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import InfiniteWorkoutFeed from '@/components/InfiniteWorkoutFeed'
import WorkoutDetailShell from '@/components/WorkoutDetailShell'
import { buildActivityWindowStats } from '@/lib/activity'
import { formatDistanceKm, formatDurationCompact } from '@/lib/format'
import { getProfileDisplayName } from '@/lib/profiles'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { getLevelProgressFromXP } from '@/lib/xp'

type PageProps = {
  params: Promise<{
    userId: string
  }>
}

type PublicProfileRow = {
  id: string
  name: string | null
  nickname: string | null
  avatar_url: string | null
  club_joined_at: string | null
}

type PublicRunStatRow = {
  xp: number | null
  distance_km: number | null
  created_at: string
  moving_time_seconds: number | null
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function buildRecent7DayActivity(runs: PublicRunStatRow[], now = new Date()) {
  const runsCountByDate = runs.reduce<Record<string, number>>((counts, run) => {
    const createdAt = new Date(run.created_at)
    if (Number.isNaN(createdAt.getTime())) {
      return counts
    }

    const dateKey = formatDateKey(createdAt)
    counts[dateKey] = (counts[dateKey] ?? 0) + 1
    return counts
  }, {})

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (6 - index))

    return {
      dateKey: formatDateKey(date),
      runsCount: runsCountByDate[formatDateKey(date)] ?? 0,
      isToday: index === 6,
    }
  })
}

function formatClubJoinedLabel(dateString: string | null | undefined) {
  if (!dateString) return 'дата неизвестна'
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return 'дата неизвестна'
  const monthLabels = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
  return `${monthLabels[date.getMonth()] ?? ''} ${date.getFullYear()}`.trim()
}

export default async function PublicUserProfilePage({ params }: PageProps) {
  const [{ user, error, supabase }, { userId }] = await Promise.all([getAuthenticatedUser(), params])

  if (error || !user) {
    redirect('/login')
  }

  const [{ data: profile, error: profileError }, { data: runs, error: runsError }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, name, nickname, avatar_url, club_joined_at')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('runs')
      .select('xp, distance_km, created_at, moving_time_seconds')
      .eq('user_id', userId),
  ])

  const publicProfile = (profile as PublicProfileRow | null) ?? null
  const publicRuns = (runs as PublicRunStatRow[] | null) ?? []
  const hasLoadError = Boolean(profileError || runsError)

  if (!publicProfile && !hasLoadError) {
    return (
      <WorkoutDetailShell title="Профиль участника">
        <div className="app-card rounded-2xl border p-4 shadow-sm">
          <p className="app-text-secondary text-sm">Пользователь не найден.</p>
          <Link href="/feed" className="app-button-secondary mt-4 inline-flex min-h-11 items-center rounded-lg border px-4 py-2 text-sm">
            Вернуться в ленту
          </Link>
        </div>
      </WorkoutDetailShell>
    )
  }

  if (hasLoadError) {
    return (
      <WorkoutDetailShell title="Профиль участника">
        <div className="app-card rounded-2xl border p-4 shadow-sm">
          <p className="text-sm text-red-600">Не удалось загрузить профиль.</p>
        </div>
      </WorkoutDetailShell>
    )
  }

  const totalXp = publicRuns.reduce((sum, run) => sum + Number(run.xp ?? 0), 0)
  const totalDistance = publicRuns.reduce((sum, run) => sum + Number(run.distance_km ?? 0), 0)
  const totalRuns = publicRuns.length
  const levelProgress = getLevelProgressFromXP(totalXp)
  const displayName = getProfileDisplayName(
    {
      name: publicProfile?.name ?? null,
      nickname: publicProfile?.nickname ?? null,
      email: null,
    },
    'Бегун'
  )
  const recent7DayActivity = buildRecent7DayActivity(publicRuns)
  const activity30Days = buildActivityWindowStats(publicRuns)
  const memberSinceLabel = formatClubJoinedLabel(publicProfile?.club_joined_at)

  return (
    <WorkoutDetailShell title="Профиль участника">
      <div className="space-y-7">
        <section className="app-card rounded-3xl border px-5 py-6 shadow-sm sm:px-6 sm:py-7">
          <div className="flex flex-col items-center text-center">
            <span className="relative inline-flex h-32 w-32 items-center justify-center rounded-full ring-1 ring-black/10 shadow-[0_8px_24px_rgba(0,0,0,0.08)] sm:h-36 sm:w-36 dark:ring-white/15 dark:shadow-[0_8px_24px_rgba(0,0,0,0.22)]">
              {publicProfile?.avatar_url ? (
                <Image
                  src={publicProfile.avatar_url}
                  alt="Аватар участника"
                  width={144}
                  height={144}
                  className="h-32 w-32 rounded-full object-cover sm:h-36 sm:w-36"
                />
              ) : (
                <span className="app-card app-text-secondary flex h-32 w-32 items-center justify-center rounded-full border text-sm sm:h-36 sm:w-36">
                  Аватар
                </span>
              )}
            </span>
            <div className="mt-3 min-w-0">
              <h2 className="app-text-primary truncate text-[1.5rem] font-semibold leading-tight sm:text-[1.7rem]">
                {displayName}
              </h2>
              <p className="app-text-secondary mt-2 text-sm sm:text-[15px]">
                В клубе с {memberSinceLabel}
              </p>
              <p className="app-text-secondary mt-3 text-sm font-medium sm:text-[15px]">
                Уровень {levelProgress.level}
              </p>
              <p className="app-text-primary mt-1 text-[2rem] font-bold leading-none tracking-tight sm:text-[2.35rem]">
                {totalXp} XP
              </p>
              <div className="mt-4 w-full max-w-xs">
                <div className="app-progress-track h-2 w-full overflow-hidden rounded-full">
                  <div
                    className="app-accent-bg h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
                    style={{ width: `${levelProgress.progressPercent}%` }}
                  />
                </div>
                <p className="app-text-secondary mt-2 text-sm">
                  {levelProgress.nextLevelXP === null
                    ? 'Максимальный уровень'
                    : `${levelProgress.xpToNextLevel} XP до уровня ${levelProgress.level + 1}`}
                </p>
              </div>
              <div className="mt-4">
                <p className="app-text-secondary text-xs font-medium">
                  Последние 7 дней
                </p>
                <div className="mt-2 flex items-center justify-center gap-1.5">
                  {recent7DayActivity.map((day) => {
                    const visibleDotsCount = Math.min(day.runsCount, 3)

                    return (
                      <div
                        key={day.dateKey}
                        className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                          day.isToday
                            ? 'border border-black/15 bg-black/[0.04] dark:border-white/15 dark:bg-white/[0.08]'
                            : 'app-surface-muted'
                        }`}
                        aria-label={`${day.isToday ? 'Сегодня' : day.dateKey}: ${day.runsCount} тренировок`}
                      >
                        {visibleDotsCount === 0 ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-black/20 dark:bg-white/20" aria-hidden="true" />
                        ) : (
                          <div className="flex items-center gap-1" aria-hidden="true">
                            {Array.from({ length: visibleDotsCount }, (_, index) => (
                              <span
                                key={`${day.dateKey}-dot-${index}`}
                                className={`h-1.5 w-1.5 rounded-full ${
                                  day.isToday ? 'bg-black dark:bg-white' : 'bg-black/65 dark:bg-white/75'
                                }`}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="mt-5 grid w-full max-w-xs grid-cols-2 gap-3">
              <div className="app-surface-muted rounded-2xl px-3 py-3">
                <p className="app-text-primary text-[1.25rem] font-semibold leading-none sm:text-[1.45rem]">
                  {formatDistanceKm(totalDistance)}
                </p>
                <p className="app-text-secondary mt-2 text-sm">км</p>
              </div>
              <div className="app-surface-muted rounded-2xl px-3 py-3">
                <p className="app-text-primary text-[1.25rem] font-semibold leading-none sm:text-[1.45rem]">
                  {totalRuns}
                </p>
                <p className="app-text-secondary mt-2 text-sm">тренировок</p>
              </div>
            </div>
          </div>
        </section>
        <section className="app-card rounded-2xl border p-4 shadow-sm sm:p-5">
          <h2 className="app-text-primary text-base font-semibold">Активность за 30 дней</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="app-surface-muted rounded-2xl px-3 py-3">
              <p className="app-text-primary text-lg font-semibold sm:text-[1.15rem]">
                {formatDistanceKm(activity30Days.totalDistanceKm)} км
              </p>
              <p className="app-text-secondary mt-1.5 text-sm">Дистанция</p>
            </div>
            <div className="app-surface-muted rounded-2xl px-3 py-3">
              <p className="app-text-primary text-lg font-semibold sm:text-[1.15rem]">
                {activity30Days.runsCount}
              </p>
              <p className="app-text-secondary mt-1.5 text-sm">Тренировки</p>
            </div>
            <div className="app-surface-muted rounded-2xl px-3 py-3">
              <p className="app-text-primary text-lg font-semibold sm:text-[1.15rem]">
                {activity30Days.activeDaysCount}
              </p>
              <p className="app-text-secondary mt-1.5 text-sm">Активные дни</p>
            </div>
            <div className="app-surface-muted rounded-2xl px-3 py-3">
              <p className="app-text-primary text-lg font-semibold sm:text-[1.15rem]">
                {formatDurationCompact(activity30Days.totalMovingTimeSeconds)}
              </p>
              <p className="app-text-secondary mt-1.5 text-sm">Время</p>
            </div>
          </div>
        </section>
        <div>
          <h2 className="app-text-primary mb-3 text-lg font-semibold">Тренировки</h2>
          <InfiniteWorkoutFeed
            currentUserId={user.id}
            targetUserId={userId}
            pageSize={10}
            emptyTitle="У этого участника пока нет тренировок"
            emptyDescription="Когда появятся пробежки, они будут показаны здесь."
            showLevelSubtitle={false}
          />
        </div>
      </div>
    </WorkoutDetailShell>
  )
}
