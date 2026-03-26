import { redirect } from 'next/navigation'
import DashboardPageClient from './DashboardPageClient'
import { getChallengeProgress, sortChallengesByPriority, type Challenge, type ChallengeWithProgress } from '@/lib/challenges'
import { createSupabaseServerClient, getAuthenticatedUser } from '@/lib/supabase-server'
import { getLevelProgressFromXP } from '@/lib/xp'

type ProfileSummaryRow = {
  name: string | null
  nickname: string | null
  email: string | null
}

type RunSummaryRow = {
  id: string
  distance_km: number | null
  xp: number | null
  created_at: string
}

type UserChallengeRow = {
  challenge_id: string
}

type ChallengeRewardRow = {
  id: string
  xp_reward: number | null
}

type RunLikeRow = {
  run_id: string
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
    { data: userChallenges },
    { data: challenges },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('name, nickname, email')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('runs')
      .select('id, distance_km, xp, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('user_challenges')
      .select('challenge_id')
      .eq('user_id', user.id),
    supabase
      .from('challenges')
      .select('id, title, description, goal_km, goal_runs, xp_reward, created_at, kind')
      .order('created_at', { ascending: true }),
  ])

  const initialProfileSummary = (profile as ProfileSummaryRow | null) ?? {
    name: null,
    nickname: null,
    email: null,
  }
  const runRows = (runs as RunSummaryRow[] | null) ?? []
  const userChallengeRows = (userChallenges as UserChallengeRow[] | null) ?? []
  const challengeIds = Array.from(new Set(userChallengeRows.map((item) => item.challenge_id)))
  const runIds = runRows.map((run) => run.id)

  const [
    challengeRewards,
    likes,
  ] = await Promise.all([
    challengeIds.length > 0
      ? supabase
          .from('challenges')
          .select('id, xp_reward')
          .in('id', challengeIds)
      : Promise.resolve({ data: [] as ChallengeRewardRow[] }),
    runIds.length > 0
      ? supabase
          .from('run_likes')
          .select('run_id')
          .in('run_id', runIds)
      : Promise.resolve({ data: [] as RunLikeRow[] }),
  ])

  const challengeRewardById = Object.fromEntries(
    ((challengeRewards.data as ChallengeRewardRow[] | null) ?? []).map((challenge) => [
      challenge.id,
      Number(challenge.xp_reward ?? 0),
    ])
  )
  const monthStart = getMonthStart(new Date()).getTime()
  const totalKmThisMonth = runRows.reduce((sum, run) => {
    const runTime = new Date(run.created_at).getTime()
    return runTime >= monthStart ? sum + Number(run.distance_km ?? 0) : sum
  }, 0)
  const totalRunXp = runRows.reduce((sum, run) => sum + Number(run.xp ?? 0), 0)
  const totalChallengeXp = userChallengeRows.reduce((sum, item) => {
    return sum + Number(challengeRewardById[item.challenge_id] ?? 0)
  }, 0)
  const totalLikeXp = (((likes.data as RunLikeRow[] | null) ?? []).length) * 5
  const totalXp = totalRunXp + totalChallengeXp + totalLikeXp
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
