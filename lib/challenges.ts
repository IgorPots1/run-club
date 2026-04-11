import type { DashboardActiveChallenge } from './dashboard-overview'

export type ChallengeStatus = 'active' | 'upcoming' | 'completed'
export type ChallengeKind = 'weekly' | 'monthly' | 'milestone'

export type ChallengeListItem = DashboardActiveChallenge & {
  description: string | null
  xp_reward: number
  created_at: string | null
  status: ChallengeStatus
}

export type ChallengesOverview = {
  active: ChallengeListItem[]
  upcoming: ChallengeListItem[]
  completed: ChallengeListItem[]
}

function buildEmptyChallengesOverview(): ChallengesOverview {
  return {
    active: [],
    upcoming: [],
    completed: [],
  }
}

function normalizeChallengeText(challenge: {
  title: string
  description: string | null
  kind?: string | null
}) {
  return [challenge.kind, challenge.title, challenge.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function getChallengeKind(challenge: {
  title: string
  description: string | null
  kind?: string | null
}): ChallengeKind {
  const normalized = normalizeChallengeText(challenge)

  if (
    normalized.includes('weekly')
    || normalized.includes('week')
    || normalized.includes('еженед')
    || normalized.includes('недел')
  ) {
    return 'weekly'
  }

  if (
    normalized.includes('monthly')
    || normalized.includes('month')
    || normalized.includes('ежемесяч')
    || normalized.includes('месяц')
  ) {
    return 'monthly'
  }

  return 'milestone'
}

function isChallengeStatus(value: unknown): value is ChallengeStatus {
  return value === 'active' || value === 'upcoming' || value === 'completed'
}

function isChallengeListItem(value: unknown): value is ChallengeListItem {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<ChallengeListItem>

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    (candidate.badge_url == null || typeof candidate.badge_url === 'string') &&
    (candidate.description == null || typeof candidate.description === 'string') &&
    (candidate.created_at == null || typeof candidate.created_at === 'string') &&
    typeof candidate.xp_reward === 'number' &&
    typeof candidate.goal_target === 'number' &&
    typeof candidate.progress_value === 'number' &&
    typeof candidate.percent === 'number' &&
    typeof candidate.isCompleted === 'boolean' &&
    isChallengeStatus(candidate.status) &&
    (candidate.period_start == null || typeof candidate.period_start === 'string') &&
    (candidate.period_end == null || typeof candidate.period_end === 'string') &&
    (candidate.period_type === 'lifetime'
      || candidate.period_type === 'challenge'
      || candidate.period_type === 'weekly'
      || candidate.period_type === 'monthly') &&
    (candidate.goal_unit === 'distance_km' || candidate.goal_unit === 'run_count')
  )
}

function isChallengesOverview(value: unknown): value is ChallengesOverview {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<ChallengesOverview>

  return (
    Array.isArray(candidate.active) &&
    Array.isArray(candidate.upcoming) &&
    Array.isArray(candidate.completed) &&
    candidate.active.every(isChallengeListItem) &&
    candidate.upcoming.every(isChallengeListItem) &&
    candidate.completed.every(isChallengeListItem)
  )
}

export async function loadChallengesOverview(options?: { includeCompleted?: boolean }): Promise<ChallengesOverview> {
  try {
    const includeCompleted = options?.includeCompleted ?? true
    const searchParams = new URLSearchParams()

    if (!includeCompleted) {
      searchParams.set('includeCompleted', 'false')
    }

    const response = await fetch(`/api/challenges/overview${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`, {
      credentials: 'include',
    })
    const payload = await response.json().catch(() => null) as unknown

    if (response.ok && isChallengesOverview(payload)) {
      return payload
    }

    console.error('[challenges] invalid overview payload', {
      status: response.status,
      payload,
    })
  } catch (error) {
    console.error('[challenges] failed to load overview', error)
  }

  return buildEmptyChallengesOverview()
}
