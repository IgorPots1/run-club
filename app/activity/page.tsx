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
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
  { id: 'all', label: 'All' },
]

function formatDistance(value: number) {
  return value.toFixed(1)
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
  const chartMinWidth = Math.max(summary.chartData.length * 36, 320)

  if (loadingUser) {
    return <main className="min-h-screen flex items-center justify-center p-4">Загрузка...</main>
  }

  if (!user) return null

  return (
    <main className="min-h-screen">
      <div className="p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Активность</h1>
          <p className="mt-1 text-sm text-gray-500">Твоя беговая статистика за выбранный период.</p>
        </div>

        <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setPeriod(option.id)}
              className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium ${
                period === option.id ? 'border-black bg-black text-white' : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {isLoading && !runs ? (
          <>
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="skeleton-line h-4 w-28" />
              <div className="mt-4 skeleton-line h-10 w-40" />
              <div className="mt-5 skeleton-line h-4 w-32" />
              <div className="mt-2 skeleton-line h-7 w-24" />
            </div>
            <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="skeleton-line h-4 w-24" />
              <div className="mt-4 skeleton-line h-56 w-full" />
            </div>
          </>
        ) : error ? (
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <p className="text-sm text-red-600">Не удалось загрузить активность</p>
          </div>
        ) : runs && runs.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
            <p className="text-sm text-gray-500">Пока нет тренировок для статистики</p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <p className="text-sm font-medium text-gray-500">Общая дистанция</p>
              <p className="mt-3 text-4xl font-bold tracking-tight text-gray-900">{formatDistance(summary.totalDistance)} км</p>
              <div className="mt-5 border-t pt-4">
                <p className="text-sm text-gray-500">Тренировки</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{summary.totalWorkouts}</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <p className="text-sm font-medium text-gray-500">График</p>
              {summary.chartData.every((item) => item.distance === 0) ? (
                <div className="mt-6 text-center text-sm text-gray-500">Нет данных за выбранный период</div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <div style={{ minWidth: `${chartMinWidth}px`, height: '240px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={summary.chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: '#6b7280', fontSize: 12 }}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: '#6b7280', fontSize: 12 }}
                          width={36}
                        />
                        <Tooltip
                          cursor={{ fill: '#f9fafb' }}
                          formatter={(value) => [`${formatDistance(Number(value ?? 0))} км`, 'Дистанция']}
                          labelStyle={{ color: '#111827' }}
                          contentStyle={{
                            borderRadius: 12,
                            border: '1px solid #e5e7eb',
                            boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
                          }}
                        />
                        <Bar dataKey="distance" fill="#111827" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
