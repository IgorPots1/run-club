'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import type { User } from '@supabase/supabase-js'

type RunItem = {
  id: string
  user_id: string
  title: string
  distance_km: number
  xp: number
  created_at: string
  displayName: string
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [runs, setRuns] = useState<RunItem[]>([])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setLoading(false)
      if (!user) router.push('/login')
    })
  }, [router])

  useEffect(() => {
    async function loadRuns() {
      const { data: runs } = await supabase
        .from('runs')
        .select('id, user_id, title, distance_km, xp, created_at')
        .order('created_at', { ascending: false })
      const { data: profiles } = await supabase.from('profiles').select('id, name, email, avatar_url')
      const profileById = Object.fromEntries((profiles ?? []).map((profile) => [profile.id, profile]))
      const items = (runs ?? []).map((run) => {
        const profile = profileById[run.user_id]
        return {
          id: run.id,
          user_id: run.user_id,
          title: run.title || 'Тренировка',
          distance_km: run.distance_km,
          xp: run.xp,
          created_at: run.created_at,
          displayName: profile?.name?.trim() || profile?.email || '—'
        }
      })
      setRuns(items)
    }

    loadRuns()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) return <main className="min-h-screen flex items-center justify-center p-4">Загрузка...</main>
  if (!user) return null

  return (
    <main className="min-h-screen">
      <div className="p-4">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold mb-4">Главная</h1>
            <p className="text-sm text-gray-600">{user.email}</p>
          </div>
          <button onClick={handleLogout} className="border rounded px-3 py-2">
            Выйти
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/runs" className="border rounded p-4">
            <h2 className="font-medium">Тренировки</h2>
          </Link>
          <Link href="/leaderboard" className="border rounded p-4">
            <h2 className="font-medium">Рейтинг</h2>
          </Link>
          <Link href="/feed" className="border rounded p-4">
            <h2 className="font-medium">Лента</h2>
          </Link>
          <Link href="/profile" className="border rounded p-4">
            <h2 className="font-medium">Профиль</h2>
          </Link>
          <Link href="/challenges" className="border rounded p-4 sm:col-span-2">
            <h2 className="font-medium">Челленджи</h2>
          </Link>
        </div>

        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-3">Последние тренировки</h2>
          <div>
            {runs.length === 0 ? (
              <p className="text-sm text-gray-600">Пока нет тренировок</p>
            ) : (
              runs.map((run) => (
                <div key={run.id} className="border rounded-lg p-4 mb-3">
                  <p className="font-medium">{run.title}</p>
                  <p className="text-sm text-gray-600 mt-1">{run.displayName}</p>
                  <p className="text-sm mt-1">🏃 {run.distance_km} км</p>
                  <p className="text-sm mt-1">+{run.xp} XP</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {new Date(run.created_at).toLocaleDateString('ru-RU', {
                      day: 'numeric',
                      month: 'long'
                    })}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
