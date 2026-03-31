'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import ActivityDistanceChart from '@/components/ActivityDistanceChart'
import { getBootstrapUser } from '@/lib/auth'
import type { User } from '@supabase/supabase-js'
import {
  buildActivitySummary,
  loadActivityRuns,
  type ActivityPeriod,
} from '@/lib/activity'
import { formatDistanceKm } from '@/lib/format'
import { ensureProfileExists } from '@/lib/profiles'
import { RUNS_UPDATED_EVENT, RUNS_UPDATED_STORAGE_KEY } from '@/lib/runs-refresh'

const PERIOD_OPTIONS: { id: ActivityPeriod; label: string }[] = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'year', label: 'Год' },
  { id: 'all', label: 'Все' },
]

function formatDistance(value: number) {
  return formatDistanceKm(value)
}

export default function ActivityPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loadingUser, setLoadingUser] = useState(true)
  const [period, setPeriod] = useState<ActivityPeriod>('week')

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

  const { data: runs, error, isLoading, mutate } = useSWR(
    user ? (['activity-runs', user.id] as const) : null,
    ([, userId]: readonly [string, string]) => loadActivityRuns(userId),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      dedupingInterval: 15000,
      focusThrottleInterval: 15000,
    }
  )

  const summary = useMemo(() => buildActivitySummary(runs ?? [], period), [runs, period])
  const chartTitle =
    period === 'year'
      ? 'Дистанция по месяцам'
      : period === 'all'
        ? 'Дистанция по годам'
        : 'Дистанция по дням'
  const shouldRenderEmptyState = summary.chartData.length === 0

  useEffect(() => {
    if (!user) return

    function handleRunsUpdated() {
      void mutate()
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === RUNS_UPDATED_STORAGE_KEY) {
        void mutate()
      }
    }

    window.addEventListener(RUNS_UPDATED_EVENT, handleRunsUpdated)
    window.addEventListener('storage', handleStorage)

    return () => {
      window.removeEventListener(RUNS_UPDATED_EVENT, handleRunsUpdated)
      window.removeEventListener('storage', handleStorage)
    }
  }, [mutate, user])

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
    <main className="min-h-screen pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:max-w-7xl md:px-8 md:py-6">
        <div className="mb-5 md:mb-8">
          <h1 className="app-text-primary text-2xl font-bold">Активность</h1>
          <p className="app-text-secondary mt-1 text-sm">Твоя беговая статистика за выбранный период.</p>
        </div>

        <div className="app-card mb-5 rounded-2xl p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 md:mb-8 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="app-text-primary text-base font-semibold">Тренировки</p>
              <p className="app-text-secondary mt-1 text-sm">
                Открой список тренировок или перейди к добавлению новой.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href="/runs"
                className="app-button-secondary inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium"
              >
                Мои тренировки
              </Link>
              <Link
                href="/runs"
                className="app-button-primary inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium"
              >
                Добавить тренировку
              </Link>
            </div>
          </div>
        </div>

        <div className="mb-5 flex gap-2 overflow-x-auto pb-1 md:mb-8 md:flex-wrap md:gap-2.5 md:overflow-visible">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setPeriod(option.id)}
              className={`min-h-11 shrink-0 rounded-full border px-4 py-2 text-sm font-medium md:min-w-30 ${
                period === option.id ? 'app-button-primary' : 'app-button-secondary'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {isLoading && !runs ? (
          <>
            <div className="app-card rounded-2xl p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 md:p-5">
              <div className="skeleton-line h-4 w-28" />
              <div className="mt-3 skeleton-line h-9 w-36" />
              <div className="mt-4 skeleton-line h-4 w-28" />
              <div className="mt-2 skeleton-line h-7 w-24" />
            </div>
            <div className="app-card mt-4 rounded-2xl p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 md:p-5">
              <div className="skeleton-line h-4 w-24" />
              <div className="mt-3 skeleton-line h-52 w-full md:h-56" />
            </div>
          </>
        ) : error ? (
          <div className="app-card rounded-2xl p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 md:p-5">
            <p className="text-sm text-red-600">Не удалось загрузить активность</p>
          </div>
        ) : runs && runs.length === 0 ? (
          <div className="app-card rounded-2xl p-5 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10 md:p-6">
            <p className="app-text-secondary text-sm">Статистика появится после первой тренировки.</p>
            <p className="app-text-secondary mt-2 text-sm">Добавьте пробежку и возвращайтесь за графиком.</p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-[320px_minmax(0,1fr)] md:items-start md:gap-5">
              <div className="app-card min-w-0 rounded-2xl p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 md:sticky md:top-6 md:p-5">
                <p className="app-text-secondary text-sm font-medium">Общая дистанция</p>
                <p className="app-text-primary mt-2 break-words text-3xl font-bold tracking-tight md:mt-2.5 md:text-4xl">
                  {formatDistance(summary.totalDistance)} км
                </p>
                <div className="mt-3.5 border-t pt-3 md:mt-4 md:pt-3.5">
                  <p className="app-text-secondary text-sm">Тренировки</p>
                  <p className="app-text-primary mt-1 text-2xl font-semibold">{summary.totalWorkouts}</p>
                </div>
              </div>

              <div className="app-card min-w-0 overflow-hidden rounded-2xl p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 md:p-5">
                <p className="app-text-secondary text-sm font-medium">{chartTitle}</p>
                {shouldRenderEmptyState ? (
                  <div className="app-text-secondary mt-6 text-center text-sm">
                    <p>За этот период пока нет данных.</p>
                    <p className="mt-2">Попробуйте выбрать другой диапазон.</p>
                  </div>
                ) : (
                  <div className="mt-3 w-full md:mt-3.5">
                    <ActivityDistanceChart
                      key={period}
                      data={summary.chartData}
                      mode={period}
                      heightClassName="h-[220px] md:h-[300px]"
                    />
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
