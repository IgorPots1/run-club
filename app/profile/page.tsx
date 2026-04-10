'use client'

import Link from 'next/link'
import { Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { logoutCurrentUser } from '@/lib/auth/logoutClient'
import { getBootstrapUser } from '@/lib/auth'
import AvatarCropModal from '@/components/AvatarCropModal'
import LevelOverviewSheet from '@/components/LevelOverviewSheet'
import XpGainToast from '@/components/XpGainToast'
import UserIdentitySummary from '@/components/UserIdentitySummary'
import { getProfileDisplayName, updateProfileById } from '@/lib/profiles'
import { supabase } from '../../lib/supabase'
import { getLevelFromXP, getLevelProgressFromXP, getRankTitleFromLevel, type XpBreakdownItem } from '../../lib/xp'
import type { User } from '@supabase/supabase-js'

type Profile = {
  id: string
  email: string | null
  name: string | null
  nickname: string | null
  avatar_url: string | null
  total_xp?: number | null
}

type StravaStatusResponse =
  | {
      ok: true
      state: 'connected' | 'reconnect_required' | 'disconnected'
      connected: boolean
      hasImportedRuns: boolean
    }
  | {
      ok: false
      step?: string
      error?: string
    }

function StravaIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="block h-[18px] w-[18px] shrink-0 text-[#FC4C02]"
    >
      <path d="M15.386 1 9.999 11.56h3.178L15.386 7l2.209 4.56h3.177L15.386 1Z" />
      <path d="M9.999 14.077 7.354 19.41h2.41L9.999 18.9l.235.51h2.41l-2.645-5.333Z" />
    </svg>
  )
}

type HubRowProps = {
  title: string
  description?: string
  href?: string
  onClick?: () => void
}

function HubRow({
  title,
  description,
  href,
  onClick,
}: HubRowProps) {
  const className =
    'flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors active:bg-black/[0.03] dark:active:bg-white/[0.04]'

  const content = (
    <>
      <div className="min-w-0">
        <p className="app-text-primary text-sm font-medium">{title}</p>
        {description ? <p className="app-text-secondary mt-1 text-xs">{description}</p> : null}
      </div>
      <span aria-hidden="true" className="app-text-secondary shrink-0 text-sm">
        {'>'}
      </span>
    </>
  )

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    )
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  )
}

export default function ProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfilePageContent />
    </Suspense>
  )
}

function ProfilePageContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [uploading, setUploading] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const [totalXp, setTotalXp] = useState(0)
  const [showLevelOverview, setShowLevelOverview] = useState(false)
  const [stravaConnectionState, setStravaConnectionState] = useState<'connected' | 'reconnect_required' | 'disconnected'>('disconnected')
  const [loadingStravaStatus, setLoadingStravaStatus] = useState(true)
  const [loggingOut, setLoggingOut] = useState(false)
  const [profileDataLoading, setProfileDataLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [hubMessage, setHubMessage] = useState('')
  const [showStravaConnectedToast, setShowStravaConnectedToast] = useState(false)
  const [xpToast, setXpToast] = useState<{ xpGained: number; breakdown: XpBreakdownItem[] } | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const hasShownStravaConnectedToastRef = useRef(false)

  const loadProfileData = useCallback(async (
    currentUser: User,
    options: { isMounted?: boolean; showLoading?: boolean } = {}
  ) => {
    const { isMounted = true, showLoading = true } = options

    setPageError('')
    if (showLoading) {
      setProfileDataLoading(true)
    }

    try {
      const profileFallback = {
        id: currentUser.id,
        email: currentUser.email ?? '',
        name: '',
        nickname: '',
        avatar_url: null,
        total_xp: 0,
      }

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .maybeSingle()

      if (!isMounted) return

      if (profileError) {
        setPageError('Не удалось загрузить профиль')
      }

      const nextProfile = profileData
        ? {
            id: profileData.id,
            email: profileData.email ?? currentUser.email ?? '',
            name: profileData.name ?? '',
            nickname: profileData.nickname ?? '',
            avatar_url: profileData.avatar_url ?? null,
            total_xp: profileData.total_xp ?? 0,
          }
        : profileFallback

      setProfile(nextProfile)
      setTotalXp(Number(nextProfile.total_xp ?? 0))
    } catch {
      if (isMounted) {
        setPageError('Не удалось загрузить профиль')
      }
    } finally {
      if (isMounted && showLoading) {
        setProfileDataLoading(false)
      }
    }
  }, [])

  const loadStravaStatus = useCallback(async (isMounted = true) => {
    setLoadingStravaStatus(true)

    try {
      const response = await fetch('/api/strava/status', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'include',
      })

      const payload = (await response.json()) as StravaStatusResponse

      if (!isMounted) return

      if (!response.ok || !payload.ok) {
        setStravaConnectionState('disconnected')
        return
      }

      setStravaConnectionState(payload.state)
    } catch {
      if (!isMounted) return
      setStravaConnectionState('disconnected')
    } finally {
      if (isMounted) {
        setLoadingStravaStatus(false)
      }
    }
  }, [])

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
          setLoading(false)
        }
      }
    }

    void loadUser()

    return () => {
      isMounted = false
    }
  }, [router])

  useEffect(() => {
    if (!user) return
    const currentUser = user
    let isMounted = true

    void loadProfileData(currentUser, { isMounted, showLoading: true })

    return () => {
      isMounted = false
    }
  }, [loadProfileData, user])

  useEffect(() => {
    if (!user) return

    let isMounted = true

    void loadStravaStatus(isMounted)

    return () => {
      isMounted = false
    }
  }, [loadStravaStatus, user])

  useEffect(() => {
    const stravaStatus = searchParams.get('strava')

    if (stravaStatus !== 'connected' || hasShownStravaConnectedToastRef.current) {
      return
    }

    hasShownStravaConnectedToastRef.current = true
    setShowStravaConnectedToast(true)

    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.delete('strava')
    const nextUrl = nextParams.toString() ? `${pathname}?${nextParams.toString()}` : pathname
    router.replace(nextUrl, { scroll: false })
  }, [pathname, router, searchParams])

  useEffect(() => {
    if (!showStravaConnectedToast) {
      return
    }

    const timer = window.setTimeout(() => {
      setShowStravaConnectedToast(false)
    }, 3000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [showStravaConnectedToast])

  useEffect(() => {
    if (!xpToast) {
      return
    }

    const timer = window.setTimeout(() => {
      setXpToast(null)
    }, 3000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [xpToast])

  useEffect(() => {
    return () => {
      if (cropImageSrc) {
        URL.revokeObjectURL(cropImageSrc)
      }
    }
  }, [cropImageSrc])

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setPageError('Можно загрузить только изображение')
      e.target.value = ''
      return
    }

    if (cropImageSrc) {
      URL.revokeObjectURL(cropImageSrc)
    }

    setPageError('')
    setCropImageSrc(URL.createObjectURL(file))
    e.target.value = ''
  }

  function prepareAvatarInput() {
    if (!avatarInputRef.current) return

    avatarInputRef.current.disabled = false
    avatarInputRef.current.value = ''
  }

  function closeCropModal() {
    if (cropImageSrc) {
      URL.revokeObjectURL(cropImageSrc)
    }

    setCropImageSrc(null)
  }

  async function handleAvatarCropped(blob: Blob) {
    if (!user || uploading) return

    setUploading(true)
    setPageError('')
    const nextName = profile?.name ?? null
    const nextNickname = profile?.nickname ?? null

    try {
      const path = `${user.id}/avatar-${Date.now()}.jpg`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, blob, {
        contentType: 'image/jpeg',
      })

      if (uploadError) {
        throw new Error('upload_failed')
      }

      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      const { error: profileError, data: profileUpdateData } = await updateProfileById({
        id: user.id,
        name: nextName,
        nickname: nextNickname,
        avatar_url: data.publicUrl,
      })

      if (profileError || !profileUpdateData) {
        console.error('[profile] avatar update failed', {
          authUserId: user.id,
          profileError,
          profileUpdateData,
        })
        throw new Error('profile_update_failed')
      }

      setProfile((prev) => ({
        id: prev?.id ?? user.id,
        email: prev?.email ?? user.email ?? '',
        name: prev?.name ?? nextName,
        nickname: prev?.nickname ?? nextNickname,
        avatar_url: data.publicUrl,
      }))
      closeCropModal()
    } catch {
      setPageError('Не удалось обновить аватар')
    } finally {
      setUploading(false)
    }
  }

  async function handleLogout() {
    if (loggingOut) return

    const confirmed = window.confirm('Выйти из аккаунта?')

    if (!confirmed) {
      return
    }

    setLoggingOut(true)
    setPageError('')
    setStravaConnectionState('disconnected')

    try {
      await logoutCurrentUser({
        router,
        redirectTo: '/login',
      })
    } catch {
      setPageError('Не удалось выйти из аккаунта')
    } finally {
      setLoggingOut(false)
    }
  }

  if (loading) return <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">Загрузка...</main>
  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

  const profileDisplayName = getProfileDisplayName(
    {
      name: profile?.name ?? null,
      nickname: profile?.nickname ?? null,
      email: user.email ?? null,
    },
    'Бегун'
  )
  const levelProgress = getLevelProgressFromXP(totalXp)
  const currentLevel = getLevelFromXP(totalXp).level
  const currentRankTitle = getRankTitleFromLevel(currentLevel)
  const stravaRowDescription = loadingStravaStatus
    ? 'Проверяем подключение...'
    : stravaConnectionState === 'connected'
      ? 'Подключено и готово к синхронизации'
      : stravaConnectionState === 'reconnect_required'
        ? 'Нужно переподключить аккаунт'
        : 'Подключение пока не настроено'
  if (profileDataLoading) {
    return (
      <main className="min-h-screen pt-[env(safe-area-inset-top)] md:pt-0">
        <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
          <h1 className="app-text-primary mb-4 text-2xl font-bold">Профиль</h1>
          <div className="mb-6 flex flex-col items-center gap-4">
            <div className="skeleton-line h-28 w-28 rounded-full sm:h-32 sm:w-32" />
            <div className="skeleton-line h-4 w-40" />
            <div className="w-full max-w-sm space-y-2 text-center">
              <div className="mx-auto skeleton-line h-6 w-40" />
              <div className="mx-auto skeleton-line h-4 w-20" />
            </div>
          </div>
          <div className="app-card overflow-hidden rounded-2xl border shadow-sm">
            <div className="space-y-3 p-4">
              <div className="skeleton-line h-4 w-24" />
              <div className="skeleton-line h-12 w-full" />
              <div className="skeleton-line h-12 w-full" />
              <div className="skeleton-line h-12 w-full" />
              <div className="skeleton-line h-12 w-full" />
              <div className="skeleton-line h-12 w-full" />
            </div>
          </div>
          <div className="mt-6">
            <div className="skeleton-line h-11 w-full rounded-lg" />
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen pt-[env(safe-area-inset-top)] md:pt-0">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <h1 className="app-text-primary mb-4 text-2xl font-bold">Профиль</h1>
        {pageError ? <p className="mb-4 text-sm text-red-600">{pageError}</p> : null}
        {hubMessage ? <p className="mb-4 text-sm text-[var(--text-secondary)]">{hubMessage}</p> : null}
        <div className="mb-6 flex flex-col items-center gap-4">
          <div
            className={`group relative -m-2 inline-flex h-32 w-32 items-center justify-center rounded-full p-2 transition-transform active:scale-[0.98] sm:h-36 sm:w-36 ${
              uploading ? 'pointer-events-none opacity-60' : ''
            }`}
            aria-busy={uploading}
          >
            <span className="relative inline-flex h-28 w-28 items-center justify-center rounded-full sm:h-32 sm:w-32">
              {profile?.avatar_url ? (
                <Image
                  src={profile.avatar_url}
                  alt="Аватар"
                  width={112}
                  height={112}
                  className="h-28 w-28 rounded-full object-cover transition-opacity group-hover:opacity-95 sm:h-32 sm:w-32"
                />
              ) : (
                <span className="app-card app-text-secondary flex h-28 w-28 items-center justify-center rounded-full border text-sm transition-colors group-hover:bg-black/5 sm:h-32 sm:w-32 dark:group-hover:bg-white/5">
                  Аватар
                </span>
              )}
              <span className="absolute inset-0 rounded-full ring-0 transition-all group-hover:ring-2 group-hover:ring-black/10 group-active:ring-2 group-active:ring-black/15 dark:group-hover:ring-white/15 dark:group-active:ring-white/20" />
            </span>
            <input
              ref={avatarInputRef}
              id="avatar-upload"
              type="file"
              accept="image/*"
              onClickCapture={prepareAvatarInput}
              onChange={handleAvatarChange}
              disabled={uploading}
              aria-label={profile?.avatar_url ? 'Изменить аватар' : 'Загрузить аватар'}
              className="absolute inset-0 cursor-pointer rounded-full opacity-0"
            />
          </div>
          <p className="app-text-secondary text-sm">
            {uploading ? 'Загружаем аватар...' : 'Нажмите на аватар, чтобы изменить фото'}
          </p>
          <button
            type="button"
            onClick={() => setShowLevelOverview(true)}
            className="w-full max-w-sm rounded-3xl border border-black/5 bg-black/[0.02] px-4 py-4 text-center transition-transform active:scale-[0.995] dark:border-white/10 dark:bg-white/[0.03]"
          >
            <UserIdentitySummary
              loadingIdentity={false}
              loadingLevel={false}
              displayName={profileDisplayName}
              levelLabel={`Уровень ${currentLevel}`}
              className="w-full text-center"
            />
            <p className="app-text-secondary mt-1 text-sm">{currentRankTitle}</p>
            <p className="app-text-secondary mt-2 text-xs">
              {levelProgress.nextLevelXP === null
                ? 'Максимальный уровень клуба'
                : `${levelProgress.xpToNextLevel} XP до следующего уровня`}
            </p>
          </button>
        </div>

        <section className="mb-6">
          <p className="app-text-secondary mb-3 text-xs font-medium uppercase tracking-[0.08em]">
            Быстрый доступ
          </p>
          <div className="app-card overflow-hidden rounded-2xl border shadow-sm">
            <div className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
              <HubRow
                title="Аккаунт"
                description={user.email ?? 'Имя, никнейм и вход'}
                href="/profile/account"
              />
              <HubRow
                title="Уведомления"
                description="Push и настройки доставки"
                href="/profile/notifications"
              />
              <HubRow
                title="Strava"
                description={stravaRowDescription}
                onClick={() => {
                  setPageError('')
                  setHubMessage('Раздел "Strava" позже вынесем на отдельный экран.')
                }}
              />
              <HubRow title="Активность" description="Пробежки и история активности" href="/activity" />
              <HubRow title="Достижения" description="Ваши бейджи и прогресс" href="/activity/achievements" />
              <HubRow title="Кроссовки" description="Пары и их пробег" href="/activity/shoes" />
              <HubRow title="Связаться с тренером" description="Открыть чат" href="/messages" />
              <HubRow
                title="Мой профиль для других"
                description="Посмотреть публичную страницу"
                href={`/users/${user.id}`}
              />
            </div>
          </div>
        </section>

        <div className="mb-8">
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="app-button-secondary min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loggingOut ? 'Выходим...' : 'Выйти'}
          </button>
        </div>
        {cropImageSrc ? (
          <AvatarCropModal
            imageSrc={cropImageSrc}
            loading={uploading}
            onCancel={closeCropModal}
            onConfirm={handleAvatarCropped}
          />
        ) : null}
        {showStravaConnectedToast ? (
          <div className="pointer-events-none fixed inset-x-4 top-4 z-50 flex justify-center">
            <div className="app-card flex w-full max-w-sm items-center gap-3 rounded-2xl border px-4 py-3 shadow-lg ring-1 ring-black/5 dark:ring-white/10">
              <span
                aria-hidden="true"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border"
              >
                <StravaIcon />
              </span>
              <p className="app-text-primary text-sm font-medium">Strava успешно подключена</p>
            </div>
          </div>
        ) : null}
        {xpToast ? <XpGainToast xpGained={xpToast.xpGained} breakdown={xpToast.breakdown} offsetClassName="top-20" /> : null}
        <LevelOverviewSheet
          open={showLevelOverview}
          totalXp={totalXp}
          onClose={() => setShowLevelOverview(false)}
        />
      </div>
    </main>
  )
}
