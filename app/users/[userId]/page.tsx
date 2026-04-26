'use server'

import Image from 'next/image'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { CheckCircle2, Trophy } from 'lucide-react'
import ActivitySummaryGrid from '@/components/ActivitySummaryGrid'
import InfiniteWorkoutFeed from '@/components/InfiniteWorkoutFeed'
import ProfileWeeklyVolumeTrendChart from '@/components/ProfileWeeklyVolumeTrendChart'
import WorkoutDetailShell from '@/components/WorkoutDetailShell'
import { loadUserAchievements, type UserAchievement } from '@/lib/achievements'
import { buildActivityWindowStats, buildRollingWeeklyDistanceChart } from '@/lib/activity'
import { formatAveragePace, formatDistanceKm, formatDurationCompact } from '@/lib/format'
import {
  loadPublicUserPersonalRecords,
  SUPPORTED_PERSONAL_RECORD_DISTANCES,
  type PersonalRecordView,
} from '@/lib/personal-records'
import { getProfileDisplayName } from '@/lib/profiles'
import {
  deriveRaceEventStatus,
  formatClock,
  formatRaceDateLabel,
  getRaceEventDisplayDistanceLabel,
  getTodayDateValue,
  type RaceEvent,
} from '@/lib/race-events'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { getLevelProgressFromXP, getRankTitleFromLevel } from '@/lib/xp'

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
  total_xp: number | null
  app_access_status: 'active' | 'blocked' | null
}

type PublicRunStatRow = {
  distance_km: number | null
  created_at: string
  moving_time_seconds: number | null
  elevation_gain_meters?: number | null
}

type PublicRaceEventRow = Pick<
  RaceEvent,
  | 'id'
  | 'user_id'
  | 'name'
  | 'race_date'
  | 'linked_run_id'
  | 'distance_meters'
  | 'result_time_seconds'
  | 'target_time_seconds'
  | 'status'
  | 'created_at'
  | 'linked_run'
>

const PUBLIC_PROFILE_RACE_EVENT_SELECT = `
  id,
  user_id,
  name,
  race_date,
  linked_run_id,
  distance_meters,
  result_time_seconds,
  target_time_seconds,
  status,
  created_at,
  linked_run:runs!race_events_linked_run_id_fkey (
    id,
    name,
    title,
    distance_km,
    moving_time_seconds,
    created_at
  )
`

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function buildRecent7DayActivity(runs: PublicRunStatRow[], now = new Date()) {
  const distanceByDate = runs.reduce<Record<string, number>>((totals, run) => {
    const createdAt = new Date(run.created_at)
    if (Number.isNaN(createdAt.getTime())) {
      return totals
    }

    const dateKey = formatDateKey(createdAt)
    totals[dateKey] = (totals[dateKey] ?? 0) + Math.max(0, Number(run.distance_km ?? 0))
    return totals
  }, {})

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (6 - index))
    const weekdayIndex = date.getDay()
    const normalizedWeekdayIndex = weekdayIndex === 0 ? 6 : weekdayIndex - 1
    const dateKey = formatDateKey(date)
    const distanceKm = distanceByDate[dateKey] ?? 0

    return {
      dateKey,
      weekdayLabel: WEEKDAY_LABELS[normalizedWeekdayIndex] ?? '',
      distanceKm,
      isActive: distanceKm > 0,
      isToday: index === 6,
    }
  })
}

function formatRecentDayDistanceLabel(distanceKm: number) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    return ''
  }

  const roundedDistance = Math.round(distanceKm)

  if (roundedDistance > 99) {
    return '99+'
  }

  return String(roundedDistance)
}

function formatElevationGainLabel(totalElevationGainMeters: number) {
  if (!Number.isFinite(totalElevationGainMeters) || totalElevationGainMeters <= 0) {
    return ''
  }

  return `${Math.round(totalElevationGainMeters)} м`
}

function formatClubJoinedLabel(dateString: string | null | undefined) {
  if (!dateString) return 'дата неизвестна'
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return 'дата неизвестна'
  const monthLabels = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
  return `${monthLabels[date.getMonth()] ?? ''} ${date.getFullYear()}`.trim()
}

function formatAchievementDate(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function formatPersonalRecordDistanceLabel(distanceMeters: number) {
  switch (distanceMeters) {
    case 5000:
      return '5 км'
    case 10000:
      return '10 км'
    case 21097:
      return '21.1 км'
    case 42195:
      return '42.2 км'
    default:
      return `${distanceMeters} м`
  }
}

function formatPersonalRecordTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatPersonalRecordDate(value: string | null) {
  if (!value) {
    return 'Дата неизвестна'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Дата неизвестна'
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function compareRaceEventsByDateAsc(left: PublicRaceEventRow, right: PublicRaceEventRow) {
  return left.race_date.localeCompare(right.race_date) || left.name.localeCompare(right.name)
}

function compareRaceEventsByDateDesc(left: PublicRaceEventRow, right: PublicRaceEventRow) {
  return right.race_date.localeCompare(left.race_date) || right.name.localeCompare(left.name)
}

function getUniqueRaceEvents(raceEvents: PublicRaceEventRow[]) {
  const seenRaceEventIds = new Set<string>()

  return raceEvents.filter((raceEvent) => {
    if (seenRaceEventIds.has(raceEvent.id)) {
      return false
    }

    seenRaceEventIds.add(raceEvent.id)
    return true
  })
}

function getPublicProfileStarts({
  upcomingRaceEvents,
  completedLinkedRaceEvents,
  completedUnlinkedRaceEvents,
}: {
  upcomingRaceEvents: PublicRaceEventRow[]
  completedLinkedRaceEvents: PublicRaceEventRow[]
  completedUnlinkedRaceEvents: PublicRaceEventRow[]
}) {
  const upcoming = upcomingRaceEvents
    .filter((raceEvent) => deriveRaceEventStatus(raceEvent) === 'upcoming')
    .sort(compareRaceEventsByDateAsc)
    .slice(0, 2)
  const completedLinked = completedLinkedRaceEvents
    .filter((raceEvent) => deriveRaceEventStatus(raceEvent) === 'completed_linked')
    .sort(compareRaceEventsByDateDesc)
    .slice(0, 2)
  const completedUnlinked = completedUnlinkedRaceEvents
    .filter((raceEvent) => deriveRaceEventStatus(raceEvent) === 'completed_unlinked')
    .sort(compareRaceEventsByDateDesc)
    .slice(0, 2)

  return getUniqueRaceEvents([...upcoming, ...completedLinked, ...completedUnlinked]).slice(0, 5)
}

function getPersonalRecordRowClass(hasHref: boolean) {
  const baseClass = 'flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0'

  if (!hasHref) {
    return baseClass
  }

  return `${baseClass} -mx-2 rounded-xl px-2 transition-colors hover:bg-black/[0.03] active:bg-black/[0.05] dark:hover:bg-white/[0.04] dark:active:bg-white/[0.06]`
}

function getProfileStartRowClass(hasHref: boolean) {
  const baseClass = 'flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0'

  if (!hasHref) {
    return baseClass
  }

  return `${baseClass} -mx-2 rounded-xl px-2 transition-colors hover:bg-black/[0.03] active:bg-black/[0.05] dark:hover:bg-white/[0.04] dark:active:bg-white/[0.06]`
}

function getAchievementSourceLabel(sourceType: UserAchievement['source_type']) {
  return sourceType === 'weekly_race' ? 'Гонка недели' : 'Челлендж'
}

function getAchievementItemClass(hasHref: boolean) {
  const baseClass = 'app-surface-muted rounded-2xl border border-black/[0.06] px-4 py-3 shadow-sm dark:border-white/[0.08]'

  if (!hasHref) {
    return baseClass
  }

  return `${baseClass} block transition-transform transition-shadow hover:shadow-md active:scale-[0.99]`
}

function getAchievementIconClass(sourceType: UserAchievement['source_type']) {
  if (sourceType === 'weekly_race') {
    return 'border border-amber-300/80 bg-amber-100/90 text-amber-700 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100'
  }

  return 'border border-emerald-300/70 bg-emerald-100/90 text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-100'
}

function AchievementPreviewIcon({ sourceType }: { sourceType: UserAchievement['source_type'] }) {
  if (sourceType === 'weekly_race') {
    return <Trophy className="h-[18px] w-[18px]" strokeWidth={2} />
  }

  return <CheckCircle2 className="h-[18px] w-[18px]" strokeWidth={2} />
}

function compareAchievementsByDateDesc(
  left: Pick<UserAchievement, 'date' | 'id'>,
  right: Pick<UserAchievement, 'date' | 'id'>
) {
  const leftTime = new Date(left.date).getTime()
  const rightTime = new Date(right.date).getTime()

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime
  }

  if (Number.isFinite(leftTime) && !Number.isFinite(rightTime)) {
    return -1
  }

  if (!Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return 1
  }

  return right.id.localeCompare(left.id)
}

async function loadPublicProfileStartsPreview(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
) {
  const todayDateValue = getTodayDateValue()

  const [upcomingResult, completedLinkedResult, completedUnlinkedResult] = await Promise.all([
    supabaseAdmin
      .from('race_events')
      .select(PUBLIC_PROFILE_RACE_EVENT_SELECT)
      .eq('user_id', userId)
      .is('linked_run_id', null)
      .gte('race_date', todayDateValue)
      .neq('status', 'cancelled')
      .neq('status', 'completed_linked')
      .neq('status', 'completed_unlinked')
      .order('race_date', { ascending: true })
      .limit(6),
    supabaseAdmin
      .from('race_events')
      .select(PUBLIC_PROFILE_RACE_EVENT_SELECT)
      .eq('user_id', userId)
      .eq('status', 'completed_linked')
      .order('race_date', { ascending: false })
      .limit(6),
    supabaseAdmin
      .from('race_events')
      .select(PUBLIC_PROFILE_RACE_EVENT_SELECT)
      .eq('user_id', userId)
      .is('linked_run_id', null)
      .lt('race_date', todayDateValue)
      .neq('status', 'cancelled')
      .order('race_date', { ascending: false })
      .limit(6),
  ])

  return {
    data: getPublicProfileStarts({
      upcomingRaceEvents: (upcomingResult.data as PublicRaceEventRow[] | null) ?? [],
      completedLinkedRaceEvents: (completedLinkedResult.data as PublicRaceEventRow[] | null) ?? [],
      completedUnlinkedRaceEvents: (completedUnlinkedResult.data as PublicRaceEventRow[] | null) ?? [],
    }),
    error: upcomingResult.error || completedLinkedResult.error || completedUnlinkedResult.error
      ? 'Не удалось загрузить старты'
      : null,
  }
}

export default async function PublicUserProfilePage({ params }: PageProps) {
  const [{ user, error, supabase }, { userId }] = await Promise.all([getAuthenticatedUser(), params])

  if (error || !user) {
    redirect('/login')
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const [{ data: profile, error: profileError }, { data: runs, error: runsError }, raceEventsResult, achievementsResult, personalRecordsResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, name, nickname, avatar_url, club_joined_at, total_xp, app_access_status')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('runs')
      .select('distance_km, created_at, moving_time_seconds, elevation_gain_meters')
      .eq('user_id', userId),
    loadPublicProfileStartsPreview(supabaseAdmin, userId),
    loadUserAchievements(userId)
      .then((data) => ({ data, error: null as string | null }))
      .catch(() => ({
        data: [] as UserAchievement[],
        error: 'Не удалось загрузить достижения',
      })),
    loadPublicUserPersonalRecords(userId)
      .then((data) => ({ data, error: null as string | null }))
      .catch(() => ({
        data: [] as PersonalRecordView[],
        error: 'Не удалось загрузить личные рекорды',
      })),
  ])

  const publicProfile = (profile as PublicProfileRow | null) ?? null
  const publicRuns = (runs as PublicRunStatRow[] | null) ?? []
  const hasLoadError = Boolean(profileError || runsError)
  const recentAchievements = achievementsResult.data
  const achievementsLoadError = achievementsResult.error
  const personalRecords = personalRecordsResult.data
  const personalRecordsLoadError = personalRecordsResult.error
  const profileStarts = raceEventsResult.data
  const profileStartsLoadError = raceEventsResult.error
  const personalRecordByDistance = new Map(personalRecords.map((record) => [record.distance_meters, record]))
  const sortedAchievements = [...recentAchievements].sort(compareAchievementsByDateDesc)
  const challengeAchievements = sortedAchievements.filter((achievement) => achievement.source_type === 'challenge')
  const nonChallengeAchievements = sortedAchievements.filter((achievement) => achievement.source_type !== 'challenge')
  const latestChallengeAchievement = challengeAchievements[0] ?? null
  const remainingChallengeAchievementsCount = Math.max(challengeAchievements.length - 1, 0)
  const profileAchievementsPreview = [
    nonChallengeAchievements[0] ?? null,
    latestChallengeAchievement,
  ].filter((achievement, index, items): achievement is UserAchievement =>
    Boolean(achievement) && items.findIndex((item) => item?.id === achievement?.id) === index
  ).sort(compareAchievementsByDateDesc)

  if (publicProfile && publicProfile.app_access_status !== 'active') {
    notFound()
  }

  if (!publicProfile && !hasLoadError) {
    return (
      <WorkoutDetailShell title="Профиль участника" enableSourceRestore pinnedHeader>
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
      <WorkoutDetailShell title="Профиль участника" enableSourceRestore pinnedHeader>
        <div className="app-card rounded-2xl border p-4 shadow-sm">
          <p className="text-sm text-red-600">Не удалось загрузить профиль.</p>
        </div>
      </WorkoutDetailShell>
    )
  }

  const totalXp = Number(publicProfile?.total_xp ?? 0)
  const levelProgress = getLevelProgressFromXP(totalXp)
  const rankTitle = getRankTitleFromLevel(levelProgress.level)
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
  const activity30DayChartData = buildRollingWeeklyDistanceChart(publicRuns, { weeks: 12 })
  const memberSinceLabel = formatClubJoinedLabel(publicProfile?.club_joined_at)
  const activity30DayElevationLabel = formatElevationGainLabel(activity30Days.totalElevationGainMeters)
  const activity30DayMetrics = [
    {
      id: 'distance',
      label: 'Дистанция',
      value: `${formatDistanceKm(activity30Days.totalDistanceKm)} км`,
    },
    {
      id: 'runs',
      label: 'Пробежки',
      value: String(activity30Days.runsCount),
    },
    {
      id: 'moving-time',
      label: 'В движении',
      value: formatDurationCompact(activity30Days.totalMovingTimeSeconds),
    },
    {
      id: 'average-pace',
      label: 'Средний темп',
      value: formatAveragePace(activity30Days.totalMovingTimeSeconds, activity30Days.totalDistanceKm),
    },
  ]

  return (
    <WorkoutDetailShell title="Профиль участника" enableSourceRestore pinnedHeader>
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
              <p className="app-text-secondary mt-1 text-sm">{rankTitle}</p>
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
                <div className="app-surface-muted mt-3 rounded-2xl px-3 py-3 ring-1 ring-black/5 dark:ring-white/10">
                  <div className="grid grid-cols-7 gap-2">
                    {recent7DayActivity.map((day) => {
                      const distanceLabel = formatRecentDayDistanceLabel(day.distanceKm)
                      return (
                        <div
                          key={day.dateKey}
                          className="flex min-w-0 flex-col items-center gap-1.5"
                          aria-label={`${day.isToday ? 'Сегодня' : day.dateKey}: ${distanceLabel ? `${distanceLabel} км` : 'без пробежки'}`}
                        >
                          <span className="app-text-muted text-[11px] font-medium leading-none">
                            {day.weekdayLabel}
                          </span>
                          <span
                            className={`flex h-11 w-11 items-center justify-center rounded-full text-[11px] font-semibold leading-none transition-colors ${
                              day.isActive
                                ? 'app-accent-bg text-white'
                                : 'bg-black/[0.04] text-black/35 dark:bg-white/[0.06] dark:text-white/35'
                            } ${
                              day.isToday
                                ? 'ring-1 ring-black/12 dark:ring-white/18'
                                : 'ring-1 ring-black/5 dark:ring-white/10'
                            }`}
                          >
                            {distanceLabel}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="space-y-3">
          <ActivitySummaryGrid
            title="Бег"
            subtitle="Сводка за последние 30 дней."
            metrics={activity30DayMetrics}
            compact
            secondaryMetricLabel={activity30DayElevationLabel ? 'Набор высоты' : undefined}
            secondaryMetricValue={activity30DayElevationLabel || undefined}
          />
          <div className="app-surface-muted mt-3 rounded-2xl px-3 py-3 ring-1 ring-black/5 dark:ring-white/10">
            <p className="app-text-secondary text-sm font-medium">Тренд дистанции за 12 недель</p>
            {activity30DayChartData.some((point) => point.distance > 0) ? (
              <div className="mt-3">
                <ProfileWeeklyVolumeTrendChart
                  data={activity30DayChartData}
                />
              </div>
            ) : (
              <p className="app-text-secondary mt-3 text-sm">
                За последние 12 недель пока нет пробежек.
              </p>
            )}
          </div>
        </section>
        <section className="app-card rounded-3xl border p-4 shadow-sm sm:p-5">
          <div className="min-w-0">
            <h2 className="app-text-primary text-lg font-semibold">Личные рекорды</h2>
            <p className="app-text-secondary mt-1 text-sm">Лучшие результаты на основных дистанциях.</p>
          </div>

          {personalRecordsLoadError ? (
            <p className="mt-4 text-sm text-red-600">{personalRecordsLoadError}</p>
          ) : (
            <div className="mt-4 divide-y divide-black/[0.06] dark:divide-white/[0.08]">
              {SUPPORTED_PERSONAL_RECORD_DISTANCES.map((distanceMeters) => {
                const record = personalRecordByDistance.get(distanceMeters) ?? null
                const hasHref = Boolean(record?.run_id)
                const content = (
                  <>
                    <div className="min-w-0">
                      <p className="app-text-primary text-sm font-medium">
                        {formatPersonalRecordDistanceLabel(distanceMeters)}
                      </p>
                      <p className="app-text-secondary mt-1 text-xs">
                        {record ? formatPersonalRecordDate(record.record_date) : 'Пока нет результата'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="app-text-primary text-sm font-semibold">
                        {record ? formatPersonalRecordTime(record.duration_seconds) : '—'}
                      </p>
                      {record && !record.run_id ? (
                        <p className="app-text-secondary mt-1 text-[11px]">
                          Исторический результат
                        </p>
                      ) : null}
                    </div>
                  </>
                )

                if (record?.run_id) {
                  return (
                    <Link
                      key={distanceMeters}
                      href={`/runs/${record.run_id}`}
                      className={getPersonalRecordRowClass(hasHref)}
                    >
                      {content}
                    </Link>
                  )
                }

                return (
                  <div key={distanceMeters} className={getPersonalRecordRowClass(false)}>
                    {content}
                  </div>
                )
              })}
            </div>
          )}
        </section>
        <section className="app-card rounded-3xl border p-4 shadow-sm sm:p-5">
          <div className="min-w-0">
            <h2 className="app-text-primary text-lg font-semibold">Старты</h2>
            <p className="app-text-secondary mt-1 text-sm">Ближайшие планы и последние результаты.</p>
          </div>

          {profileStartsLoadError ? (
            <p className="mt-4 text-sm text-red-600">{profileStartsLoadError}</p>
          ) : profileStarts.length === 0 ? (
            <div className="app-surface-muted mt-4 rounded-2xl border border-black/[0.06] px-4 py-4 text-center dark:border-white/[0.08]">
              <p className="app-text-secondary text-sm">Пока нет стартов.</p>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-black/[0.06] dark:divide-white/[0.08]">
              {profileStarts.map((raceEvent) => {
                const status = deriveRaceEventStatus(raceEvent)
                const distanceLabel = getRaceEventDisplayDistanceLabel(raceEvent)?.label ?? null
                const resultLabel = formatClock(raceEvent.result_time_seconds)
                const href = raceEvent.linked_run_id ? `/runs/${raceEvent.linked_run_id}` : null
                const content = (
                  <>
                    <div className="min-w-0">
                      <p className="app-text-primary line-clamp-2 break-words text-sm font-medium leading-5">
                        {raceEvent.name}
                      </p>
                      <p className="app-text-secondary mt-1 text-xs">
                        {formatRaceDateLabel(raceEvent.race_date)}
                        {distanceLabel ? ` • ${distanceLabel}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 pl-2 text-right">
                      <p className="app-text-primary text-sm font-semibold">
                        {status === 'upcoming'
                          ? 'План'
                          : resultLabel ?? (status === 'completed_unlinked' ? 'результат не найден' : '—')}
                      </p>
                    </div>
                  </>
                )

                return href ? (
                  <Link key={raceEvent.id} href={href} className={getProfileStartRowClass(true)}>
                    {content}
                  </Link>
                ) : (
                  <div key={raceEvent.id} className={getProfileStartRowClass(false)}>
                    {content}
                  </div>
                )
              })}
            </div>
          )}
        </section>
        <section className="app-card rounded-3xl border p-4 shadow-sm sm:p-5">
          <div className="min-w-0">
            <h2 className="app-text-primary text-lg font-semibold">Достижения</h2>
            <p className="app-text-secondary mt-1 text-sm">Последние награды и завершенные челленджи участника.</p>
          </div>

          {achievementsLoadError ? (
            <p className="mt-4 text-sm text-red-600">{achievementsLoadError}</p>
          ) : profileAchievementsPreview.length === 0 ? (
            <div className="app-surface-muted mt-4 rounded-2xl border border-black/[0.06] px-4 py-4 text-center dark:border-white/[0.08]">
              <p className="app-text-secondary text-sm">Пока нет достижений.</p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {profileAchievementsPreview.map((achievement) => {
                const content = (
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${getAchievementIconClass(achievement.source_type)}`}
                      aria-hidden="true"
                    >
                      <AchievementPreviewIcon sourceType={achievement.source_type} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="app-text-secondary text-[11px] font-medium uppercase tracking-[0.08em]">
                            {getAchievementSourceLabel(achievement.source_type)}
                          </p>
                          <p className="app-text-primary mt-1 text-sm font-semibold">{achievement.label}</p>
                        </div>
                        {achievement.rank ? (
                          <span className="shrink-0 rounded-full border border-black/[0.06] bg-black/[0.04] px-2.5 py-1 text-xs font-semibold text-black/70 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-white/80">
                            #{achievement.rank}
                          </span>
                        ) : null}
                      </div>
                      <p className="app-text-secondary mt-1 text-sm">{achievement.subtitle}</p>
                      <p className="app-text-secondary mt-2 text-xs">{formatAchievementDate(achievement.date)}</p>
                      {achievement.source_type === 'challenge' ? (
                        <p className="app-text-secondary mt-2 text-xs">
                          Всего достижений: {challengeAchievements.length}
                        </p>
                      ) : null}
                    </div>
                  </div>
                )

                if (achievement.href) {
                  return (
                    <Link
                      key={achievement.id}
                      href={achievement.href}
                      className={getAchievementItemClass(true)}
                    >
                      {content}
                    </Link>
                  )
                }

                return (
                  <div key={achievement.id} className={getAchievementItemClass(false)}>
                    {content}
                  </div>
                )
              })}
              {remainingChallengeAchievementsCount > 0 ? (
                <div className="app-surface-muted rounded-2xl border border-black/[0.06] px-4 py-3 dark:border-white/[0.08]">
                  <p className="app-text-secondary text-sm">Еще {remainingChallengeAchievementsCount} достижений</p>
                </div>
              ) : null}
            </div>
          )}
        </section>
        <div>
          <h2 className="app-text-primary mb-3 text-lg font-semibold">Последняя активность</h2>
          <InfiniteWorkoutFeed
            currentUserId={user.id}
            targetUserId={userId}
            pageSize={10}
            scrollRestorationKey={`profile-${userId}`}
            emptyTitle="У этого участника пока нет тренировок"
            emptyDescription="Когда появятся пробежки, они будут показаны здесь."
            showLevelSubtitle={false}
          />
        </div>
      </div>
    </WorkoutDetailShell>
  )
}
