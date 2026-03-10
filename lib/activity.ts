import { supabase } from './supabase'

export type ActivityPeriod = 'week' | 'month' | 'year' | 'all'

type ActivityRunRow = {
  distance_km: number | null
  created_at: string
}

export type ActivityChartPoint = {
  label: string
  distance: number
}

export type ActivitySummary = {
  totalDistance: number
  totalWorkouts: number
  chartData: ActivityChartPoint[]
}

function startOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1)
}

function startOfWeek(date: Date) {
  const next = startOfDay(date)
  const day = next.getDay()
  const diff = day === 0 ? -6 : 1 - day
  next.setDate(next.getDate() + diff)
  return next
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

const RUSSIAN_MONTH_LABELS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'] as const

function formatMonthLabel(date: Date) {
  return RUSSIAN_MONTH_LABELS[date.getMonth()] ?? ''
}

function formatYearLabel(date: Date) {
  return String(date.getFullYear())
}

function formatWeekdayLabel(date: Date) {
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(date)
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function isSameMonth(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth()
}

function isSameYear(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
}

export async function loadActivityRuns(userId: string) {
  const { data, error } = await supabase
    .from('runs')
    .select('distance_km, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error('Не удалось загрузить активность')
  }

  return (data as ActivityRunRow[] | null) ?? []
}

export function buildActivitySummary(runs: ActivityRunRow[], period: ActivityPeriod): ActivitySummary {
  const now = new Date()
  const normalizedRuns = runs.map((run) => ({
    distance: Number(run.distance_km ?? 0),
    createdAt: new Date(run.created_at),
  }))

  if (period === 'week') {
    const start = startOfWeek(now)
    const days = Array.from({ length: 7 }, (_, index) => addDays(start, index))
    const filteredRuns = normalizedRuns.filter((run) => run.createdAt >= start)

    return {
      totalDistance: filteredRuns.reduce((sum, run) => sum + run.distance, 0),
      totalWorkouts: filteredRuns.length,
      chartData: days.map((day) => ({
        label: formatWeekdayLabel(day),
        distance: filteredRuns
          .filter((run) => isSameDay(run.createdAt, day))
          .reduce((sum, run) => sum + run.distance, 0),
      })),
    }
  }

  if (period === 'month') {
    const start = startOfMonth(now)
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const days = Array.from({ length: daysInMonth }, (_, index) => new Date(now.getFullYear(), now.getMonth(), index + 1))
    const filteredRuns = normalizedRuns.filter((run) => run.createdAt >= start)

    return {
      totalDistance: filteredRuns.reduce((sum, run) => sum + run.distance, 0),
      totalWorkouts: filteredRuns.length,
      chartData: days.map((day) => ({
        label: String(day.getDate()),
        distance: filteredRuns
          .filter((run) => isSameDay(run.createdAt, day))
          .reduce((sum, run) => sum + run.distance, 0),
      })),
    }
  }

  if (period === 'year') {
    const start = startOfYear(now)
    const months = Array.from({ length: 12 }, (_, index) => new Date(now.getFullYear(), index, 1))
    const filteredRuns = normalizedRuns.filter((run) => run.createdAt >= start)

    return {
      totalDistance: filteredRuns.reduce((sum, run) => sum + run.distance, 0),
      totalWorkouts: filteredRuns.length,
      chartData: months.map((month) => ({
        label: formatMonthLabel(month),
        distance: filteredRuns
          .filter((run) => isSameMonth(run.createdAt, month))
          .reduce((sum, run) => sum + run.distance, 0),
      })),
    }
  }

  if (normalizedRuns.length === 0) {
    return {
      totalDistance: 0,
      totalWorkouts: 0,
      chartData: [],
    }
  }

  const firstYear = startOfYear(normalizedRuns[0].createdAt)
  const lastYear = startOfYear(now)
  const years: Date[] = []

  for (let cursor = firstYear; cursor <= lastYear; cursor = addMonths(cursor, 12)) {
    years.push(cursor)
  }

  return {
    totalDistance: normalizedRuns.reduce((sum, run) => sum + run.distance, 0),
    totalWorkouts: normalizedRuns.length,
    chartData: years.map((year) => ({
      label: formatYearLabel(year),
      distance: normalizedRuns
        .filter((run) => isSameYear(run.createdAt, year))
        .reduce((sum, run) => sum + run.distance, 0),
    })),
  }
}
