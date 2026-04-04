export type DashboardActiveChallenge = {
  id: string
  title: string
  period_type: 'lifetime' | 'challenge' | 'weekly' | 'monthly'
  goal_unit: 'distance_km' | 'run_count'
  goal_target: number
  progress_value: number
  percent: number
  isCompleted: boolean
  period_start: string | null
  period_end: string | null
}

export type DashboardProgressStats = {
  totalKmThisMonth: number
  runsCount: number
  totalXp: number
}

export type UserProfileSummary = {
  name: string | null
  nickname: string | null
  email: string | null
}

export type DashboardOverview = {
  stats: DashboardProgressStats
  profileSummary: UserProfileSummary
  activeChallenge: DashboardActiveChallenge | null
  allChallengesCompleted: boolean
}
