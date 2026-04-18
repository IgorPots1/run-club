import 'server-only'

import { createSupabaseAdminClient } from './supabase-admin'

export const MIN_RUN_DISTANCE_KM_FOR_XP = 1
export const DAILY_XP_CAP = 250
export const XP_PER_LIKE = 5
export const MAX_LIKES_WITH_XP_PER_DAY = 10
export const RUN_XP_FREQUENCY_WINDOW_MS = 10 * 60 * 1000

type LoadDailyXpUsageOptions = {
  userId: string
  timestamp: string
  excludeRunId?: string
  rawStravaPayload?: Record<string, unknown> | null
  supabase?: ReturnType<typeof createSupabaseAdminClient>
}

type DailyXpUsageRpcResult = {
  runXp?: number | null
  challengeXp?: number | null
  receivedLikesCount?: number | null
} | null

export function getUtcDayBounds(timestamp: string) {
  const date = new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    throw new Error('invalid_xp_timestamp')
  }

  const start = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0,
    0,
    0,
    0
  ))
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  }
}

function isValidIanaTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

function getIanaTimeZoneFromStravaPayload(rawStravaPayload?: Record<string, unknown> | null) {
  const timezoneRawValue = rawStravaPayload?.timezone
  const timezoneValue = typeof timezoneRawValue === 'string' ? timezoneRawValue.trim() : ''

  if (!timezoneValue) {
    return null
  }

  const directCandidate = timezoneValue

  if (isValidIanaTimeZone(directCandidate)) {
    return directCandidate
  }

  const timezoneSuffixCandidate = timezoneValue.includes(')')
    ? timezoneValue.split(')').at(-1)?.trim() ?? ''
    : ''

  if (timezoneSuffixCandidate && isValidIanaTimeZone(timezoneSuffixCandidate)) {
    return timezoneSuffixCandidate
  }

  return null
}

function getNumericUtcOffsetMs(rawStravaPayload?: Record<string, unknown> | null) {
  const utcOffsetRawValue = rawStravaPayload?.utc_offset
  const numericUtcOffsetValue = Number(utcOffsetRawValue)

  if (!Number.isFinite(numericUtcOffsetValue)) {
    return null
  }

  // Strava utc_offset is expected in seconds. We accept millisecond-like values defensively.
  const normalizedUtcOffsetMs = Math.abs(numericUtcOffsetValue) <= (24 * 60 * 60)
    ? Math.round(numericUtcOffsetValue * 1000)
    : Math.round(numericUtcOffsetValue)

  const maxOffsetMs = 24 * 60 * 60 * 1000

  if (Math.abs(normalizedUtcOffsetMs) > maxOffsetMs) {
    return null
  }

  return normalizedUtcOffsetMs
}

function getDatePartsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(date)
  const partByType = new Map(parts.map((part) => [part.type, part.value]))
  const year = Number(partByType.get('year'))
  const month = Number(partByType.get('month'))
  const day = Number(partByType.get('day'))
  const hour = Number(partByType.get('hour'))
  const minute = Number(partByType.get('minute'))
  const second = Number(partByType.get('second'))

  if (
    !Number.isFinite(year)
    || !Number.isFinite(month)
    || !Number.isFinite(day)
    || !Number.isFinite(hour)
    || !Number.isFinite(minute)
    || !Number.isFinite(second)
  ) {
    return null
  }

  return {
    year: Math.round(year),
    month: Math.round(month),
    day: Math.round(day),
    hour: Math.round(hour),
    minute: Math.round(minute),
    second: Math.round(second),
  }
}

function getTimeZoneOffsetMsAtInstant(date: Date, timeZone: string) {
  const parts = getDatePartsInTimeZone(date, timeZone)

  if (!parts) {
    return null
  }

  const asUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )

  return asUtcMs - date.getTime()
}

function getUtcDateFromTimeZoneDateParts(dateParts: { year: number; month: number; day: number }, timeZone: string) {
  const naiveUtcMs = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, 0, 0, 0, 0)
  const initialOffsetMs = getTimeZoneOffsetMsAtInstant(new Date(naiveUtcMs), timeZone)

  if (initialOffsetMs === null) {
    return null
  }

  let finalUtcMs = naiveUtcMs - initialOffsetMs
  const correctedOffsetMs = getTimeZoneOffsetMsAtInstant(new Date(finalUtcMs), timeZone)

  if (correctedOffsetMs === null) {
    return null
  }

  finalUtcMs = naiveUtcMs - correctedOffsetMs
  return new Date(finalUtcMs)
}

export function getStravaAwareDayBounds(
  timestamp: string,
  rawStravaPayload?: Record<string, unknown> | null
) {
  const date = new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    throw new Error('invalid_xp_timestamp')
  }

  const ianaTimeZone = getIanaTimeZoneFromStravaPayload(rawStravaPayload)

  if (ianaTimeZone) {
    const localDateParts = getDatePartsInTimeZone(date, ianaTimeZone)

    if (localDateParts) {
      const nextDayAnchor = new Date(Date.UTC(localDateParts.year, localDateParts.month - 1, localDateParts.day, 12, 0, 0, 0))
      nextDayAnchor.setUTCDate(nextDayAnchor.getUTCDate() + 1)
      const nextDayDateParts = {
        year: nextDayAnchor.getUTCFullYear(),
        month: nextDayAnchor.getUTCMonth() + 1,
        day: nextDayAnchor.getUTCDate(),
      }
      const startDate = getUtcDateFromTimeZoneDateParts(localDateParts, ianaTimeZone)
      const endDate = getUtcDateFromTimeZoneDateParts(nextDayDateParts, ianaTimeZone)

      if (startDate && endDate && endDate.getTime() > startDate.getTime()) {
        return {
          startIso: startDate.toISOString(),
          endIso: endDate.toISOString(),
        }
      }
    }
  }

  const utcOffsetMs = getNumericUtcOffsetMs(rawStravaPayload)

  if (utcOffsetMs !== null) {
    const shiftedDate = new Date(date.getTime() + utcOffsetMs)
    const dayStartMs = Date.UTC(
      shiftedDate.getUTCFullYear(),
      shiftedDate.getUTCMonth(),
      shiftedDate.getUTCDate(),
      0,
      0,
      0,
      0
    ) - utcOffsetMs

    return {
      startIso: new Date(dayStartMs).toISOString(),
      endIso: new Date(dayStartMs + (24 * 60 * 60 * 1000)).toISOString(),
    }
  }

  return getUtcDayBounds(timestamp)
}

export function applyDailyXpCap(rawXp: number, currentDailyXp: number) {
  const normalizedRawXp = Number.isFinite(rawXp) ? Math.max(0, Math.round(rawXp)) : 0
  const normalizedCurrentDailyXp = Number.isFinite(currentDailyXp)
    ? Math.max(0, Math.round(currentDailyXp))
    : 0
  const remainingXp = Math.max(0, DAILY_XP_CAP - normalizedCurrentDailyXp)
  const xpGained = Math.min(normalizedRawXp, remainingXp)

  return {
    xpGained,
    remainingXp,
  }
}

export async function loadDailyXpUsage({
  userId,
  timestamp,
  excludeRunId,
  rawStravaPayload,
  supabase = createSupabaseAdminClient(),
}: LoadDailyXpUsageOptions) {
  const { startIso, endIso } = getStravaAwareDayBounds(timestamp, rawStravaPayload)
  const usageWindowEndIso = new Date(timestamp).toISOString()
  const boundedUsageWindowEndIso = usageWindowEndIso <= startIso
    ? startIso
    : usageWindowEndIso >= endIso
      ? endIso
      : usageWindowEndIso
  let runXp = 0
  let challengeXp = 0
  let normalizedReceivedLikesCount = 0

  if (excludeRunId) {
    let runXpQuery = supabase
      .from('runs')
      .select('xp')
      .eq('user_id', userId)
      .gte('created_at', startIso)
      .lt('created_at', boundedUsageWindowEndIso)

    runXpQuery = runXpQuery.neq('id', excludeRunId)

    const [
      { data: runRows, error: runError },
      { data: challengeRows, error: challengeError },
      { count: receivedLikesCount, error: likesError },
    ] = await Promise.all([
      runXpQuery,
      supabase
        .from('user_challenges')
        .select('challenges!inner(xp_reward)')
        .eq('user_id', userId)
        .gte('completed_at', startIso)
        .lt('completed_at', boundedUsageWindowEndIso),
      supabase
        .from('run_likes')
        .select('id', { count: 'exact', head: true })
        .eq('run_owner_user_id', userId)
        .gt('xp_awarded', 0)
        .gte('created_at', startIso)
        .lt('created_at', boundedUsageWindowEndIso),
    ])

    if (runError) {
      throw runError
    }

    if (challengeError) {
      throw challengeError
    }

    if (likesError) {
      throw likesError
    }

    runXp = Math.max(
      0,
      Math.round(
        ((runRows as Array<{ xp?: number | null }> | null) ?? []).reduce(
          (sum, row) => sum + Math.max(0, Math.round(Number(row.xp ?? 0))),
          0
        )
      )
    )

    challengeXp = Math.max(
      0,
      Math.round(
        ((challengeRows as Array<{ challenges?: { xp_reward?: number | null } | null }> | null) ?? []).reduce(
          (sum, row) => sum + Math.max(0, Math.round(Number(row.challenges?.xp_reward ?? 0))),
          0
        )
      )
    )

    normalizedReceivedLikesCount = Math.max(0, Math.round(Number(receivedLikesCount ?? 0)))
  } else {
    const { data, error } = await supabase.rpc('get_daily_xp_usage', {
      p_user_id: userId,
      p_start: startIso,
      p_end: boundedUsageWindowEndIso,
    })

    if (error) {
      throw error
    }

    const dailyUsage = (data as DailyXpUsageRpcResult) ?? null
    runXp = Math.max(0, Math.round(Number(dailyUsage?.runXp ?? 0)))
    challengeXp = Math.max(0, Math.round(Number(dailyUsage?.challengeXp ?? 0)))
    normalizedReceivedLikesCount = Math.max(0, Math.round(Number(dailyUsage?.receivedLikesCount ?? 0)))
  }

  const likeXp = Math.min(normalizedReceivedLikesCount, MAX_LIKES_WITH_XP_PER_DAY) * XP_PER_LIKE
  const uncappedTotalXp = runXp + challengeXp + likeXp
  const totalXp = Math.min(uncappedTotalXp, DAILY_XP_CAP)

  return {
    runXp,
    challengeXp,
    likeXp,
    uncappedTotalXp,
    totalXp,
    receivedLikesCount: normalizedReceivedLikesCount,
  }
}
