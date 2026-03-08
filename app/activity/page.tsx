'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
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
import { supabase } from '@/lib/supabase'

const PERIOD_OPTIONS: { id: ActivityPeriod; label: string }[] = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'year', label: 'Год' },
  { id: 'all', label: 'Все' },
]

function formatDistance(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
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
    <div className="max-w-[180px] rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-lg">
      <p className="text-xs text-gray-500">
        Период: <span className="font-medium text-gray-900">{String(label ?? '—')}</span>
      </p>
      <p className="mt-1 text-xs text-gray-500">
        Дистанция: <span className="font-medium text-gray-900">{formatDistance(distance)} км</span>
      </p>
    </div>
  )
}

export default function ActivityPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loadingUser, setLoadingUser] = useState(true)
  const [period, setPeriod] = useState<ActivityPeriod>('week')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setLoadingUser(false)
      if (!user) router.push('/login')
    })
  }, [router])

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
    period === 'month' ? 4 : period === 'all' ? 2 : period === 'year' ? 0 : 0

  if (loadingUser) {
    return <main className="min-h-screen flex items-center justify-center p-4">Загрузка...</main>
  }

  if (!user) return null

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-7xl p-4 md:px-8 md:py-6">
        <div className="mb-5 md:mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Активность</h1>
          <p className="mt-1 text-sm text-gray-500">Твоя беговая статистика за выбранный период.</p>
        </div>

        <div className="mb-5 flex gap-2 overflow-x-auto pb-1 md:mb-8 md:flex-wrap md:gap-2.5 md:overflow-visible">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setPeriod(option.id)}
              className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium md:min-w-30 ${
                period === option.id ? 'border-black bg-black text-white' : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {isLoading && !runs ? (
          <>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 md:p-5">
              <div className="skeleton-line h-4 w-28" />
              <div className="mt-3 skeleton-line h-9 w-36" />
              <div className="mt-4 skeleton-line h-4 w-28" />
              <div className="mt-2 skeleton-line h-7 w-24" />
            </div>
            <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 md:p-5">
              <div className="skeleton-line h-4 w-24" />
              <div className="mt-3 skeleton-line h-52 w-full md:h-56" />
            </div>
          </>
        ) : error ? (
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 md:p-5">
            <p className="text-sm text-red-600">Не удалось загрузить активность</p>
          </div>
        ) : runs && runs.length === 0 ? (
          <div className="rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-black/5 md:p-6">
            <p className="text-sm text-gray-500">Пока нет тренировок для статистики</p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-[320px_minmax(0,1fr)] md:items-start md:gap-5">
              <div className="min-w-0 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 md:sticky md:top-6 md:p-5">
                <p className="text-sm font-medium text-gray-500">Общая дистанция</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 md:mt-2.5 md:text-4xl">
                  {formatDistance(summary.totalDistance)} км
                </p>
                <div className="mt-3.5 border-t pt-3 md:mt-4 md:pt-3.5">
                  <p className="text-sm text-gray-500">Тренировки</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">{summary.totalWorkouts}</p>
                </div>
              </div>

              <div className="min-w-0 overflow-hidden rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 md:p-5">
                <p className="text-sm font-medium text-gray-500">График дистанции</p>
                {summary.chartData.every((item) => item.distance === 0) ? (
                  <div className="mt-6 text-center text-sm text-gray-500">Нет данных за выбранный период</div>
                ) : (
                  <div className="mt-3 h-[220px] w-full md:mt-3.5 md:h-[300px]">
                    <div className="h-full w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={summary.chartData} margin={{ top: 6, right: 2, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis
                            dataKey="label"
                            tickLine={false}
                            axisLine={false}
                            interval={mobileXAxisInterval}
                            minTickGap={12}
                            tickMargin={6}
                            tick={{ fill: '#6b7280', fontSize: 11 }}
                          />
                          <YAxis
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: '#6b7280', fontSize: 11 }}
                            width={26}
                          />
                          <Tooltip
                            cursor={{ fill: '#f9fafb' }}
                            content={<ActivityChartTooltip />}
                          />
                          <Bar dataKey="distance" fill="#111827" radius={[8, 8, 0, 0]} maxBarSize={20} />
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
