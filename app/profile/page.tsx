'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { getBootstrapUser } from '@/lib/auth'
import AvatarCropModal from '@/components/AvatarCropModal'
import UserIdentitySummary from '@/components/UserIdentitySummary'
import { formatDistanceKm } from '@/lib/format'
import { loadLikeXpByUser } from '@/lib/likes-xp'
import { ensureProfileExists, getProfileDisplayName, upsertProfile } from '@/lib/profiles'
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

export default function ProfilePage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const [totalXp, setTotalXp] = useState(0)
  const [totalKm, setTotalKm] = useState(0)
  const [runsCount, setRunsCount] = useState(0)
  const [profileDataLoading, setProfileDataLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadUser() {
      try {
        if (!isMounted) return

        const nextUser = await getBootstrapUser()
        setUser(nextUser)
        setEmail(nextUser?.email ?? '')

        if (nextUser) {
          void ensureProfileExists(nextUser)
        }

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

    async function loadProfileData() {
      setPageError('')
      setProfileDataLoading(true)

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

        console.log('[profile] load', {
          authUserId: currentUser.id,
          profileData,
          profileError,
        })

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
        if (isMounted) {
          setProfileDataLoading(false)
        }
      }
    }

    void loadProfileData()

    return () => {
      isMounted = false
    }
  }, [user])

  useEffect(() => {
    return () => {
      if (cropImageSrc) {
        URL.revokeObjectURL(cropImageSrc)
      }
    }
  }, [cropImageSrc])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user || saving) return

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

      console.log('[profile] save start', {
        authUserId: user.id,
        payload,
      })

      const { error } = await upsertProfile(payload)

      console.log('[profile] save upsert result', {
        authUserId: user.id,
        error,
      })

      if (error) {
        setPageError('Не удалось сохранить профиль')
        return
      }

      const { data: freshProfile, error: freshProfileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      console.log('[profile] save reload result', {
        authUserId: user.id,
        freshProfile,
        freshProfileError,
      })

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
      setEmail(nextProfile.email ?? user.email ?? '')
      setSaveMessage('Профиль сохранен')
    } catch {
      setPageError('Не удалось сохранить профиль')
    } finally {
      setSaving(false)
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
      const { error: profileError } = await upsertProfile({
        id: user.id,
        email: user.email ?? email,
        name: nextName,
        nickname: nextNickname,
        avatar_url: data.publicUrl,
      })

      if (profileError) {
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

  if (loading) return <main className="min-h-screen flex items-center justify-center p-4">Загрузка...</main>
  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
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
  const profileIdentityLoading = profileDataLoading && !pageError
  const profileLevelLoading = profileDataLoading && !pageError

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-xl p-4">
      <h1 className="app-text-primary mb-4 text-2xl font-bold">Профиль</h1>
      {pageError ? <p className="mb-4 text-sm text-red-600">{pageError}</p> : null}
      {saveMessage ? <p className="mb-4 text-sm text-green-700">{saveMessage}</p> : null}
      <div className="mb-6 flex flex-col items-center gap-4">
        {profile?.avatar_url ? (
          <Image
            src={profile.avatar_url}
            alt="Аватар"
            width={112}
            height={112}
            className="h-28 w-28 rounded-full object-cover sm:h-32 sm:w-32"
          />
        ) : (
          <div className="app-card app-text-secondary flex h-28 w-28 items-center justify-center rounded-full border text-sm sm:h-32 sm:w-32">
            Аватар
          </div>
        )}
        <label
          htmlFor="avatar-upload"
          className={`app-button-secondary inline-flex min-h-11 w-full max-w-sm cursor-pointer items-center justify-center rounded-lg border px-4 py-2 text-sm ${
            uploading ? 'pointer-events-none opacity-60' : ''
          }`}
        >
          {uploading ? 'Загрузка...' : profile?.avatar_url ? 'Изменить аватар' : 'Загрузить аватар'}
        </label>
        <input
          id="avatar-upload"
          type="file"
          accept="image/*"
          onChange={handleAvatarChange}
          disabled={uploading}
          className="hidden"
        />
        <UserIdentitySummary
          loadingIdentity={profileIdentityLoading}
          loadingLevel={profileLevelLoading}
          displayName={profileDisplayName}
          levelLabel={`Уровень ${currentLevel}`}
          email={profileIdentityLoading ? null : email}
          className="w-full text-center"
        />
      </div>
      {profileDataLoading ? (
        <>
          <div className="app-card mb-8 space-y-3 rounded-2xl border p-4 shadow-sm">
            <div>
              <div className="skeleton-line h-4 w-16" />
              <div className="mt-2 skeleton-line h-11 w-full" />
            </div>
            <div>
              <div className="skeleton-line h-4 w-20" />
              <div className="mt-2 skeleton-line h-11 w-full" />
            </div>
            <div>
              <div className="skeleton-line h-4 w-16" />
              <div className="mt-2 skeleton-line h-11 w-full" />
            </div>
            <div className="skeleton-line h-11 w-28" />
          </div>
          <div className="app-card mt-6 overflow-hidden rounded-xl border p-4 shadow-sm">
            <div className="skeleton-line h-6 w-28" />
            <div className="mt-4 space-y-3">
              <div className="skeleton-line h-6 w-full" />
              <div className="skeleton-line h-6 w-full" />
              <div className="skeleton-line h-6 w-full" />
              <div className="skeleton-line h-6 w-full" />
              <div className="skeleton-line h-6 w-full" />
            </div>
          </div>
        </>
      ) : (
        <>
          <form onSubmit={handleSave} className="app-card mb-8 space-y-3 rounded-2xl border p-4 shadow-sm">
            <div>
              <label htmlFor="name" className="app-text-secondary block text-sm mb-1">Имя</label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
                className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="nickname" className="app-text-secondary block text-sm mb-1">Никнейм</label>
              <input
                id="nickname"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                disabled={saving}
                className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="email" className="app-text-secondary block text-sm mb-1">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                readOnly
                className="app-input app-input-readonly min-h-11 w-full rounded-lg border px-3 py-2"
              />
            </div>
            <button type="submit" disabled={saving} className="app-button-secondary min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-medium sm:w-auto">
              {saving ? '...' : 'Сохранить'}
            </button>
          </form>
          <div className="app-card mt-6 overflow-hidden rounded-xl border p-4 shadow-sm">
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
        </>
      )}
      {cropImageSrc ? (
        <AvatarCropModal
          imageSrc={cropImageSrc}
          loading={uploading}
          onCancel={closeCropModal}
          onConfirm={handleAvatarCropped}
        />
      ) : null}
      </div>
    </main>
  )
}
