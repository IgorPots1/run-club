import 'server-only'

import { createSupabaseAdminClient } from './supabase-admin'
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
  period_type: string | null
  goal_unit: string | null
  goal_target: number | string | null
  starts_at: string | null
  end_at: string | null
  created_at: string | null
  visibility: string | null
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

type InternalDashboardChallenge = DashboardActiveChallenge & {
  created_at: string | null
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

function isChallengeWindowCurrent(
  periodType: DashboardActiveChallenge['period_type'],
  periodStart: string | null,
  periodEnd: string | null,
  referenceTimestamp: number
) {
  if (periodType !== 'challenge') {
    return true
  }

  const startTimestamp = toTimestamp(periodStart)
  const endTimestamp = toTimestamp(periodEnd)

  if (startTimestamp === null || endTimestamp === null || endTimestamp <= startTimestamp) {
    return false
  }

  return referenceTimestamp >= startTimestamp && referenceTimestamp < endTimestamp
}

function getChallengePriority(periodType: DashboardActiveChallenge['period_type']) {
  if (periodType === 'challenge') return 0
  if (periodType === 'weekly') return 1
  if (periodType === 'monthly') return 2
  return 3
}

function compareActiveChallenges(left: InternalDashboardChallenge, right: InternalDashboardChallenge) {
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

function stripInternalChallenge(challenge: InternalDashboardChallenge): DashboardActiveChallenge {
  return {
    id: challenge.id,
    title: challenge.title,
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

export async function loadDashboardOverviewServer(userId: string): Promise<DashboardOverview> {
  const supabaseAdmin = createSupabaseAdminClient()
  const referenceAt = new Date()
  const referenceAtIso = referenceAt.toISOString()
  const referenceTimestamp = referenceAt.getTime()

  const [
    { data: profile, error: profileError },
    { data: runs, error: runsError },
    { data: challenges, error: challengesError },
    { data: accessRows, error: accessRowsError },
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
    supabaseAdmin
      .from('challenges')
      .select('id, title, period_type, goal_unit, goal_target, starts_at, end_at, created_at, visibility')
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('challenge_access_users')
      .select('challenge_id')
      .eq('user_id', userId),
  ])

  if (profileError || runsError || challengesError || accessRowsError) {
    throw new Error('Не удалось загрузить дашборд')
  }

  const profileRow = (profile as ProfileRow | null) ?? null
  const runRows = (runs as RunRow[] | null) ?? []
  const challengeRows = (challenges as ChallengeRow[] | null) ?? []
  const accessibleRestrictedChallengeIds = new Set(
    ((accessRows as ChallengeAccessRow[] | null) ?? []).map((row) => row.challenge_id)
  )

  const monthStartTimestamp = getMonthStart(referenceAt).getTime()
  const totalKmThisMonth = runRows.reduce((sum, run) => {
    const runTimestamp = toTimestamp(run.created_at)
    if (runTimestamp === null || runTimestamp < monthStartTimestamp) {
      return sum
    }

    return sum + toSafeNumber(run.distance_km)
  }, 0)

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

    if (goalTarget <= 0) {
      return []
    }

    if (!resolvedPeriod?.is_eligible) {
      return []
    }

    const periodStart = resolvedPeriod.period_start ?? null
    const periodEnd = resolvedPeriod.period_end ?? null

    if (!isChallengeWindowCurrent(challenge.period_type, periodStart, periodEnd, referenceTimestamp)) {
      return []
    }

    const runsInWindow = runRows.filter((run) => isRunInsideWindow(run, periodStart, periodEnd))
    const progressValue = challenge.goal_unit === 'distance_km'
      ? runsInWindow.reduce((sum, run) => sum + toSafeNumber(run.distance_km), 0)
      : runsInWindow.length
    const percent = Math.min((progressValue / goalTarget) * 100, 100)

    return [{
      id: challenge.id,
      title: challenge.title?.trim() || 'Челлендж',
      period_type: challenge.period_type,
      goal_unit: challenge.goal_unit,
      goal_target: goalTarget,
      progress_value: progressValue,
      percent: Number.isFinite(percent) ? percent : 0,
      isCompleted: progressValue >= goalTarget,
      period_start: periodStart,
      period_end: periodEnd,
      created_at: challenge.created_at ?? null,
    } satisfies InternalDashboardChallenge]
  })

  const activeChallenges = [...challengeItems]
    .filter((challenge) => !challenge.isCompleted)
    .sort(compareActiveChallenges)

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
    activeChallenges: activeChallenges.map(stripInternalChallenge),
    allChallengesCompleted: challengeItems.length > 0 && activeChallenges.length === 0,
  }
}
