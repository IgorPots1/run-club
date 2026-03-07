'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
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
  const [totalXp, setTotalXp] = useState(0)
  const [totalKm, setTotalKm] = useState(0)
  const [runsCount, setRunsCount] = useState(0)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setLoading(false)
      if (!user) router.push('/login')
    })
  }, [router])

  useEffect(() => {
    if (!user) return
    setEmail(user.email ?? '')
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
      .then(({ data: runs }) => {
        if (!runs) return
        setTotalXp(runs.reduce((s, r) => s + r.xp, 0))
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
    if (!file || !user) return
    setUploading(true)
    const path = `${user.id}/avatar-${Date.now()}`
    await supabase.storage.from('avatars').upload(path, file)
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    await supabase.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', user.id)
    setProfile((prev) => (prev ? { ...prev, avatar_url: data.publicUrl } : null))
    setUploading(false)
    e.target.value = ''
  }

  if (loading) return <main className="min-h-screen flex items-center justify-center p-4">Loading...</main>
  if (!user) return null

  return (
    <main className="min-h-screen p-4">
      <h1 className="text-xl font-semibold mb-4">Profile</h1>
      {profile?.avatar_url && (
        <img src={profile.avatar_url} alt="Avatar" className="w-20 h-20 rounded-full object-cover mb-4" />
      )}
      <div className="mb-4">
        <label className="block text-sm mb-1">Avatar</label>
        <input type="file" accept="image/*" onChange={handleAvatarChange} disabled={uploading} className="block" />
      </div>
      <form onSubmit={handleSave} className="mb-8 space-y-3 max-w-sm">
        <div>
          <label htmlFor="name" className="block text-sm mb-1">Name</label>
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
          {saving ? '...' : 'Save'}
        </button>
      </form>
      <div className="border rounded p-4 max-w-sm">
        <h2 className="font-semibold mb-2">Stats</h2>
        <p>Total XP: {totalXp}</p>
        <p>Total KM: {totalKm.toFixed(2)}</p>
        <p>Runs: {runsCount}</p>
      </div>
    </main>
  )
}
