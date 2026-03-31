'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import InnerPageHeader from '@/components/InnerPageHeader'
import { getBootstrapUser } from '@/lib/auth'
import { ensureProfileExists } from '@/lib/profiles'
import { loadWeeklyXpLeaderboard, type WeeklyXpLeaderboard } from '@/lib/weekly-xp'
import type { User } from '@supabase/supabase-js'

function getStatusText(args: {
  rank: number
  gapToNext: number | null
  gapToBehind: number | null
}) {
  const { rank, gapToNext, gapToBehind } = args

  if (rank > 0 && rank <= 3) {
    return 'Ты в топе'
  }

  if (typeof gapToNext === 'number' && gapToNext <= 20) {
    return 'Почти догнал'
  }

  if (typeof gapToBehind === 'number' && gapToBehind <= 20) {
    return 'Под давлением'
  }

  return ''
}

export default function RacePage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loadingUser, setLoadingUser] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function loadUser() {
      try {
        if (!isMounted) return

        const nextUser = await getBootstrapUser()
        setUser(nextUser)

        if (nextUser) {
          void ensureProfileExists(nextUser)
        }

        if (!nextUser) {
          router.replace('/login')
        }
      } finally {
        if (isMounted) {
          setLoadingUser(false)
        }
      }
    }

    void loadUser()

    return () => {
      isMounted = false
    }
  }, [router])

  const {
    data: leaderboard,
    error,
    isLoading,
  } = useSWR<WeeklyXpLeaderboard>(
    user ? (['weekly-race', user.id] as const) : null,
    ([, userId]: readonly [string, string]) => loadWeeklyXpLeaderboard(userId),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      dedupingInterval: 15000,
      focusThrottleInterval: 15000,
    }
  )

  const rows = Array.isArray(leaderboard?.rows) ? leaderboard.rows : []
  const currentUserRow = leaderboard?.currentUserRow ?? null
  const gapToNext = typeof leaderboard?.gapToNext === 'number' ? leaderboard.gapToNext : null
  const gapToBehind = typeof leaderboard?.gapToBehind === 'number' ? leaderboard.gapToBehind : null
  const statusText = useMemo(
    () => getStatusText({
      rank: currentUserRow?.rank ?? 0,
      gapToNext,
      gapToBehind,
    }),
    [currentUserRow?.rank, gapToBehind, gapToNext]
  )

  if (loadingUser) {
    return <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">Загрузка...</main>
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

  return (
    <main className="min-h-screen pb-[calc(96px+env(safe-area-inset-bottom))] md:pb-0">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <InnerPageHeader title="Гонка недели" fallbackHref="/dashboard" />

        <div className="app-card mt-4 rounded-2xl border p-4 shadow-sm">
          <h1 className="app-text-primary text-2xl font-bold">Гонка недели</h1>
          <p className="app-text-secondary mt-1 text-sm">Последние 7 дней</p>

          {isLoading ? (
            <div className="mt-4 space-y-3">
              {[0, 1, 2, 3, 4].map((item) => (
                <div key={item} className="flex items-center justify-between gap-3">
                  <div className="skeleton-line h-4 w-32" />
                  <div className="skeleton-line h-4 w-14" />
                </div>
              ))}
            </div>
          ) : error ? (
            <p className="app-text-secondary mt-4 text-sm">Не удалось загрузить недельный рейтинг</p>
          ) : rows.length === 0 ? (
            <p className="app-text-secondary mt-4 text-sm">Пока нет данных за последние 7 дней</p>
          ) : (
            <>
              {currentUserRow ? (
                <div className="app-surface-muted mt-4 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="app-text-primary text-sm font-semibold">
                        Ты — {currentUserRow.rank} место
                      </p>
                      <p className="app-text-secondary mt-1 text-sm">{currentUserRow.totalXp} XP</p>
                      {statusText ? (
                        <p className="app-text-primary mt-2 text-sm font-medium">{statusText}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      {gapToNext !== null && gapToNext > 0 ? (
                        <p className="app-text-secondary">До следующего: {gapToNext} XP</p>
                      ) : null}
                      {gapToBehind !== null ? (
                        <p className="app-text-secondary mt-1">Отрыв: {gapToBehind} XP</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="mt-4 space-y-2">
                {rows.map((row) => {
                  const isCurrentUser = row.user_id === user.id

                  return (
                    <div
                      key={row.user_id}
                      className={`rounded-2xl border p-4 shadow-sm ${
                        isCurrentUser ? 'app-card ring-1 ring-black/10 dark:ring-white/15' : 'app-card'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="app-text-primary truncate text-sm font-medium">
                            {row.rank}. {row.displayName}
                          </p>
                          {isCurrentUser ? (
                            <p className="app-text-secondary mt-1 text-xs">Это ты</p>
                          ) : null}
                        </div>
                        <p className="app-text-primary shrink-0 text-sm font-semibold">{row.totalXp} XP</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
