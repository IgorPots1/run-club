import { supabase } from './supabase'

export type ActivityPeriod = 'week' | 'month' | 'year' | 'all'

type ActivityRunRow = {
  distance_km: number | null
  created_at: string
}

export type ActivityWindowRun = {
  distance_km: number | null
  created_at: string
  moving_time_seconds?: number | null
}

export type ActivityChartPoint = {
  label: string
  distance: number
}

export type ActivityTrendPoint = ActivityChartPoint & {
  index: number
  xKey: string
  axisLabel: string
  monthKey: string
  monthLabel: string
  rangeLabel: string
  isCurrent: boolean
  isComplete: boolean
}

export type ActivitySummary = {
  totalDistance: number
  totalWorkouts: number
  chartData: ActivityChartPoint[]
}

export type ActivityWindowStats = {
  totalDistanceKm: number
  runsCount: number
  activeDaysCount: number
  totalMovingTimeSeconds: number
}

function startOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1)
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1)
}

function endOfYear(date: Date) {
  return new Date(date.getFullYear() + 1, 0, 1)
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

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

const RUSSIAN_MONTH_LABELS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'] as const
const RUSSIAN_WEEKDAY_LABELS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'] as const
const RUSSIAN_LONG_MONTH_LABELS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'] as const

function formatMonthLabel(date: Date) {
  return RUSSIAN_MONTH_LABELS[date.getMonth()] ?? ''
}

function formatLongMonthLabel(date: Date) {
  return RUSSIAN_LONG_MONTH_LABELS[date.getMonth()] ?? ''
}

function formatYearLabel(date: Date) {
  return String(date.getFullYear())
}

function formatWeekdayLabel(dayIndex: number) {
  return RUSSIAN_WEEKDAY_LABELS[dayIndex] ?? ''
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function sumDistance(runs: Array<{ distance: number }>) {
  return runs.reduce((sum, run) => sum + run.distance, 0)
}

function buildDistanceMapByKey(runs: Array<{ distance: number; createdAt: Date }>, keyBuilder: (date: Date) => number) {
  return runs.reduce<Record<number, number>>((totals, run) => {
    const key = keyBuilder(run.createdAt)
    totals[key] = (totals[key] ?? 0) + run.distance
    return totals
  }, {})
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
    const end = addDays(start, 7)
    const days = Array.from({ length: 7 }, (_, index) => addDays(start, index))
    const filteredRuns = normalizedRuns.filter((run) => run.createdAt >= start && run.createdAt < end)

    return {
      totalDistance: sumDistance(filteredRuns),
      totalWorkouts: filteredRuns.length,
      chartData: days.map((day, index) => ({
        label: formatWeekdayLabel(index),
        distance: filteredRuns
          .filter((run) => isSameDay(run.createdAt, day))
          .reduce((sum, run) => sum + run.distance, 0),
      })),
    }
  }

  if (period === 'month') {
    const start = startOfMonth(now)
    const end = endOfMonth(now)
    const filteredRuns = normalizedRuns.filter((run) => run.createdAt >= start && run.createdAt < end)
    const distanceByDay = buildDistanceMapByKey(filteredRuns, (date) => date.getDate())
    const daysWithWorkouts = Object.keys(distanceByDay)
      .map((day) => Number(day))
      .filter((day) => Number.isFinite(day))
      .sort((left, right) => left - right)

    return {
      totalDistance: sumDistance(filteredRuns),
      totalWorkouts: filteredRuns.length,
      chartData: daysWithWorkouts.map((day) => ({
        label: String(day),
        distance: distanceByDay[day] ?? 0,
      })),
    }
  }

  if (period === 'year') {
    const start = startOfYear(now)
    const end = endOfYear(now)
    const months = Array.from({ length: 12 }, (_, index) => new Date(now.getFullYear(), index, 1))
    const filteredRuns = normalizedRuns.filter((run) => run.createdAt >= start && run.createdAt < end)
    const distanceByMonth = buildDistanceMapByKey(filteredRuns, (date) => date.getMonth())

    return {
      totalDistance: sumDistance(filteredRuns),
      totalWorkouts: filteredRuns.length,
      chartData: months.map((month) => ({
        label: formatMonthLabel(month),
        distance: distanceByMonth[month.getMonth()] ?? 0,
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
  const distanceByYear = buildDistanceMapByKey(normalizedRuns, (date) => date.getFullYear())

  for (let cursor = firstYear; cursor <= lastYear; cursor = addMonths(cursor, 12)) {
    years.push(cursor)
  }

  return {
    totalDistance: sumDistance(normalizedRuns),
    totalWorkouts: normalizedRuns.length,
    chartData: years.map((year) => ({
      label: formatYearLabel(year),
      distance: distanceByYear[year.getFullYear()] ?? 0,
    })),
  }
}

export function buildActivityWindowStats(
  runs: ActivityWindowRun[],
  options: { days?: number; now?: Date } = {}
): ActivityWindowStats {
  const { days = 30, now = new Date() } = options
  const safeDays = Math.max(1, Math.floor(days))
  const end = addDays(startOfDay(now), 1)
  const start = addDays(end, -safeDays)
  const filteredRuns = runs.filter((run) => {
    const createdAt = new Date(run.created_at)
    return !Number.isNaN(createdAt.getTime()) && createdAt >= start && createdAt < end
  })

  const activeDateKeys = new Set(
    filteredRuns.map((run) => formatDateKey(new Date(run.created_at)))
  )

  return {
    totalDistanceKm: filteredRuns.reduce((sum, run) => sum + Number(run.distance_km ?? 0), 0),
    runsCount: filteredRuns.length,
    activeDaysCount: activeDateKeys.size,
    totalMovingTimeSeconds: filteredRuns.reduce((sum, run) => sum + Math.max(0, Number(run.moving_time_seconds ?? 0)), 0),
  }
}

export function buildRollingWeeklyDistanceChart(
  runs: ActivityWindowRun[],
  options: { weeks?: number; now?: Date } = {}
): ActivityTrendPoint[] {
  const { weeks = 12, now = new Date() } = options
  const safeWeeks = Math.max(1, Math.floor(weeks))
  const currentWeekStart = startOfWeek(now)
  const firstWeekStart = addDays(currentWeekStart, -(safeWeeks - 1) * 7)
  const nextDayStart = addDays(startOfDay(now), 1)

  function buildRangeLabel(weekStart: Date, weekEndInclusive: Date) {
    const sameMonth =
      weekStart.getFullYear() === weekEndInclusive.getFullYear() &&
      weekStart.getMonth() === weekEndInclusive.getMonth()

    if (sameMonth) {
      return `${weekStart.getDate()}–${weekEndInclusive.getDate()} ${formatLongMonthLabel(weekEndInclusive)}`
    }

    return `${weekStart.getDate()} ${formatLongMonthLabel(weekStart)} – ${weekEndInclusive.getDate()} ${formatLongMonthLabel(weekEndInclusive)}`
  }

  return Array.from({ length: safeWeeks }, (_, index) => {
    const bucketStart = addDays(firstWeekStart, index * 7)
    const bucketEnd = addDays(bucketStart, 7)
    const bucketEndInclusive = addDays(bucketEnd, -1)
    const totalDistance = runs.reduce((sum, run) => {
      const createdAt = new Date(run.created_at)

      if (Number.isNaN(createdAt.getTime()) || createdAt < bucketStart || createdAt >= bucketEnd) {
        return sum
      }

      return sum + Math.max(0, Number(run.distance_km ?? 0))
    }, 0)

    return {
      index,
      label:
        index === 0 || bucketStart.getMonth() !== addDays(bucketStart, -7).getMonth()
          ? formatMonthLabel(bucketStart)
          : '',
      distance: totalDistance,
      xKey: formatDateKey(bucketStart),
      axisLabel:
        index === 0 || bucketStart.getMonth() !== addDays(bucketStart, -7).getMonth()
          ? formatMonthLabel(bucketStart)
          : '',
      monthKey: `${bucketStart.getFullYear()}-${bucketStart.getMonth() + 1}`,
      monthLabel: formatMonthLabel(bucketStart),
      rangeLabel: buildRangeLabel(bucketStart, bucketEndInclusive),
      isCurrent: index === safeWeeks - 1,
      isComplete: bucketEnd <= nextDayStart,
    }
  })
}
