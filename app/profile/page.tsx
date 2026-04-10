'use client'

import Link from 'next/link'
import { Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { logoutCurrentUser } from '@/lib/auth/logoutClient'
import { getBootstrapUser } from '@/lib/auth'
import AvatarCropModal from '@/components/AvatarCropModal'
import LevelOverviewSheet from '@/components/LevelOverviewSheet'
import UserIdentitySummary from '@/components/UserIdentitySummary'
import { getProfileDisplayName, updateProfileById } from '@/lib/profiles'
import { supabase } from '../../lib/supabase'
import { getLevelFromXP, getLevelProgressFromXP, getRankTitleFromLevel } from '../../lib/xp'
import type { User } from '@supabase/supabase-js'

type Profile = {
  id: string
  email: string | null
  name: string | null
  nickname: string | null
  avatar_url: string | null
  total_xp?: number | null
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
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [uploading, setUploading] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const [totalXp, setTotalXp] = useState(0)
  const [showLevelOverview, setShowLevelOverview] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [profileDataLoading, setProfileDataLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

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

  if (!loading && !user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

  const effectiveProfileDataLoading = loading || profileDataLoading
  const profileDisplayName = getProfileDisplayName(
    {
      name: profile?.name ?? null,
      nickname: profile?.nickname ?? null,
      email: user?.email ?? null,
    },
    'Бегун'
  )
  const levelProgress = getLevelProgressFromXP(totalXp)
  const currentLevel = getLevelFromXP(totalXp).level
  const currentRankTitle = getRankTitleFromLevel(currentLevel)

  if (effectiveProfileDataLoading) {
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
                description="Подключение и синхронизация"
                href="/profile/strava"
              />
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
        <LevelOverviewSheet
          open={showLevelOverview}
          totalXp={totalXp}
          onClose={() => setShowLevelOverview(false)}
        />
      </div>
    </main>
  )
}
