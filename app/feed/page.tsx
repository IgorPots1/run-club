'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { getLevelFromXP } from '../../lib/xp'

type RunWithProfile = {
  run_id: string
  user_id: string
  title: string
  distance_km: number
  xp: number
  created_at: string
  displayName: string
  avatar_url: string | null
  totalXp: number
}

export default function FeedPage() {
  const [items, setItems] = useState<RunWithProfile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: runs } = await supabase
        .from('runs')
        .select('id, user_id, title, distance_km, xp, created_at')
        .order('created_at', { ascending: false })
      const { data: profiles } = await supabase.from('profiles').select('id, name, email, avatar_url')
      const profileById = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]))
      const totalXpByUser: Record<string, number> = {}
      for (const run of runs ?? []) {
        totalXpByUser[run.user_id] = (totalXpByUser[run.user_id] ?? 0) + run.xp
      }
      const list = (runs ?? []).map((run) => {
        const p = profileById[run.user_id]
        const displayName = p?.name?.trim() || p?.email || '—'
        const avatar_url = p?.avatar_url ?? null
        const totalXp = totalXpByUser[run.user_id] ?? 0
        return {
          run_id: run.id,
          user_id: run.user_id,
          title: run.title || 'Тренировка',
          distance_km: run.distance_km,
          xp: run.xp,
          created_at: run.created_at,
          displayName,
          avatar_url,
          totalXp
        }
      })
      setItems(list)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <main className="min-h-screen p-4">Загрузка...</main>

  return (
    <main className="min-h-screen">
      <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Лента</h1>
      <div className="max-w-md">
        {items.map((item) => (
          <div key={item.run_id} className="border rounded-lg p-4 mb-3">
            <p className="font-medium">{item.title}</p>
            <p className="text-sm text-gray-600 mt-1">
              {item.displayName} · Уровень {getLevelFromXP(item.totalXp).level}
            </p>
            <p className="text-sm mt-1">🏃 {item.distance_km} км</p>
            <p className="text-sm mt-1">+{item.xp} XP</p>
            <p className="text-sm text-gray-500 mt-1">
              {new Date(item.created_at).toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long'
              })}
            </p>
          </div>
        ))}
      </div>
      </div>
    </main>
  )
}
