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

function isRunInsideWindow(run: RunRow, periodStart: string | null, periodEnd: string | null) {
  const runTimestamp = toTimestamp(run.created_at)

  if (runTimestamp === null) {
    return false
  }

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

function buildChallengesOverview(challenges: ChallengeListItem[]): ChallengesOverview {
  return {
    active: challenges
      .filter((challenge) => challenge.status === 'active')
      .sort(compareChallengesByPriority),
    upcoming: challenges
      .filter((challenge) => challenge.status === 'upcoming')
      .sort(compareUpcomingChallenges),
    completed: challenges
      .filter((challenge) => challenge.status === 'completed')
      .sort(compareChallengesByPriority),
  }
}

export async function loadChallengesOverviewServer(
  userId: string,
  options?: {
    supabaseAdmin?: ReturnType<typeof createSupabaseAdminClient>
    referenceAt?: Date
    runRows?: RunRow[]
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
  const resolvedPeriods = await Promise.all(
    accessibleChallenges.map(async (challenge) => ({
      challenge,
      resolvedPeriod: await resolveChallengePeriod(supabaseAdmin, challenge, referenceAtIso),
    }))
  )

  const challengeItems = resolvedPeriods.flatMap(({ challenge, resolvedPeriod }) => {
    if (!isSupportedPeriodType(challenge.period_type) || !isSupportedGoalUnit(challenge.goal_unit)) {
      return []
    }

    const goalTarget = toSafeNumber(challenge.goal_target)

    if (goalTarget <= 0 || !resolvedPeriod?.is_eligible) {
      return []
    }

    const periodStart = resolvedPeriod.period_start ?? null
    const periodEnd = resolvedPeriod.period_end ?? null
    const runsInWindow = runRows.filter((run) => isRunInsideWindow(run, periodStart, periodEnd))
    const progressValue = challenge.goal_unit === 'distance_km'
      ? runsInWindow.reduce((sum, run) => sum + toSafeNumber(run.distance_km), 0)
      : runsInWindow.length
    const percent = Math.min((progressValue / goalTarget) * 100, 100)
    const isCompleted = progressValue >= goalTarget
    const status = getChallengeStatus(
      challenge.period_type,
      periodStart,
      periodEnd,
      referenceTimestamp,
      isCompleted
    )

    if (status === null) {
      return []
    }

    return [{
      id: challenge.id,
      title: challenge.title?.trim() || 'Челлендж',
      description: challenge.description?.trim() || null,
      badge_url: challenge.badge_url ?? null,
      xp_reward: toSafeNumber(challenge.xp_reward),
      period_type: challenge.period_type,
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

  return buildChallengesOverview(challengeItems)
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
