export type Challenge = {
  id: string
  title: string
  description: string | null
  goal_km: number | null
  goal_runs: number | null
  xp_reward?: number | null
  created_at?: string | null
  kind?: string | null
}

export type RunRecord = {
  distance_km: number | null
  created_at: string
}

export type ChallengeKind = 'weekly' | 'monthly' | 'milestone'

export type ChallengeProgressMetric = {
  label: string
  percent: number
  completed: boolean
}

export type ChallengeWithProgress = Challenge & {
  kind: ChallengeKind
  progressItems: ChallengeProgressMetric[]
  isCompleted: boolean
}

function formatProgressValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function normalizeChallengeText(challenge: Pick<Challenge, 'title' | 'description' | 'kind'>) {
  return [challenge.kind, challenge.title, challenge.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function getChallengeKind(challenge: Pick<Challenge, 'title' | 'description' | 'kind'>): ChallengeKind {
  const normalized = normalizeChallengeText(challenge)

  if (
    normalized.includes('weekly') ||
    normalized.includes('week') ||
    normalized.includes('еженед') ||
    normalized.includes('недел')
  ) {
    return 'weekly'
  }

  if (
    normalized.includes('monthly') ||
    normalized.includes('month') ||
    normalized.includes('ежемесяч') ||
    normalized.includes('месяц')
  ) {
    return 'monthly'
  }

  return 'milestone'
}

function getChallengeKindPriority(kind: ChallengeKind) {
  if (kind === 'weekly') return 0
  if (kind === 'monthly') return 1
  return 2
}

export function sortChallengesByPriority<T extends { kind: ChallengeKind; created_at?: string | null }>(items: T[]) {
  return [...items].sort((left, right) => {
    const priorityDelta = getChallengeKindPriority(left.kind) - getChallengeKindPriority(right.kind)

    if (priorityDelta !== 0) {
      return priorityDelta
    }

    const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0
    const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0

    return leftTime - rightTime
  })
}

export function isAchievementChallenge(challenge: Pick<ChallengeWithProgress, 'kind'>) {
  return challenge.kind === 'milestone'
}

export function getChallengeProgress(challenge: Challenge, runs: RunRecord[]): ChallengeWithProgress {
  const totalKm = runs.reduce((sum, run) => sum + Number(run.distance_km ?? 0), 0)
  const totalRuns = runs.length
  const progressItems: ChallengeProgressMetric[] = []

  if (challenge.goal_km != null && challenge.goal_km > 0) {
    progressItems.push({
      label: `${formatProgressValue(totalKm)} / ${formatProgressValue(challenge.goal_km)} км`,
      percent: Math.min((totalKm / challenge.goal_km) * 100, 100),
      completed: totalKm >= challenge.goal_km,
    })
  }

  if (challenge.goal_runs != null && challenge.goal_runs > 0) {
    progressItems.push({
      label: `${totalRuns} / ${challenge.goal_runs} тренировок`,
      percent: Math.min((totalRuns / challenge.goal_runs) * 100, 100),
      completed: totalRuns >= challenge.goal_runs,
    })
  }

  return {
    ...challenge,
    kind: getChallengeKind(challenge),
    progressItems,
    isCompleted: progressItems.some((item) => item.completed),
  }
}
