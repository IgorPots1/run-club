'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { getBootstrapUser } from '@/lib/auth'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { User } from '@supabase/supabase-js'
import { buildActivitySummary, loadActivityRuns, type ActivityPeriod } from '@/lib/activity'
import { formatDistanceKm } from '@/lib/format'
import { ensureProfileExists } from '@/lib/profiles'

const PERIOD_OPTIONS: { id: ActivityPeriod; label: string }[] = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'year', label: 'Год' },
  { id: 'all', label: 'Все' },
]

function formatDistance(value: number) {
  return formatDistanceKm(value)
}

type ActivityChartTooltipProps = {
  active?: boolean
  payload?: Array<{ value?: number | string }>
  label?: string | number
}

function ActivityChartTooltip({ active, payload, label }: ActivityChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  const distance = Number(payload[0]?.value ?? 0)

  return (
    <div className="app-card max-w-[180px] rounded-xl border px-3 py-2 shadow-lg">
      <p className="app-text-secondary text-xs">
        Период: <span className="app-text-primary font-medium">{String(label ?? '—')}</span>
      </p>
      <p className="app-text-secondary mt-1 text-xs">
        Дистанция: <span className="app-text-primary font-medium">{formatDistance(distance)} км</span>
      </p>
    </div>
  )
}

export default function ActivityPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loadingUser, setLoadingUser] = useState(true)
  const [period, setPeriod] = useState<ActivityPeriod>('week')
  const [isVerySmallScreen, setIsVerySmallScreen] = useState(false)

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

  useEffect(() => {
    function updateViewportState() {
      setIsVerySmallScreen(window.innerWidth < 390)
    }

    updateViewportState()
    window.addEventListener('resize', updateViewportState)

    return () => {
      window.removeEventListener('resize', updateViewportState)
    }
  }, [])

  const { data: runs, error, isLoading } = useSWR(
    user ? (['activity-runs', user.id] as const) : null,
    ([, userId]: readonly [string, string]) => loadActivityRuns(userId),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    }
  )

  const summary = useMemo(() => buildActivitySummary(runs ?? [], period), [runs, period])
  const mobileXAxisInterval =
    period === 'month'
      ? 4
      : period === 'all'
        ? (isVerySmallScreen && summary.chartData.length > 4 ? 1 : 0)
        : period === 'year'
          ? (isVerySmallScreen ? 1 : 0)
          : 0
  const chartTickFontSize = isVerySmallScreen ? 11 : 12

  if (loadingUser) {
    return <main className="min-h-screen flex items-center justify-center p-4">Загрузка...</main>
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

  return (
    <main className="min-h-screen pb-[calc(96px+env(safe-area-inset-bottom))] md:pb-0">
      <div className="mx-auto max-w-xl p-4 md:max-w-7xl md:px-8 md:py-6">
        <div className="mb-5 md:mb-8">
          <h1 className="app-text-primary text-2xl font-bold">Активность</h1>
          <p className="app-text-secondary mt-1 text-sm">Твоя беговая статистика за выбранный период.</p>
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
                <p className="app-text-secondary text-sm font-medium">График дистанции</p>
                {summary.chartData.every((item) => item.distance === 0) ? (
                  <div className="app-text-secondary mt-6 text-center text-sm">
                    <p>За этот период пока нет данных.</p>
                    <p className="mt-2">Попробуйте выбрать другой диапазон.</p>
                  </div>
                ) : (
                  <div className="mt-3 h-[220px] w-full md:mt-3.5 md:h-[300px]">
                    <div className="h-full w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={summary.chartData}
                          margin={{ top: 4, right: 0, left: -8, bottom: 0 }}
                          barCategoryGap="18%"
                          accessibilityLayer={false}
                        >
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                          <XAxis
                            dataKey="label"
                            tickLine={false}
                            axisLine={false}
                            interval={mobileXAxisInterval}
                            minTickGap={isVerySmallScreen ? 16 : 10}
                            tickMargin={8}
                            tick={{ fill: 'var(--chart-tick)', fontSize: chartTickFontSize }}
                          />
                          <YAxis
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: 'var(--chart-tick)', fontSize: chartTickFontSize }}
                            width={24}
                          />
                          <Tooltip
                            shared={false}
                            cursor={false}
                            content={<ActivityChartTooltip />}
                          />
                          <Bar dataKey="distance" fill="var(--accent-strong)" radius={[8, 8, 0, 0]} maxBarSize={28} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
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
