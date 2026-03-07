'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

type LeaderboardRow = {
  user_id: string
  displayName: string
  avatar_url: string | null
  total_xp: number
  total_km: number
  runs_count: number
}

export default function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: runs } = await supabase.from('runs').select('user_id, xp, distance_km')
      const { data: profiles } = await supabase.from('profiles').select('id, email, name, avatar_url')
      const profileById = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]))
      const byUserId: Record<string, { total_xp: number; total_km: number; runs_count: number }> = {}
      for (const run of runs ?? []) {
        const id = run.user_id
        if (!byUserId[id]) byUserId[id] = { total_xp: 0, total_km: 0, runs_count: 0 }
        byUserId[id].total_xp += run.xp
        byUserId[id].total_km += run.distance_km
        byUserId[id].runs_count += 1
      }
      const list = Object.entries(byUserId)
        .map(([user_id, d]) => {
          const p = profileById[user_id]
          const displayName = p?.name?.trim() || p?.email || '—'
          const avatar_url = p?.avatar_url ?? null
          return { user_id, displayName, avatar_url, ...d }
        })
        .sort((a, b) => b.total_xp - a.total_xp)
      setRows(list)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <main className="min-h-screen p-4">Loading...</main>

  return (
    <main className="min-h-screen p-4">
      <h1 className="text-xl font-semibold mb-4">Leaderboard</h1>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse border">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="border p-2 text-left">Rank</th>
              <th className="border p-2 text-left">Avatar</th>
              <th className="border p-2 text-left">User</th>
              <th className="border p-2 text-left">Total XP</th>
              <th className="border p-2 text-left">Total KM</th>
              <th className="border p-2 text-left">Runs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.user_id} className="border-b">
                <td className="border p-2">{i + 1}</td>
                <td className="border p-2">
                  {row.avatar_url ? (
                    <img src={row.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <span className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium inline-flex">
                      {(row.displayName[0] ?? '?').toUpperCase()}
                    </span>
                  )}
                </td>
                <td className="border p-2">{row.displayName}</td>
                <td className="border p-2">{row.total_xp}</td>
                <td className="border p-2">{row.total_km.toFixed(2)}</td>
                <td className="border p-2">{row.runs_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
