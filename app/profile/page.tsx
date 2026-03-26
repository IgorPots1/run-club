'use client'

import Link from 'next/link'
import { Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { Eye, EyeOff } from 'lucide-react'
import { getBootstrapUser } from '@/lib/auth'
import AvatarCropModal from '@/components/AvatarCropModal'
import UserIdentitySummary from '@/components/UserIdentitySummary'
import { formatDistanceKm } from '@/lib/format'
import { loadLikeXpByUser } from '@/lib/likes-xp'
import { ensureProfileExists, getProfileDisplayName, updateProfileById } from '@/lib/profiles'
import { dispatchRunsUpdatedEvent } from '@/lib/runs-refresh'
import { stopVoiceStream } from '@/lib/voice/voiceStream'
import { supabase } from '../../lib/supabase'
import { loadChallengeXpByUser } from '@/lib/user-challenges'
import { getLevelFromXP } from '../../lib/xp'
import type { User } from '@supabase/supabase-js'

type Profile = {
  id: string
  email: string | null
  name: string | null
  nickname: string | null
  avatar_url: string | null
}

type ProfileFormState = {
  name: string
  nickname: string
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

type StravaDisconnectResponse =
  | {
      ok: true
    }
  | {
      ok: false
      step?: string
      error?: string
    }

type StravaSyncResponse =
  | {
      ok: true
      imported: number
      skipped: number
      failed: number
      totalRunsFetched: number
    }
  | {
      ok: false
      step?: 'auth_required' | 'missing_connection' | 'reconnect_required' | 'initial_sync_failed'
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
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState('')
  const [initialProfileForm, setInitialProfileForm] = useState<ProfileFormState | null>(null)
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [totalXp, setTotalXp] = useState(0)
  const [totalKm, setTotalKm] = useState(0)
  const [runsCount, setRunsCount] = useState(0)
  const [stravaConnectionState, setStravaConnectionState] = useState<'connected' | 'reconnect_required' | 'disconnected'>('disconnected')
  const [loadingStravaStatus, setLoadingStravaStatus] = useState(true)
  const [syncingStrava, setSyncingStrava] = useState(false)
  const [disconnectingStrava, setDisconnectingStrava] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [stravaSyncMessage, setStravaSyncMessage] = useState('')
  const [profileDataLoading, setProfileDataLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [showStravaConnectedToast, setShowStravaConnectedToast] = useState(false)
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
      }

      try {
        await ensureProfileExists(currentUser)
      } catch {
        if (isMounted) {
          setPageError('Не удалось загрузить профиль')
        }
      }

      const [
        { data: profileData, error: profileError },
        { data: runs, error: runsError },
        challengeXpByUser,
        likeXpByUser,
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('*')
          .eq('id', currentUser.id)
          .maybeSingle(),
        supabase
          .from('runs')
          .select('xp, distance_km')
          .eq('user_id', currentUser.id),
        loadChallengeXpByUser(),
        loadLikeXpByUser(),
      ])

      if (!isMounted) return

      if (profileError || runsError) {
        setPageError('Не удалось загрузить профиль')
      }

      const nextProfile = profileData
        ? {
            id: profileData.id,
            email: profileData.email ?? currentUser.email ?? '',
            name: profileData.name ?? '',
            nickname: profileData.nickname ?? '',
            avatar_url: profileData.avatar_url ?? null,
          }
        : profileFallback

      const safeRuns = runs ?? []

      setProfile(nextProfile)
      setName(nextProfile.name ?? '')
      setNickname(nextProfile.nickname ?? '')
      setInitialProfileForm({
        name: nextProfile.name ?? '',
        nickname: nextProfile.nickname ?? '',
      })
      setEmail(nextProfile.email ?? currentUser.email ?? '')
      setTotalXp(
        safeRuns.reduce((sum, run) => sum + Number(run.xp ?? 0), 0) +
        (challengeXpByUser[currentUser.id] ?? 0) +
        (likeXpByUser[currentUser.id] ?? 0)
      )
      setTotalKm(safeRuns.reduce((sum, run) => sum + Number(run.distance_km ?? 0), 0))
      setRunsCount(safeRuns.length)
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
        setEmail(nextUser?.email ?? '')

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
    return () => {
      if (cropImageSrc) {
        URL.revokeObjectURL(cropImageSrc)
      }
    }
  }, [cropImageSrc])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user || saving || profileDataLoading || !initialProfileForm) return

    const nextName = name.trim()
    const nextNickname = nickname.trim()

    setSaving(true)
    setPageError('')
    setSaveMessage('')

    try {
      const payload = {
        id: user.id,
        email: user.email ?? email,
        name: nextName || null,
        nickname: nextNickname || null,
        avatar_url: profile?.avatar_url ?? null,
      }

      const { error, data } = await updateProfileById({
        id: user.id,
        name: nextName || null,
        nickname: nextNickname || null,
        avatar_url: profile?.avatar_url ?? null,
      })

      if (error || !data) {
        console.error('[profile] save update failed', {
          authUserId: user.id,
          error,
          data,
        })
        setPageError('Не удалось сохранить профиль')
        return
      }

      const { data: freshProfile, error: freshProfileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      if (freshProfileError) {
        setPageError('Не удалось сохранить профиль')
        return
      }

      const nextProfile = freshProfile
        ? {
            id: freshProfile.id,
            email: freshProfile.email ?? user.email ?? email,
            name: freshProfile.name ?? '',
            nickname: freshProfile.nickname ?? '',
            avatar_url: freshProfile.avatar_url ?? null,
          }
        : {
            id: user.id,
            email: user.email ?? email,
            name: nextName,
            nickname: nextNickname,
            avatar_url: profile?.avatar_url ?? null,
          }

      setProfile(nextProfile)
      setName(nextProfile.name ?? '')
      setNickname(nextProfile.nickname ?? '')
      setInitialProfileForm({
        name: nextProfile.name ?? '',
        nickname: nextProfile.nickname ?? '',
      })
      setEmail(nextProfile.email ?? user.email ?? '')
      setSaveMessage('Профиль сохранен')
    } catch {
      setPageError('Не удалось сохранить профиль')
    } finally {
      setSaving(false)
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    if (!user || changingPassword) return

    const trimmedPassword = newPassword.trim()
    const trimmedConfirmPassword = confirmPassword.trim()

    setPageError('')
    setPasswordMessage('')

    if (!trimmedPassword) {
      setPageError('Введите новый пароль')
      return
    }

    if (trimmedPassword.length < 6) {
      setPageError('Пароль должен быть не короче 6 символов')
      return
    }

    if (trimmedPassword !== trimmedConfirmPassword) {
      setPageError('Пароли не совпадают')
      return
    }

    setChangingPassword(true)

    try {
      const { error } = await supabase.auth.updateUser({
        password: trimmedPassword,
      })

      if (error) {
        setPageError('Не удалось изменить пароль')
        return
      }

      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage('Пароль обновлен')
    } catch {
      setPageError('Не удалось изменить пароль')
    } finally {
      setChangingPassword(false)
    }
  }

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
    const nextName = profile?.name ?? (name.trim() || null)
    const nextNickname = profile?.nickname ?? (nickname.trim() || null)

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
        email: prev?.email ?? user.email ?? email,
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

  function handleConnectStrava() {
    window.location.href = '/api/strava/connect'
  }

  async function handleDisconnectStrava() {
    if (disconnectingStrava) return

    const confirmed = window.confirm('Отключить Strava?')

    if (!confirmed) {
      return
    }

    setDisconnectingStrava(true)
    setPageError('')
    setStravaSyncMessage('')

    try {
      const response = await fetch('/api/strava/disconnect', {
        method: 'DELETE',
        cache: 'no-store',
        credentials: 'include',
      })

      const payload = (await response.json()) as StravaDisconnectResponse

      if (!response.ok || !payload.ok) {
        setPageError('Не удалось отключить Strava')
        return
      }

      setStravaConnectionState('disconnected')
      setStravaSyncMessage('Strava отключена')
    } catch {
      setPageError('Не удалось отключить Strava')
    } finally {
      setDisconnectingStrava(false)
    }
  }

  async function handleSyncStrava() {
    if (syncingStrava) return

    setSyncingStrava(true)
    setStravaSyncMessage('')
    setPageError('')

    try {
      const response = await fetch('/api/strava/sync', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'include',
      })

      const payload = (await response.json()) as StravaSyncResponse

      if (!response.ok || !payload.ok) {
        if (!payload.ok && payload.step === 'reconnect_required') {
          setStravaConnectionState('reconnect_required')
          setPageError('Сессия Strava истекла. Переподключите Strava.')
          return
        }

        setStravaSyncMessage('Не удалось синхронизировать Strava. Попробуйте снова.')
        setPageError('')
        return
      }

      if (payload.imported > 0 && payload.failed > 0) {
        setStravaSyncMessage(`Импортировано ${payload.imported} тренировок. ${payload.failed} не удалось загрузить.`)
      } else if (payload.imported > 0) {
        setStravaSyncMessage(`Импортировано ${payload.imported} тренировок из Strava.`)
      } else if (payload.totalRunsFetched > 0) {
        setStravaSyncMessage('Новых пробежек не найдено.')
      } else {
        setStravaSyncMessage('Новых пробежек не найдено.')
      }

      setStravaConnectionState('connected')
      if (user) {
        await Promise.all([
          loadProfileData(user, { showLoading: false }),
          loadStravaStatus(),
        ])
      }
      if (payload.imported > 0) {
        dispatchRunsUpdatedEvent()
      }
    } catch {
      setStravaSyncMessage('Не удалось синхронизировать Strava. Попробуйте снова.')
      setPageError('')
    } finally {
      setSyncingStrava(false)
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
    setStravaSyncMessage('')
    setStravaConnectionState('disconnected')
    stopVoiceStream()

    try {
      const { error } = await supabase.auth.signOut()

      if (error) {
        setPageError('Не удалось выйти из аккаунта')
        return
      }

      router.replace('/login')
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
      email: user.email ?? email ?? null,
    },
    'Бегун'
  )
  const currentLevel = getLevelFromXP(totalXp).level
  const hasProfileChanges = initialProfileForm !== null && (
    name.trim() !== initialProfileForm.name.trim() ||
    nickname.trim() !== initialProfileForm.nickname.trim()
  )
  const isSaveDisabled = profileDataLoading || saving || !hasProfileChanges
  const trimmedNewPassword = newPassword.trim()
  const trimmedConfirmPassword = confirmPassword.trim()
  const isPasswordFormValid =
    trimmedNewPassword.length >= 6 &&
    trimmedConfirmPassword.length >= 6 &&
    trimmedNewPassword === trimmedConfirmPassword
  const isChangePasswordDisabled = changingPassword || !isPasswordFormValid
  const stravaConnected = stravaConnectionState === 'connected'
  const stravaReconnectRequired = stravaConnectionState === 'reconnect_required'

  if (profileDataLoading) {
    return (
      <main className="min-h-screen pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
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
          <div className="app-card mb-8 space-y-3 rounded-2xl border p-4 shadow-sm">
            <div>
              <div className="skeleton-line h-4 w-16" />
              <div className="mt-2 skeleton-line h-11 w-full" />
            </div>
            <div>
              <div className="skeleton-line h-4 w-28" />
              <div className="mt-2 skeleton-line h-11 w-full" />
            </div>
            <div>
              <div className="skeleton-line h-4 w-24" />
              <div className="mt-2 skeleton-line h-11 w-full" />
            </div>
            <div className="skeleton-line h-11 w-full sm:w-28" />
          </div>
          <div className="app-card mb-8 space-y-3 rounded-2xl border p-4 shadow-sm">
            <div className="skeleton-line h-6 w-36" />
            <div>
              <div className="skeleton-line h-4 w-28" />
              <div className="mt-2 skeleton-line h-11 w-full" />
            </div>
            <div>
              <div className="skeleton-line h-4 w-36" />
              <div className="mt-2 skeleton-line h-11 w-full" />
            </div>
            <div className="skeleton-line h-11 w-full sm:w-40" />
          </div>
          <div className="app-card overflow-hidden rounded-2xl border p-4 shadow-sm">
            <div className="skeleton-line h-6 w-28" />
            <div className="mt-4 space-y-3">
              <div className="skeleton-line h-6 w-full" />
              <div className="skeleton-line h-6 w-full" />
              <div className="skeleton-line h-6 w-full" />
              <div className="skeleton-line h-6 w-full" />
              <div className="skeleton-line h-6 w-full" />
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
      <h1 className="app-text-primary mb-4 text-2xl font-bold">Профиль</h1>
      {pageError ? <p className="mb-4 text-sm text-red-600">{pageError}</p> : null}
      {saveMessage ? <p className="mb-4 text-sm text-green-700">{saveMessage}</p> : null}
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
        <UserIdentitySummary
          loadingIdentity={false}
          loadingLevel={false}
          displayName={profileDisplayName}
          levelLabel={`Уровень ${currentLevel}`}
          className="w-full text-center"
        />
      </div>
      <>
          <form onSubmit={handleSave} className="app-card mb-8 space-y-3 rounded-2xl border p-4 shadow-sm">
            <div>
              <label htmlFor="name" className="app-text-secondary block text-sm mb-1">Имя</label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setSaveMessage('')
                }}
                disabled={saving}
                className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="nickname" className="app-text-secondary block text-sm mb-1">Никнейм для профиля</label>
              <input
                id="nickname"
                type="text"
                value={nickname}
                onChange={(e) => {
                  setNickname(e.target.value)
                  setSaveMessage('')
                }}
                disabled={saving}
                className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="email" className="app-text-secondary block text-sm mb-1">Email для входа</label>
              <input
                id="email"
                type="email"
                value={email}
                readOnly
                className="app-input app-input-readonly min-h-11 w-full rounded-lg border px-3 py-2"
              />
            </div>
            <button
              type="submit"
              disabled={isSaveDisabled}
              className="app-button-secondary min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {saving ? 'Сохраняем...' : 'Сохранить'}
            </button>
          </form>
          <form onSubmit={handlePasswordChange} className="app-card mb-8 space-y-3 rounded-2xl border p-4 shadow-sm">
            <div>
              <h2 className="app-text-primary text-lg font-semibold">Смена пароля</h2>
            </div>
            {passwordMessage ? <p className="text-sm text-green-700">{passwordMessage}</p> : null}
            <div>
              <label htmlFor="new-password" className="app-text-secondary block text-sm mb-1">Новый пароль</label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={changingPassword}
                  className="app-input min-h-11 w-full rounded-lg border px-3 py-2 pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((prev) => !prev)}
                  className="app-text-secondary absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center"
                  aria-label={showNewPassword ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="confirm-password" className="app-text-secondary block text-sm mb-1">Подтвердите пароль</label>
              <div className="relative">
                <input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={changingPassword}
                  className="app-input min-h-11 w-full rounded-lg border px-3 py-2 pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  className="app-text-secondary absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center"
                  aria-label={showConfirmPassword ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={isChangePasswordDisabled}
              className="app-button-secondary min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {changingPassword ? 'Обновляем пароль...' : 'Изменить пароль'}
            </button>
          </form>
          <div className="app-card mb-8 space-y-3 rounded-2xl border p-4 shadow-sm">
            <h2 className="app-text-primary text-lg font-semibold">Strava</h2>
            {loadingStravaStatus ? (
              <p className="app-text-secondary text-sm">Проверяем подключение...</p>
            ) : stravaConnected ? (
              <>
                <div className="flex items-start gap-2">
                  <div className="pt-0.5">
                    <StravaIcon />
                  </div>
                  <div className="min-w-0">
                    <p className="app-text-primary text-sm font-medium">Strava подключена</p>
                    <p className="app-text-secondary mt-0.5 text-xs">
                      Автоматическая синхронизация активна
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDisconnectStrava}
                  disabled={disconnectingStrava}
                  className="app-button-secondary min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {disconnectingStrava ? 'Отключаем...' : 'Отключить Strava'}
                </button>
              </>
            ) : stravaReconnectRequired ? (
              <>
                <div className="flex items-start gap-2">
                  <div className="pt-0.5">
                    <StravaIcon />
                  </div>
                  <div className="min-w-0">
                    <p className="app-text-primary text-sm font-medium">Требуется переподключение Strava</p>
                    <p className="app-text-secondary mt-0.5 text-xs">
                      Сессия истекла или недействительна
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleConnectStrava}
                  className="app-button-primary min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-medium sm:w-auto"
                >
                  Переподключить Strava
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleConnectStrava}
                className="app-button-primary min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-medium sm:w-auto"
              >
                Подключить Strava
              </button>
            )}
            <button
              type="button"
              onClick={handleSyncStrava}
              disabled={syncingStrava || disconnectingStrava || loadingStravaStatus || !stravaConnected}
              className="app-button-secondary min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {syncingStrava ? 'Синхронизация...' : 'Синхронизировать Strava'}
            </button>
            {stravaSyncMessage ? <p className="app-text-secondary text-sm">{stravaSyncMessage}</p> : null}
          </div>
          <div className="app-card mt-6 overflow-hidden rounded-2xl border p-4 shadow-sm">
            <h2 className="app-text-primary mb-4 text-xl font-semibold">Статистика</h2>
            <div className="flex items-center justify-between gap-4 border-b py-2">
              <span className="app-text-secondary min-w-0">Уровень</span>
              <span className="app-text-primary shrink-0 text-right font-semibold">{getLevelFromXP(totalXp).level}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-b py-2">
              <span className="app-text-secondary min-w-0">Всего XP</span>
              <span className="app-text-primary shrink-0 text-right font-semibold">{totalXp}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-b py-2">
              <span className="app-text-secondary min-w-0">Следующий уровень</span>
              <span className="app-text-primary shrink-0 text-right font-semibold">{getLevelFromXP(totalXp).nextLevelXP ?? 'Максимум'}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-b py-2">
              <span className="app-text-secondary min-w-0">Всего км</span>
              <span className="app-text-primary shrink-0 text-right font-semibold">{formatDistanceKm(totalKm)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 py-2">
              <span className="app-text-secondary min-w-0">Тренировки</span>
              <span className="app-text-primary shrink-0 text-right font-semibold">{runsCount}</span>
            </div>
          </div>
          <div className="mb-8 mt-6">
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="app-button-secondary min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loggingOut ? 'Выходим...' : 'Выйти'}
            </button>
          </div>
      </>
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
      </div>
    </main>
  )
}
