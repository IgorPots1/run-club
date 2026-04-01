import { redirect } from 'next/navigation'
import DashboardPageClient from './DashboardPageClient'
import { getChallengeProgress, sortChallengesByPriority, type Challenge, type ChallengeWithProgress } from '@/lib/challenges'
import { createSupabaseServerClient, getAuthenticatedUser } from '@/lib/supabase-server'
import { getLevelProgressFromXP } from '@/lib/xp'

type ProfileSummaryRow = {
  name: string | null
  nickname: string | null
  email: string | null
  total_xp: number | null
}

type RunSummaryRow = {
  distance_km: number | null
  created_at: string
}

function getMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export default async function DashboardPage() {
  const { user } = await getAuthenticatedUser()

  if (!user) {
    redirect('/login')
  }

  const supabase = await createSupabaseServerClient()
  const [
    { data: profile },
    { data: runs },
    { data: challenges },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('name, nickname, email, total_xp')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('runs')
      .select('distance_km, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('challenges')
      .select('id, title, description, goal_km, goal_runs, xp_reward, created_at, kind')
      .order('created_at', { ascending: true }),
  ])

  const initialProfileSummary = (profile as ProfileSummaryRow | null) ?? {
    name: null,
    nickname: null,
    email: null,
    total_xp: 0,
  }
  const runRows = (runs as RunSummaryRow[] | null) ?? []
  const monthStart = getMonthStart(new Date()).getTime()
  const totalKmThisMonth = runRows.reduce((sum, run) => {
    const runTime = new Date(run.created_at).getTime()
    return runTime >= monthStart ? sum + Number(run.distance_km ?? 0) : sum
  }, 0)
  const totalXp = Number(initialProfileSummary.total_xp ?? 0)
  const challengeItems = ((challenges as Challenge[] | null) ?? []).map((challenge) => getChallengeProgress(challenge, runRows))
  const activeChallenges = sortChallengesByPriority(challengeItems.filter((challenge) => !challenge.isCompleted))
  const initialActiveChallenge: ChallengeWithProgress | null = activeChallenges[0] ?? null
  const initialAllChallengesCompleted = challengeItems.length > 0 && activeChallenges.length === 0
  const initialLevelProgress = getLevelProgressFromXP(totalXp)

  return (
    <DashboardPageClient
      initialUser={{
        id: user.id,
        email: user.email ?? null,
      }}
      initialProfileSummary={{
        name: initialProfileSummary.name,
        nickname: initialProfileSummary.nickname,
        email: initialProfileSummary.email ?? user.email ?? null,
      }}
      initialStats={{
        totalKmThisMonth,
        runsCount: runRows.length,
        totalXp,
      }}
      initialLevelProgress={initialLevelProgress}
      initialActiveChallenge={initialActiveChallenge}
      initialAllChallengesCompleted={initialAllChallengesCompleted}
    />
  )
}
