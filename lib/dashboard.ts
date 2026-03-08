import { getChallengeProgress, type Challenge, type ChallengeWithProgress, type RunRecord } from './challenges'
import { loadLikeXpByUser } from './likes-xp'
import { loadRunLikesSummary } from './run-likes'
import { supabase } from './supabase'
import { loadChallengeXpByUser } from './user-challenges'

type ProfileRow = {
  id: string
  name: string | null
  email: string | null
  avatar_url?: string | null
}

type RunRow = {
  id: string
  user_id: string
  title: string | null
  distance_km: number | null
  xp: number | null
  created_at: string
}

export type DashboardRunItem = {
  id: string
  user_id: string
  title: string
  distance_km: number
  xp: number
  created_at: string
  displayName: string
  avatar_url: string | null
  likesCount: number
  likedByMe: boolean
}

export type FeedRunItem = DashboardRunItem & {
  avatar_url: string | null
  totalXp: number
}

export type DashboardProgressStats = {
  totalKmThisMonth: number
  runsCount: number
  totalXp: number
}

export type DashboardOverview = {
  stats: DashboardProgressStats
  activeChallenge: ChallengeWithProgress | null
  allChallengesCompleted: boolean
}

export type UserProfileSummary = {
  name: string | null
  email: string | null
}

function getMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export async function loadDashboardOverview(userId: string): Promise<DashboardOverview> {
  const [
    { data: myRuns, error: myRunsError },
    { data: challenges, error: challengesError },
    challengeXpByUser,
    likeXpByUser,
  ] = await Promise.all([
    supabase
      .from('runs')
      .select('distance_km, xp, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('challenges')
      .select('id, title, description, goal_km, goal_runs, xp_reward')
      .order('created_at', { ascending: true }),
    loadChallengeXpByUser(),
    loadLikeXpByUser(),
  ])

  if (myRunsError || challengesError) {
    throw new Error('Не удалось загрузить дашборд')
  }

  const currentUserRuns = (myRuns as ({ xp: number | null } & RunRecord)[] | null) ?? []
  const monthStart = getMonthStart(new Date()).getTime()
  const totalKmThisMonth = currentUserRuns.reduce((sum, run) => {
    const runTime = new Date(run.created_at).getTime()
    return runTime >= monthStart ? sum + Number(run.distance_km ?? 0) : sum
  }, 0)
  const totalRunXp = currentUserRuns.reduce((sum, run) => sum + Number(run.xp ?? 0), 0)
  const challengeItems = ((challenges as Challenge[] | null) ?? []).map((challenge) =>
    getChallengeProgress(challenge, currentUserRuns)
  )
  const firstActiveChallenge = challengeItems.find((challenge) => !challenge.isCompleted) ?? null

  return {
    stats: {
      totalKmThisMonth,
      runsCount: currentUserRuns.length,
      totalXp: totalRunXp + (challengeXpByUser[userId] ?? 0) + (likeXpByUser[userId] ?? 0),
    },
    activeChallenge: firstActiveChallenge,
    allChallengesCompleted: challengeItems.length > 0 && !firstActiveChallenge,
  }
}

export async function loadDashboardRuns(currentUserId: string): Promise<DashboardRunItem[]> {
  const [
    { data: runs, error: runsError },
    { data: profiles, error: profilesError },
    { likesByRunId, likedRunIds },
  ] = await Promise.all([
    supabase
      .from('runs')
      .select('id, user_id, title, distance_km, xp, created_at')
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, name, email, avatar_url'),
    loadRunLikesSummary(currentUserId),
  ])

  if (runsError || profilesError) {
    throw new Error('Не удалось загрузить тренировки')
  }

  const profileById = Object.fromEntries(((profiles as ProfileRow[] | null) ?? []).map((profile) => [profile.id, profile]))

  return ((runs as RunRow[] | null) ?? []).map((run) => {
    const profile = profileById[run.user_id]
    const mappedTitle = run.title || 'Тренировка'

    return {
      id: run.id,
      user_id: run.user_id,
      title: mappedTitle,
      distance_km: Number(run.distance_km ?? 0),
      xp: Number(run.xp ?? 0),
      created_at: run.created_at,
      displayName: profile?.name?.trim() || profile?.email || '—',
      avatar_url: profile?.avatar_url ?? null,
      likesCount: likesByRunId[run.id] ?? 0,
      likedByMe: likedRunIds.has(run.id),
    }
  })
}

export async function loadUserProfileSummary(userId: string): Promise<UserProfileSummary> {
  const { data, error } = await supabase.from('profiles').select('name, email').eq('id', userId).maybeSingle()

  if (error) {
    throw new Error('Не удалось загрузить профиль')
  }

  return {
    name: data?.name?.trim() || null,
    email: data?.email ?? null,
  }
}

export async function loadFeedRuns(currentUserId: string | null): Promise<FeedRunItem[]> {
  const [
    { data: runs, error: runsError },
    { data: profiles, error: profilesError },
    { likesByRunId, likedRunIds },
    challengeXpByUser,
    likeXpByUser,
  ] = await Promise.all([
    supabase
      .from('runs')
      .select('id, user_id, title, distance_km, xp, created_at')
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, name, email, avatar_url'),
    loadRunLikesSummary(currentUserId),
    loadChallengeXpByUser(),
    loadLikeXpByUser(),
  ])

  if (runsError || profilesError) {
    throw new Error('Не удалось загрузить ленту')
  }

  const profileById = Object.fromEntries(((profiles as ProfileRow[] | null) ?? []).map((profile) => [profile.id, profile]))
  const totalXpByUser: Record<string, number> = {}

  for (const run of (runs as RunRow[] | null) ?? []) {
    totalXpByUser[run.user_id] = (totalXpByUser[run.user_id] ?? 0) + Number(run.xp ?? 0)
  }

  for (const [userId, xp] of Object.entries(challengeXpByUser)) {
    totalXpByUser[userId] = (totalXpByUser[userId] ?? 0) + xp
  }

  for (const [userId, xp] of Object.entries(likeXpByUser)) {
    totalXpByUser[userId] = (totalXpByUser[userId] ?? 0) + xp
  }

  return ((runs as RunRow[] | null) ?? []).map((run) => {
    const profile = profileById[run.user_id]
    const mappedTitle = run.title || 'Тренировка'

    return {
      id: run.id,
      user_id: run.user_id,
      title: mappedTitle,
      distance_km: Number(run.distance_km ?? 0),
      xp: Number(run.xp ?? 0),
      created_at: run.created_at,
      displayName: profile?.name?.trim() || profile?.email || '—',
      avatar_url: profile?.avatar_url ?? null,
      totalXp: totalXpByUser[run.user_id] ?? 0,
      likesCount: likesByRunId[run.id] ?? 0,
      likedByMe: likedRunIds.has(run.id),
    }
  })
}
