'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { loadChallengeXpByUser } from '@/lib/user-challenges'
import { getLevelFromXP } from '@/lib/xp'

type LeaderboardRow = {
  user_id: string
  displayName: string
  avatar_url: string | null
  total_xp: number
  total_km: number
  runs_count: number
}

type LeaderboardSectionProps = {
  showTitle?: boolean
}

export default function LeaderboardSection({ showTitle = true }: LeaderboardSectionProps) {
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: runs }, { data: profiles }, challengeXpByUser] = await Promise.all([
        supabase.from('runs').select('user_id, xp, distance_km'),
        supabase.from('profiles').select('id, email, name, avatar_url'),
        loadChallengeXpByUser(),
      ])
      const profileById = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]))
      const byUserId: Record<string, { total_xp: number; total_km: number; runs_count: number }> = {}

      for (const run of runs ?? []) {
        const id = run.user_id
        if (!byUserId[id]) byUserId[id] = { total_xp: 0, total_km: 0, runs_count: 0 }
        byUserId[id].total_xp += run.xp
        byUserId[id].total_km += run.distance_km
        byUserId[id].runs_count += 1
      }

      for (const [userId, xp] of Object.entries(challengeXpByUser)) {
        if (!byUserId[userId]) byUserId[userId] = { total_xp: 0, total_km: 0, runs_count: 0 }
        byUserId[userId].total_xp += xp
      }

      const list = Object.entries(byUserId)
        .map(([user_id, data]) => {
          const profile = profileById[user_id]
          const displayName = profile?.name?.trim() || profile?.email || '—'
          const avatar_url = profile?.avatar_url ?? null
          return { user_id, displayName, avatar_url, ...data }
        })
        .sort((a, b) => b.total_xp - a.total_xp)

      setRows(list)
      setLoading(false)
    }

    void load()
  }, [])

  if (loading) {
    return (
      <div className="p-4">
        {showTitle ? <h1 className="mb-4 text-2xl font-bold">Рейтинг</h1> : null}
        <p>Загрузка...</p>
      </div>
    )
  }

  return (
    <div className="p-4">
      {showTitle ? <h1 className="mb-4 text-2xl font-bold">Рейтинг</h1> : null}
      {rows.length === 0 ? (
        <div className="mt-10 text-center text-gray-500">
          <p>Рейтинг пока пуст</p>
        </div>
      ) : (
        <>
          <div className="md:hidden">
            {rows.map((row, index) => (
              <div key={row.user_id} className="mb-3 rounded-xl border bg-white p-4 shadow-sm">
                <p className="mb-3 font-medium">{index + 1} место</p>
                <div className="mb-4 flex items-center gap-3">
                  {row.avatar_url ? (
                    <img src={row.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-sm font-medium">
                      {(row.displayName[0] ?? '?').toUpperCase()}
                    </span>
                  )}
                  <div>
                    <p className="font-medium">{row.displayName}</p>
                    <p className="text-sm text-gray-500">Уровень {getLevelFromXP(row.total_xp).level}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs text-gray-500">Всего XP</p>
                    <p className="text-lg font-semibold">{row.total_xp}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Всего км</p>
                    <p className="text-lg font-semibold">{row.total_km.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Тренировки</p>
                    <p className="text-lg font-semibold">{row.runs_count}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mb-4 hidden overflow-x-auto rounded-xl border bg-white p-4 shadow-sm md:block">
            <table className="w-full border-collapse border">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="border p-2 text-left">Место</th>
                  <th className="border p-2 text-left">Аватар</th>
                  <th className="border p-2 text-left">Участник</th>
                  <th className="border p-2 text-left">Всего XP</th>
                  <th className="border p-2 text-left">Всего км</th>
                  <th className="border p-2 text-left">Тренировки</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.user_id} className="border-b">
                    <td className="border p-2">{index + 1}</td>
                    <td className="border p-2">
                      {row.avatar_url ? (
                        <img src={row.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-sm font-medium">
                          {(row.displayName[0] ?? '?').toUpperCase()}
                        </span>
                      )}
                    </td>
                    <td className="border p-2">{row.displayName} · Уровень {getLevelFromXP(row.total_xp).level}</td>
                    <td className="border p-2">{row.total_xp}</td>
                    <td className="border p-2">{row.total_km.toFixed(2)}</td>
                    <td className="border p-2">{row.runs_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
