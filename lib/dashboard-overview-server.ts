import 'server-only'

import { createSupabaseAdminClient } from './supabase-admin'
import type { ChallengeListItem, ChallengesOverview } from './challenges'
import type { DashboardActiveChallenge, DashboardOverview } from './dashboard-overview'

type ProfileRow = {
  name: string | null
  nickname: string | null
  email: string | null
  total_xp: number | null
}

type RunRow = {
  distance_km: number | null
  created_at: string
}

type NormalizedRunRow = {
  distanceKm: number
  timestamp: number
}

type ChallengeRow = {
  id: string
  title: string | null
  description: string | null
  badge_url: string | null
  period_type: string | null
  goal_unit: string | null
  goal_target: number | string | null
  xp_reward: number | null
  starts_at: string | null
  end_at: string | null
  created_at: string | null
  visibility: string | null
  archived_at: string | null
}

type ChallengeAccessRow = {
  challenge_id: string
}

type ResolvedChallengePeriodRow = {
  is_eligible?: boolean | null
  period_key?: string | null
  period_start?: string | null
  period_end?: string | null
}

function getMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function isSupportedPeriodType(value: string | null | undefined): value is DashboardActiveChallenge['period_type'] {
  return value === 'lifetime' || value === 'challenge' || value === 'weekly' || value === 'monthly'
}

function isSupportedGoalUnit(value: string | null | undefined): value is DashboardActiveChallenge['goal_unit'] {
  return value === 'distance_km' || value === 'run_count'
}

function toSafeNumber(value: number | string | null | undefined) {
  const normalized = Number(value ?? 0)
  return Number.isFinite(normalized) ? normalized : 0
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function isTimestampInsideWindow(runTimestamp: number, periodStart: string | null, periodEnd: string | null) {
  const startTimestamp = toTimestamp(periodStart)
  const endTimestamp = toTimestamp(periodEnd)

  if (startTimestamp !== null && runTimestamp < startTimestamp) {
    return false
  }

  if (endTimestamp !== null && runTimestamp >= endTimestamp) {
    return false
  }

  return true
}

function getChallengePriority(periodType: DashboardActiveChallenge['period_type']) {
  if (periodType === 'challenge') return 0
  if (periodType === 'weekly') return 1
  if (periodType === 'monthly') return 2
  return 3
}

function compareChallengesByPriority(left: Pick<ChallengeListItem, 'period_type' | 'period_end' | 'created_at'>, right: Pick<ChallengeListItem, 'period_type' | 'period_end' | 'created_at'>) {
  const priorityDelta = getChallengePriority(left.period_type) - getChallengePriority(right.period_type)

  if (priorityDelta !== 0) {
    return priorityDelta
  }

  if (left.period_type === 'challenge' && right.period_type === 'challenge') {
    const leftEnd = toTimestamp(left.period_end) ?? Number.MAX_SAFE_INTEGER
    const rightEnd = toTimestamp(right.period_end) ?? Number.MAX_SAFE_INTEGER

    if (leftEnd !== rightEnd) {
      return leftEnd - rightEnd
    }
  }

  const leftCreatedAt = toTimestamp(left.created_at) ?? 0
  const rightCreatedAt = toTimestamp(right.created_at) ?? 0

  return leftCreatedAt - rightCreatedAt
}

function compareUpcomingChallenges(left: ChallengeListItem, right: ChallengeListItem) {
  const leftStart = toTimestamp(left.period_start) ?? Number.MAX_SAFE_INTEGER
  const rightStart = toTimestamp(right.period_start) ?? Number.MAX_SAFE_INTEGER

  if (leftStart !== rightStart) {
    return leftStart - rightStart
  }

  return compareChallengesByPriority(left, right)
}

async function resolveChallengePeriod(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  challenge: ChallengeRow,
  referenceAt: string
): Promise<ResolvedChallengePeriodRow | null> {
  const { data, error } = await supabaseAdmin.rpc('resolve_challenge_period_window', {
    p_period_type: challenge.period_type,
    p_starts_at: challenge.starts_at,
    p_ends_at: challenge.end_at,
    p_reference_at: referenceAt,
  })

  if (error) {
    throw error
  }

  return ((data as ResolvedChallengePeriodRow[] | null) ?? [])[0] ?? null
}

function getResolvedPeriodCacheKey(challenge: ChallengeRow, referenceAt: string) {
  return [
    challenge.period_type ?? '',
    challenge.starts_at ?? '',
    challenge.end_at ?? '',
    referenceAt,
  ].join('|')
}

function getWindowCacheKey(periodStart: string | null, periodEnd: string | null) {
  return `${periodStart ?? ''}|${periodEnd ?? ''}`
}

function getWindowRunTotals(
  normalizedRuns: NormalizedRunRow[],
  periodStart: string | null,
  periodEnd: string | null,
  windowTotalsCache: Map<string, { distanceKm: number; runCount: number }>
) {
  const cacheKey = getWindowCacheKey(periodStart, periodEnd)
  const cachedTotals = windowTotalsCache.get(cacheKey)

  if (cachedTotals) {
    return cachedTotals
  }

  const totals = normalizedRuns.reduce((accumulator, run) => {
    if (!isTimestampInsideWindow(run.timestamp, periodStart, periodEnd)) {
      return accumulator
    }

    accumulator.distanceKm += run.distanceKm
    accumulator.runCount += 1
    return accumulator
  }, {
    distanceKm: 0,
    runCount: 0,
  })

  windowTotalsCache.set(cacheKey, totals)
  return totals
}

function getChallengeStatus(
  periodType: DashboardActiveChallenge['period_type'],
  periodStart: string | null,
  periodEnd: string | null,
  referenceTimestamp: number,
  isCompleted: boolean
): 'active' | 'upcoming' | 'completed' | null {
  if (periodType === 'challenge') {
    const startTimestamp = toTimestamp(periodStart)
    const endTimestamp = toTimestamp(periodEnd)

    if (startTimestamp === null || endTimestamp === null || endTimestamp <= startTimestamp) {
      return null
    }

    if (referenceTimestamp < startTimestamp) {
      return 'upcoming'
    }

    if (referenceTimestamp >= endTimestamp) {
      return null
    }
  }

  return isCompleted ? 'completed' : 'active'
}

function stripInternalChallenge(challenge: ChallengeListItem): DashboardActiveChallenge {
  return {
    id: challenge.id,
    title: challenge.title,
    badge_url: challenge.badge_url ?? null,
    period_type: challenge.period_type,
    goal_unit: challenge.goal_unit,
    goal_target: challenge.goal_target,
    progress_value: challenge.progress_value,
    percent: challenge.percent,
    isCompleted: challenge.isCompleted,
    period_start: challenge.period_start,
    period_end: challenge.period_end,
  }
}

function buildChallengesOverview(
  challenges: ChallengeListItem[],
  options?: { includeCompleted?: boolean }
): ChallengesOverview {
  const includeCompleted = options?.includeCompleted ?? true

  return {
    active: challenges
      .filter((challenge) => challenge.status === 'active')
      .sort(compareChallengesByPriority),
    upcoming: challenges
      .filter((challenge) => challenge.status === 'upcoming')
      .sort(compareUpcomingChallenges),
    completed: includeCompleted
      ? challenges
        .filter((challenge) => challenge.status === 'completed')
        .sort(compareChallengesByPriority)
      : [],
  }
}

export async function loadChallengesOverviewServer(
  userId: string,
  options?: {
    supabaseAdmin?: ReturnType<typeof createSupabaseAdminClient>
    referenceAt?: Date
    runRows?: RunRow[]
    includeCompleted?: boolean
  }
): Promise<ChallengesOverview> {
  const supabaseAdmin = options?.supabaseAdmin ?? createSupabaseAdminClient()
  const referenceAt = options?.referenceAt ?? new Date()
  const referenceAtIso = referenceAt.toISOString()
  const referenceTimestamp = referenceAt.getTime()
  const runRows = options?.runRows ?? await (async () => {
    const { data, error } = await supabaseAdmin
      .from('runs')
      .select('distance_km, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      throw error
    }

    return (data as RunRow[] | null) ?? []
  })()
  const normalizedRuns = runRows.flatMap((run) => {
    const timestamp = toTimestamp(run.created_at)

    if (timestamp === null) {
      return []
    }

    return [{
      distanceKm: toSafeNumber(run.distance_km),
      timestamp,
    } satisfies NormalizedRunRow]
  })

  const [
    { data: challenges, error: challengesError },
    { data: accessRows, error: accessRowsError },
  ] = await Promise.all([
    supabaseAdmin
      .from('challenges')
      .select('id, title, description, badge_url, period_type, goal_unit, goal_target, xp_reward, starts_at, end_at, created_at, visibility, archived_at')
      .is('archived_at', null)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('challenge_access_users')
      .select('challenge_id')
      .eq('user_id', userId),
  ])

  if (challengesError || accessRowsError) {
    throw new Error('Не удалось загрузить челленджи')
  }

  const challengeRows = (challenges as ChallengeRow[] | null) ?? []
  const accessibleRestrictedChallengeIds = new Set(
    ((accessRows as ChallengeAccessRow[] | null) ?? []).map((row) => row.challenge_id)
  )
  const accessibleChallenges = challengeRows.filter((challenge) => {
    const visibility = challenge.visibility ?? 'public'
    return visibility === 'public' || accessibleRestrictedChallengeIds.has(challenge.id)
  })
  const candidateChallenges = accessibleChallenges.flatMap((challenge) => {
    if (!isSupportedPeriodType(challenge.period_type) || !isSupportedGoalUnit(challenge.goal_unit)) {
      return []
    }

    const goalTarget = toSafeNumber(challenge.goal_target)

    if (goalTarget <= 0) {
      return []
    }

    return [{
      challenge,
      goalTarget,
    }]
  })
  const resolvedPeriodCache = new Map<string, Promise<ResolvedChallengePeriodRow | null>>()
  const resolvedPeriods = await Promise.all(
    candidateChallenges.map(async ({ challenge, goalTarget }) => {
      const cacheKey = getResolvedPeriodCacheKey(challenge, referenceAtIso)
      let resolvedPeriodPromise = resolvedPeriodCache.get(cacheKey)

      if (!resolvedPeriodPromise) {
        resolvedPeriodPromise = resolveChallengePeriod(supabaseAdmin, challenge, referenceAtIso)
        resolvedPeriodCache.set(cacheKey, resolvedPeriodPromise)
      }

      return {
        challenge,
        goalTarget,
        resolvedPeriod: await resolvedPeriodPromise,
      }
    })
  )
  const windowTotalsCache = new Map<string, { distanceKm: number; runCount: number }>()

  const challengeItems = resolvedPeriods.flatMap(({ challenge, goalTarget, resolvedPeriod }) => {
    if (!resolvedPeriod?.is_eligible) {
      return []
    }

    if (!isSupportedPeriodType(challenge.period_type)) {
      return []
    }

    const periodType = challenge.period_type
    const periodStart = resolvedPeriod.period_start ?? null
    const periodEnd = resolvedPeriod.period_end ?? null
    const windowTotals = getWindowRunTotals(normalizedRuns, periodStart, periodEnd, windowTotalsCache)
    const progressValue = challenge.goal_unit === 'distance_km'
      ? windowTotals.distanceKm
      : windowTotals.runCount
    const percent = Math.min((progressValue / goalTarget) * 100, 100)
    const isCompleted = progressValue >= goalTarget
    const status = getChallengeStatus(
      periodType,
      periodStart,
      periodEnd,
      referenceTimestamp,
      isCompleted
    )

    if (status === null) {
      return []
    }

    if (!options?.includeCompleted && status === 'completed') {
      return []
    }

    return [{
      id: challenge.id,
      title: challenge.title?.trim() || 'Челлендж',
      description: challenge.description?.trim() || null,
      badge_url: challenge.badge_url ?? null,
      xp_reward: toSafeNumber(challenge.xp_reward),
      period_type: periodType,
      goal_unit: challenge.goal_unit,
      goal_target: goalTarget,
      progress_value: progressValue,
      percent: Number.isFinite(percent) ? percent : 0,
      isCompleted,
      status,
      period_start: periodStart,
      period_end: periodEnd,
      created_at: challenge.created_at ?? null,
    } satisfies ChallengeListItem]
  })

  return buildChallengesOverview(challengeItems, {
    includeCompleted: options?.includeCompleted,
  })
}

export async function loadDashboardOverviewServer(
  userId: string,
  options?: { includeChallenges?: boolean }
): Promise<DashboardOverview> {
  const supabaseAdmin = createSupabaseAdminClient()
  const includeChallenges = options?.includeChallenges ?? true
  const referenceAt = new Date()

  const [
    { data: profile, error: profileError },
    { data: runs, error: runsError },
  ] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('name, nickname, email, total_xp')
      .eq('id', userId)
      .maybeSingle(),
    supabaseAdmin
      .from('runs')
      .select('distance_km, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
  ])

  if (profileError || runsError) {
    throw new Error('Не удалось загрузить дашборд')
  }

  const profileRow = (profile as ProfileRow | null) ?? null
  const runRows = (runs as RunRow[] | null) ?? []

  const monthStartTimestamp = getMonthStart(referenceAt).getTime()
  const totalKmThisMonth = runRows.reduce((sum, run) => {
    const runTimestamp = toTimestamp(run.created_at)
    if (runTimestamp === null || runTimestamp < monthStartTimestamp) {
      return sum
    }

    return sum + toSafeNumber(run.distance_km)
  }, 0)

  if (!includeChallenges) {
    return {
      stats: {
        totalKmThisMonth,
        runsCount: runRows.length,
        totalXp: toSafeNumber(profileRow?.total_xp ?? 0),
      },
      profileSummary: {
        name: profileRow?.name?.trim() || null,
        nickname: profileRow?.nickname?.trim() || null,
        email: profileRow?.email ?? null,
      },
      activeChallenges: [],
      allChallengesCompleted: false,
    }
  }

  const challengesOverview = await loadChallengesOverviewServer(userId, {
    supabaseAdmin,
    referenceAt,
    runRows,
  })
  const sortedChallenges = [
    ...challengesOverview.active,
    ...challengesOverview.completed,
  ].sort(compareChallengesByPriority)
  const incompleteChallenges = sortedChallenges.filter((challenge) => !challenge.isCompleted)

  return {
    stats: {
      totalKmThisMonth,
      runsCount: runRows.length,
      totalXp: toSafeNumber(profileRow?.total_xp ?? 0),
    },
    profileSummary: {
      name: profileRow?.name?.trim() || null,
      nickname: profileRow?.nickname?.trim() || null,
      email: profileRow?.email ?? null,
    },
    activeChallenges: sortedChallenges.map(stripInternalChallenge),
    allChallengesCompleted: sortedChallenges.length > 0 && incompleteChallenges.length === 0,
  }
}
