'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

type LeaderboardRow = {
  email: string
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
      const { data: profiles } = await supabase.from('profiles').select('id, email')
      const emailById = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.email]))
      const byEmail: Record<string, { total_xp: number; total_km: number; runs_count: number }> = {}
      for (const run of runs ?? []) {
        const email = emailById[run.user_id] ?? '—'
        if (!byEmail[email]) byEmail[email] = { total_xp: 0, total_km: 0, runs_count: 0 }
        byEmail[email].total_xp += run.xp
        byEmail[email].total_km += run.distance_km
        byEmail[email].runs_count += 1
      }
      const list = Object.entries(byEmail)
        .map(([email, d]) => ({ email, ...d }))
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
              <th className="border p-2 text-left">User</th>
              <th className="border p-2 text-left">Total XP</th>
              <th className="border p-2 text-left">Total KM</th>
              <th className="border p-2 text-left">Runs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.email} className="border-b">
                <td className="border p-2">{i + 1}</td>
                <td className="border p-2">{row.email}</td>
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
