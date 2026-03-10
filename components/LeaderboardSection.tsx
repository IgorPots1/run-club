'use client'

import { useEffect, useState } from 'react'
import { formatDistanceKm } from '@/lib/format'
import { loadLikeXpByUser } from '@/lib/likes-xp'
import { getProfileDisplayName } from '@/lib/profiles'
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
  const [error, setError] = useState('')

  useEffect(() => {
    let isMounted = true

    async function load() {
      setError('')

      try {
        const [
          { data: runs, error: runsError },
          { data: profiles, error: profilesError },
          challengeXpByUser,
          likeXpByUser,
        ] = await Promise.all([
          supabase.from('runs').select('user_id, xp, distance_km'),
          supabase.from('profiles').select('*'),
          loadChallengeXpByUser(),
          loadLikeXpByUser(),
        ])

        if (!isMounted) return

        if (runsError) {
          setError('Не удалось загрузить рейтинг')
          setRows([])
          return
        }

        const profileById = profilesError ? {} : Object.fromEntries((profiles ?? []).map((p) => [p.id, p]))
        const byUserId: Record<string, { total_xp: number; total_km: number; runs_count: number }> = {}

        for (const run of runs ?? []) {
          const id = run.user_id
          if (!byUserId[id]) byUserId[id] = { total_xp: 0, total_km: 0, runs_count: 0 }
          byUserId[id].total_xp += Number(run.xp ?? 0)
          byUserId[id].total_km += Number(run.distance_km ?? 0)
          byUserId[id].runs_count += 1
        }

        for (const [userId, xp] of Object.entries(challengeXpByUser)) {
          if (!byUserId[userId]) byUserId[userId] = { total_xp: 0, total_km: 0, runs_count: 0 }
          byUserId[userId].total_xp += xp
        }

        for (const [userId, xp] of Object.entries(likeXpByUser)) {
          if (!byUserId[userId]) byUserId[userId] = { total_xp: 0, total_km: 0, runs_count: 0 }
          byUserId[userId].total_xp += xp
        }

        const list = Object.entries(byUserId)
          .map(([user_id, data]) => {
            const profile = profileById[user_id]
            const displayName = getProfileDisplayName(profile, 'Бегун')
            const avatar_url = profile?.avatar_url ?? null
            return { user_id, displayName, avatar_url, ...data }
          })
          .sort((a, b) => b.total_xp - a.total_xp)

        setRows(list)
      } catch {
        if (isMounted) {
          setError('Не удалось загрузить рейтинг')
          setRows([])
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      isMounted = false
    }
  }, [])

  if (loading) {
    return (
      <div className="p-4">
        {showTitle ? <h1 className="app-text-primary mb-4 text-2xl font-bold">Рейтинг</h1> : null}
        <p>Загрузка...</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl p-4 md:max-w-none">
      {showTitle ? <h1 className="app-text-primary mb-4 text-2xl font-bold">Рейтинг</h1> : null}
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : rows.length === 0 ? (
        <div className="app-text-secondary mt-10 text-center">
          <p>Рейтинг пока пуст.</p>
          <p className="mt-2 text-sm">Как только появятся тренировки, здесь начнется гонка.</p>
        </div>
      ) : (
        <>
          <div className="md:hidden">
            {rows.map((row, index) => (
              <div key={row.user_id} className="app-card mb-4 overflow-hidden rounded-2xl border p-4 shadow-sm">
                <p className="app-text-primary mb-3 font-medium">{index + 1} место</p>
                <div className="mb-4 flex items-center gap-3">
                  {row.avatar_url ? (
                    <img src={row.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-sm font-medium dark:bg-gray-700 dark:text-gray-100">
                      {(row.displayName[0] ?? '?').toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="app-text-primary truncate font-medium">{row.displayName}</p>
                    <p className="app-text-secondary text-sm">Уровень {getLevelFromXP(row.total_xp).level}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <div>
                    <p className="app-text-secondary text-xs">Всего XP</p>
                    <p className="app-text-primary break-words text-base font-semibold sm:text-lg">{row.total_xp}</p>
                  </div>
                  <div>
                    <p className="app-text-secondary text-xs">Всего км</p>
                    <p className="app-text-primary break-words text-base font-semibold sm:text-lg">{formatDistanceKm(row.total_km)}</p>
                  </div>
                  <div>
                    <p className="app-text-secondary text-xs">Тренировки</p>
                    <p className="app-text-primary break-words text-base font-semibold sm:text-lg">{row.runs_count}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="app-card mb-4 hidden overflow-x-auto rounded-xl border p-4 shadow-sm md:block">
            <table className="w-full border-collapse border">
              <thead className="app-text-primary">
                <tr className="app-surface-muted border-b">
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
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-sm font-medium dark:bg-gray-700 dark:text-gray-100">
                          {(row.displayName[0] ?? '?').toUpperCase()}
                        </span>
                      )}
                    </td>
                    <td className="border p-2">{row.displayName} · Уровень {getLevelFromXP(row.total_xp).level}</td>
                    <td className="border p-2">{row.total_xp}</td>
                    <td className="border p-2">{formatDistanceKm(row.total_km)}</td>
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
