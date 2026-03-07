'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

type RunWithProfile = {
  run_id: string
  user_id: string
  distance_km: number
  xp: number
  created_at: string
  displayName: string
  avatar_url: string | null
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr).getTime()
  const now = Date.now()
  const diff = Math.floor((now - d) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`
  if (diff < 2592000) return `${Math.floor(diff / 86400)} days ago`
  return new Date(dateStr).toLocaleDateString()
}

export default function FeedPage() {
  const [items, setItems] = useState<RunWithProfile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: runs } = await supabase
        .from('runs')
        .select('id, user_id, distance_km, xp, created_at')
        .order('created_at', { ascending: false })
      const { data: profiles } = await supabase.from('profiles').select('id, name, email, avatar_url')
      const profileById = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]))
      const list = (runs ?? []).map((run) => {
        const p = profileById[run.user_id]
        const displayName = p?.name?.trim() || p?.email || '—'
        const avatar_url = p?.avatar_url ?? null
        return {
          run_id: run.id,
          user_id: run.user_id,
          distance_km: run.distance_km,
          xp: run.xp,
          created_at: run.created_at,
          displayName,
          avatar_url
        }
      })
      setItems(list)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <main className="min-h-screen p-4">Loading...</main>

  return (
    <main className="min-h-screen p-4">
      <h1 className="text-xl font-semibold mb-4">Activity feed</h1>
      <div className="space-y-4 max-w-md">
        {items.map((item) => (
          <div key={item.run_id} className="border rounded p-3 flex gap-3 items-center">
            {item.avatar_url ? (
              <img src={item.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
            ) : (
              <span className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium flex-shrink-0">
                {(item.displayName[0] ?? '?').toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium">{item.displayName}</p>
              <p className="text-sm text-gray-600">
                {item.distance_km} km · {item.xp} XP · {timeAgo(item.created_at)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
