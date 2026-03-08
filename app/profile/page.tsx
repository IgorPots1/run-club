'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import AvatarCropModal from '@/components/AvatarCropModal'
import { loadLikeXpByUser } from '@/lib/likes-xp'
import { supabase } from '../../lib/supabase'
import { loadChallengeXpByUser } from '@/lib/user-challenges'
import { getLevelFromXP } from '../../lib/xp'
import type { User } from '@supabase/supabase-js'

type Profile = {
  id: string
  email: string | null
  name: string | null
  avatar_url: string | null
}

export default function ProfilePage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const [totalXp, setTotalXp] = useState(0)
  const [totalKm, setTotalKm] = useState(0)
  const [runsCount, setRunsCount] = useState(0)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setEmail(user?.email ?? '')
      setLoading(false)
      if (!user) router.push('/login')
    })
  }, [router])

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('id, email, name, avatar_url')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setProfile(data)
          setName(data.name ?? '')
          setEmail(data.email ?? user?.email ?? '')
        }
      })
    supabase
      .from('runs')
      .select('xp, distance_km')
      .eq('user_id', user.id)
      .then(async ({ data: runs }) => {
        if (!runs) return
        const challengeXpByUser = await loadChallengeXpByUser()
        const likeXpByUser = await loadLikeXpByUser()
        setTotalXp(
          runs.reduce((s, r) => s + r.xp, 0) +
          (challengeXpByUser[user.id] ?? 0) +
          (likeXpByUser[user.id] ?? 0)
        )
        setTotalKm(runs.reduce((s, r) => s + r.distance_km, 0))
        setRunsCount(runs.length)
      })
  }, [user])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setSaving(true)
    await supabase.from('profiles').update({ name }).eq('id', user.id)
    setSaving(false)
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (cropImageSrc) {
      URL.revokeObjectURL(cropImageSrc)
    }

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
    if (!user) return

    setUploading(true)

    try {
      const path = `${user.id}/avatar-${Date.now()}.png`
      await supabase.storage.from('avatars').upload(path, blob, {
        contentType: 'image/png',
      })

      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      await supabase.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', user.id)
      setProfile((prev) => (prev ? { ...prev, avatar_url: data.publicUrl } : null))
      closeCropModal()
    } finally {
      setUploading(false)
    }
  }

  if (loading) return <main className="min-h-screen flex items-center justify-center p-4">Загрузка...</main>
  if (!user) return null

  return (
    <main className="min-h-screen">
      <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Профиль</h1>
      <div className="mb-6 flex flex-col items-center gap-4">
        {profile?.avatar_url ? (
          <Image
            src={profile.avatar_url}
            alt="Аватар"
            width={128}
            height={128}
            className="h-32 w-32 rounded-full object-cover"
          />
        ) : (
          <div className="w-32 h-32 rounded-full bg-gray-100 border flex items-center justify-center text-sm text-gray-500">
            Аватар
          </div>
        )}
        <label
          htmlFor="avatar-upload"
          className={`inline-flex cursor-pointer items-center justify-center rounded-lg border px-4 py-2 text-sm ${
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
      </div>
      <form onSubmit={handleSave} className="mb-8 space-y-3 max-w-sm">
        <div>
          <label htmlFor="name" className="block text-sm mb-1">Имя</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm mb-1">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            readOnly
            className="w-full border rounded px-3 py-2 bg-gray-100"
          />
        </div>
        <button type="submit" disabled={saving} className="border rounded px-3 py-2">
          {saving ? '...' : 'Сохранить'}
        </button>
      </form>
      <div className="border rounded-xl p-4 mt-6 max-w-sm">
        <h2 className="text-xl font-semibold mb-4">Статистика</h2>
        <div className="flex justify-between items-center py-2 border-b">
          <span className="text-gray-500">Уровень</span>
          <span className="font-semibold">{getLevelFromXP(totalXp).level}</span>
        </div>
        <div className="flex justify-between items-center py-2 border-b">
          <span className="text-gray-500">Всего XP</span>
          <span className="font-semibold">{totalXp}</span>
        </div>
        <div className="flex justify-between items-center py-2 border-b">
          <span className="text-gray-500">Следующий уровень</span>
          <span className="font-semibold">{getLevelFromXP(totalXp).nextLevelXP ?? 'Максимум'}</span>
        </div>
        <div className="flex justify-between items-center py-2 border-b">
          <span className="text-gray-500">Всего км</span>
          <span className="font-semibold">{totalKm.toFixed(2)}</span>
        </div>
        <div className="flex justify-between items-center py-2">
          <span className="text-gray-500">Тренировки</span>
          <span className="font-semibold">{runsCount}</span>
        </div>
      </div>
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
