export type Challenge = {
  id: string
  title: string
  description: string | null
  goal_km: number | null
  goal_runs: number | null
  xp_reward?: number | null
}

export type RunRecord = {
  distance_km: number | null
  created_at: string
}

export type ChallengeProgressMetric = {
  label: string
  percent: number
  completed: boolean
}

export type ChallengeWithProgress = Challenge & {
  progressItems: ChallengeProgressMetric[]
  isCompleted: boolean
}

export function getChallengeProgress(challenge: Challenge, runs: RunRecord[]): ChallengeWithProgress {
  const totalKm = runs.reduce((sum, run) => sum + Number(run.distance_km ?? 0), 0)
  const totalRuns = runs.length
  const progressItems: ChallengeProgressMetric[] = []

  if (challenge.goal_km != null && challenge.goal_km > 0) {
    progressItems.push({
      label: `${totalKm.toFixed(1)} / ${challenge.goal_km} км`,
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
    progressItems,
    isCompleted: progressItems.some((item) => item.completed),
  }
}
