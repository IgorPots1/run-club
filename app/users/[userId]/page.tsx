'use server'

import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import BackNavigationButton from '@/components/BackNavigationButton'
import InfiniteWorkoutFeed from '@/components/InfiniteWorkoutFeed'
import UserIdentitySummary from '@/components/UserIdentitySummary'
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
      .select('xp, distance_km')
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
  const profileName = publicProfile?.name?.trim() || null
  const profileNickname = publicProfile?.nickname?.trim() || null

  return (
    <main className="min-h-screen pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <BackNavigationButton className="mb-4" />
        <h1 className="app-text-primary mb-4 text-2xl font-bold">Профиль участника</h1>
        <div className="mb-6 flex flex-col items-center gap-4">
          <span className="relative inline-flex h-28 w-28 items-center justify-center rounded-full sm:h-32 sm:w-32">
            {publicProfile?.avatar_url ? (
              <Image
                src={publicProfile.avatar_url}
                alt="Аватар участника"
                width={112}
                height={112}
                className="h-28 w-28 rounded-full object-cover sm:h-32 sm:w-32"
              />
            ) : (
              <span className="app-card app-text-secondary flex h-28 w-28 items-center justify-center rounded-full border text-sm sm:h-32 sm:w-32">
                Аватар
              </span>
            )}
          </span>
          <UserIdentitySummary
            loadingIdentity={false}
            loadingLevel={false}
            displayName={displayName}
            levelLabel={`Уровень ${level}`}
            className="w-full text-center"
          />
          <div className="w-full max-w-sm space-y-2 text-center">
            <div className="app-card rounded-2xl border p-4 shadow-sm">
              <div className="flex items-center justify-between gap-4 border-b py-2">
                <span className="app-text-secondary min-w-0">Имя</span>
                <span className="app-text-primary shrink-0 text-right font-semibold">{profileName ?? 'Не указано'}</span>
              </div>
              <div className="flex items-center justify-between gap-4 py-2">
                <span className="app-text-secondary min-w-0">Никнейм</span>
                <span className="app-text-primary shrink-0 text-right font-semibold">{profileNickname ?? 'Не указан'}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="app-card overflow-hidden rounded-2xl border p-4 shadow-sm">
          <h2 className="app-text-primary mb-4 text-xl font-semibold">Статистика</h2>
          <div className="flex items-center justify-between gap-4 border-b py-2">
            <span className="app-text-secondary min-w-0">Уровень</span>
            <span className="app-text-primary shrink-0 text-right font-semibold">{level}</span>
          </div>
          <div className="flex items-center justify-between gap-4 border-b py-2">
            <span className="app-text-secondary min-w-0">Всего XP</span>
            <span className="app-text-primary shrink-0 text-right font-semibold">{totalXp}</span>
          </div>
          <div className="flex items-center justify-between gap-4 border-b py-2">
            <span className="app-text-secondary min-w-0">Всего км</span>
            <span className="app-text-primary shrink-0 text-right font-semibold">{formatDistanceKm(totalDistance)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 py-2">
            <span className="app-text-secondary min-w-0">Тренировки</span>
            <span className="app-text-primary shrink-0 text-right font-semibold">{totalRuns}</span>
          </div>
        </div>
        <div className="mt-6">
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
