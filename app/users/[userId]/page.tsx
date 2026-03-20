'use server'

import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import BackNavigationButton from '@/components/BackNavigationButton'
import InfiniteWorkoutFeed from '@/components/InfiniteWorkoutFeed'
import { formatDistanceKm } from '@/lib/format'
import { getProfileDisplayName } from '@/lib/profiles'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { getLevelFromXP } from '@/lib/xp'

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
}

type PublicRunStatRow = {
  xp: number | null
  distance_km: number | null
  created_at: string
}

function formatUtcDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function getTrainingStreak(runs: PublicRunStatRow[]) {
  const runDateKeys = new Set(
    runs
      .map((run) => run.created_at?.slice(0, 10))
      .filter((value): value is string => Boolean(value))
  )

  if (runDateKeys.size === 0) {
    return 0
  }

  const cursor = new Date()
  let currentDateKey = formatUtcDateKey(cursor)

  if (!runDateKeys.has(currentDateKey)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1)
    currentDateKey = formatUtcDateKey(cursor)

    if (!runDateKeys.has(currentDateKey)) {
      return 0
    }
  }

  let streak = 0

  while (runDateKeys.has(currentDateKey)) {
    streak += 1
    cursor.setUTCDate(cursor.getUTCDate() - 1)
    currentDateKey = formatUtcDateKey(cursor)
  }

  return streak
}

export default async function PublicUserProfilePage({ params }: PageProps) {
  const [{ user, error, supabase }, { userId }] = await Promise.all([getAuthenticatedUser(), params])

  if (error || !user) {
    redirect('/login')
  }

  const [{ data: profile, error: profileError }, { data: runs, error: runsError }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, name, nickname, avatar_url')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('runs')
      .select('xp, distance_km, created_at')
      .eq('user_id', userId),
  ])

  const publicProfile = (profile as PublicProfileRow | null) ?? null
  const publicRuns = (runs as PublicRunStatRow[] | null) ?? []
  const hasLoadError = Boolean(profileError || runsError)

  if (!publicProfile && !hasLoadError) {
    return (
      <main className="min-h-screen pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
        <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
          <BackNavigationButton className="mb-4" />
          <h1 className="app-text-primary mb-4 text-2xl font-bold">Профиль участника</h1>
          <div className="app-card rounded-2xl border p-4 shadow-sm">
            <p className="app-text-secondary text-sm">Пользователь не найден.</p>
            <Link href="/feed" className="app-button-secondary mt-4 inline-flex min-h-11 items-center rounded-lg border px-4 py-2 text-sm">
              Вернуться в ленту
            </Link>
          </div>
        </div>
      </main>
    )
  }

  if (hasLoadError) {
    return (
      <main className="min-h-screen pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
        <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
          <BackNavigationButton className="mb-4" />
          <h1 className="app-text-primary mb-4 text-2xl font-bold">Профиль участника</h1>
          <div className="app-card rounded-2xl border p-4 shadow-sm">
            <p className="text-sm text-red-600">Не удалось загрузить профиль.</p>
          </div>
        </div>
      </main>
    )
  }

  const totalXp = publicRuns.reduce((sum, run) => sum + Number(run.xp ?? 0), 0)
  const totalDistance = publicRuns.reduce((sum, run) => sum + Number(run.distance_km ?? 0), 0)
  const totalRuns = publicRuns.length
  const level = getLevelFromXP(totalXp).level
  const displayName = getProfileDisplayName(
    {
      name: publicProfile?.name ?? null,
      nickname: publicProfile?.nickname ?? null,
      email: null,
    },
    'Бегун'
  )
  const trainingStreak = getTrainingStreak(publicRuns)

  return (
    <main className="min-h-screen pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <BackNavigationButton className="mb-4" />
        <h1 className="app-text-primary mb-4 text-2xl font-bold">Профиль участника</h1>
        <section className="app-card mb-5 rounded-3xl border px-5 py-5 shadow-sm sm:px-6 sm:py-6">
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
              <p className="app-text-secondary mt-2 text-sm font-medium sm:text-[15px]">
                Уровень {level}
              </p>
              <p className="app-text-primary mt-1 text-[1.6rem] font-semibold leading-none tracking-tight sm:text-[1.9rem]">
                {totalXp} XP
              </p>
              {trainingStreak > 0 ? (
                <p className="app-text-secondary mt-2 text-sm font-medium sm:text-[15px]">
                  🔥 {trainingStreak} дней подряд
                </p>
              ) : null}
            </div>
            <div className="mt-4 grid w-full max-w-xs grid-cols-2 gap-2.5">
              <div className="app-surface-muted rounded-2xl px-3 py-2.5">
                <p className="app-text-secondary text-xs font-medium uppercase tracking-[0.04em]">Км</p>
                <p className="app-text-primary mt-1 text-base font-semibold sm:text-[1.05rem]">
                  {formatDistanceKm(totalDistance)}
                </p>
              </div>
              <div className="app-surface-muted rounded-2xl px-3 py-2.5">
                <p className="app-text-secondary text-xs font-medium uppercase tracking-[0.04em]">Тренировки</p>
                <p className="app-text-primary mt-1 text-base font-semibold sm:text-[1.05rem]">
                  {totalRuns}
                </p>
              </div>
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
    </main>
  )
}
