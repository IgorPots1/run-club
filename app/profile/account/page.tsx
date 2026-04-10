'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { getBootstrapUser } from '@/lib/auth'
import { updateProfileById } from '@/lib/profiles'
import { supabase } from '@/lib/supabase'

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

export default function AccountPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState('')
  const [initialProfileForm, setInitialProfileForm] = useState<ProfileFormState | null>(null)
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [profileDataLoading, setProfileDataLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')

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
          }
        : profileFallback

      setProfile(nextProfile)
      setName(nextProfile.name ?? '')
      setNickname(nextProfile.nickname ?? '')
      setInitialProfileForm({
        name: nextProfile.name ?? '',
        nickname: nextProfile.nickname ?? '',
      })
      setEmail(nextProfile.email ?? currentUser.email ?? '')
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

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || saving || profileDataLoading || !initialProfileForm) return

    const nextName = name.trim()
    const nextNickname = nickname.trim()

    setSaving(true)
    setPageError('')
    setSaveMessage('')

    try {
      const { error, data } = await updateProfileById({
        id: user.id,
        name: nextName || null,
        nickname: nextNickname || null,
        avatar_url: profile?.avatar_url ?? null,
      })

      if (error || !data) {
        console.error('[profile/account] save update failed', {
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

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        Загрузка...
      </main>
    )
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

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

  if (profileDataLoading) {
    return (
      <main className="min-h-screen pt-[env(safe-area-inset-top)] md:pt-0">
        <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
          <Link href="/profile" className="app-text-secondary mb-4 inline-flex text-sm underline">
            Назад в профиль
          </Link>
          <h1 className="app-text-primary mb-4 text-2xl font-bold">Аккаунт</h1>
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
          <div className="app-card space-y-3 rounded-2xl border p-4 shadow-sm">
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
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen pt-[env(safe-area-inset-top)] md:pt-0">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <Link href="/profile" className="app-text-secondary mb-4 inline-flex text-sm underline">
          Назад в профиль
        </Link>
        <h1 className="app-text-primary mb-2 text-2xl font-bold">Аккаунт</h1>
        <p className="app-text-secondary mb-4 text-sm">
          Измените имя, никнейм и пароль для входа.
        </p>
        {pageError ? <p className="mb-4 text-sm text-red-600">{pageError}</p> : null}
        {saveMessage ? <p className="mb-4 text-sm text-green-700">{saveMessage}</p> : null}

        <form onSubmit={handleSave} className="app-card mb-8 space-y-3 rounded-2xl border p-4 shadow-sm">
          <div>
            <label htmlFor="name" className="app-text-secondary mb-1 block text-sm">Имя</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setSaveMessage('')
              }}
              disabled={saving}
              className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="nickname" className="app-text-secondary mb-1 block text-sm">Никнейм для профиля</label>
            <input
              id="nickname"
              type="text"
              value={nickname}
              onChange={(event) => {
                setNickname(event.target.value)
                setSaveMessage('')
              }}
              disabled={saving}
              className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="email" className="app-text-secondary mb-1 block text-sm">Email для входа</label>
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

        <form onSubmit={handlePasswordChange} className="app-card space-y-3 rounded-2xl border p-4 shadow-sm">
          <div>
            <h2 className="app-text-primary text-lg font-semibold">Смена пароля</h2>
          </div>
          {passwordMessage ? <p className="text-sm text-green-700">{passwordMessage}</p> : null}
          <div>
            <label htmlFor="new-password" className="app-text-secondary mb-1 block text-sm">Новый пароль</label>
            <div className="relative">
              <input
                id="new-password"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                disabled={changingPassword}
                className="app-input min-h-11 w-full rounded-lg border px-3 py-2 pr-11"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword((previous) => !previous)}
                className="app-text-secondary absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center"
                aria-label={showNewPassword ? 'Скрыть пароль' : 'Показать пароль'}
              >
                {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="confirm-password" className="app-text-secondary mb-1 block text-sm">Подтвердите пароль</label>
            <div className="relative">
              <input
                id="confirm-password"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={changingPassword}
                className="app-input min-h-11 w-full rounded-lg border px-3 py-2 pr-11"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((previous) => !previous)}
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
      </div>
    </main>
  )
}
