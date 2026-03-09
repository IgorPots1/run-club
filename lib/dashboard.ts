import { getChallengeProgress, type Challenge, type ChallengeWithProgress, type RunRecord } from './challenges'
import { loadLikeXpByUser, loadLikeXpByUserIds } from './likes-xp'
import { loadRunLikesSummary, loadRunLikesSummaryForRunIds } from './run-likes'
import { supabase } from './supabase'
import { loadChallengeXpByUser, loadChallengeXpByUserIds } from './user-challenges'

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
  duration_minutes: number | null
  xp: number | null
  created_at: string
}

export type DashboardRunItem = {
  id: string
  user_id: string
  title: string
  distance_km: number
  pace: string | number | null
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

export type FeedRunPage = {
  items: FeedRunItem[]
  hasMore: boolean
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

async function safeLoadRunLikesSummary(currentUserId: string | null) {
  try {
    return await loadRunLikesSummary(currentUserId)
  } catch {
    return {
      likesByRunId: {},
      likedRunIds: new Set<string>(),
    }
  }
}

function getMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function formatPace(distanceKm: number, durationMinutes: number | null) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null
  if (!Number.isFinite(Number(durationMinutes)) || Number(durationMinutes) <= 0) return null

  const totalSeconds = Math.round(Number(durationMinutes) * 60)
  const paceSeconds = Math.round(totalSeconds / distanceKm)
  const minutes = Math.floor(paceSeconds / 60)
  const seconds = paceSeconds % 60

  return `${minutes}:${String(seconds).padStart(2, '0')}`
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
      .select('id, user_id, title, distance_km, duration_minutes, xp, created_at')
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, name, email, avatar_url'),
    safeLoadRunLikesSummary(currentUserId),
  ])

  if (runsError) {
    throw new Error('Не удалось загрузить тренировки')
  }

  const profileById = profilesError
    ? {}
    : Object.fromEntries(((profiles as ProfileRow[] | null) ?? []).map((profile) => [profile.id, profile]))

  return ((runs as RunRow[] | null) ?? []).map((run) => {
    const profile = profileById[run.user_id]
    const mappedTitle = run.title || 'Тренировка'

    return {
      id: run.id,
      user_id: run.user_id,
      title: mappedTitle,
      distance_km: Number(run.distance_km ?? 0),
      pace: formatPace(Number(run.distance_km ?? 0), run.duration_minutes ?? null),
      xp: Number(run.xp ?? 0),
      created_at: run.created_at,
      displayName: profile?.name?.trim() || profile?.email || 'Бегун',
      avatar_url: profile?.avatar_url ?? null,
      likesCount: likesByRunId[run.id] ?? 0,
      likedByMe: likedRunIds.has(run.id),
    }
  })
}

export async function loadUserProfileSummary(userId: string): Promise<UserProfileSummary> {
  const { data, error } = await supabase.from('profiles').select('name, email').eq('id', userId).maybeSingle()

  if (error) {
    return {
      name: null,
      email: null,
    }
  }

  return {
    name: data?.name?.trim() || null,
    email: data?.email ?? null,
  }
}

export async function loadFeedRuns(
  currentUserId: string | null,
  start = 0,
  limit = 10
): Promise<FeedRunPage> {
  const end = start + limit - 1
  const { data: runs, error: runsError } = await supabase
    .from('runs')
    .select('id, user_id, title, distance_km, duration_minutes, xp, created_at')
    .order('created_at', { ascending: false })
    .range(start, end)

  if (runsError) {
    throw new Error('Не удалось загрузить ленту')
  }

  const pageRuns = (runs as RunRow[] | null) ?? []
  const userIds = Array.from(new Set(pageRuns.map((run) => run.user_id)))
  const runIds = pageRuns.map((run) => run.id)

  const [
    { data: profiles, error: profilesError },
    { data: userRuns, error: userRunsError },
    likesSummary,
    challengeXpByUser,
    likeXpByUser,
  ] = await Promise.all([
    userIds.length > 0
      ? supabase.from('profiles').select('id, name, email, avatar_url').in('id', userIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length > 0
      ? supabase.from('runs').select('user_id, xp').in('user_id', userIds)
      : Promise.resolve({ data: [], error: null }),
    loadRunLikesSummaryForRunIds(runIds, currentUserId),
    loadChallengeXpByUserIds(userIds),
    loadLikeXpByUserIds(userIds),
  ])

  const profileById = profilesError
    ? {}
    : Object.fromEntries(((profiles as ProfileRow[] | null) ?? []).map((profile) => [profile.id, profile]))

  const totalXpByUser: Record<string, number> = {}

  for (const run of (userRuns as Array<{ user_id: string; xp: number | null }> | null) ?? []) {
    totalXpByUser[run.user_id] = (totalXpByUser[run.user_id] ?? 0) + Number(run.xp ?? 0)
  }

  if (!userRunsError) {
    for (const [userId, xp] of Object.entries(challengeXpByUser)) {
      totalXpByUser[userId] = (totalXpByUser[userId] ?? 0) + xp
    }

    for (const [userId, xp] of Object.entries(likeXpByUser)) {
      totalXpByUser[userId] = (totalXpByUser[userId] ?? 0) + xp
    }
  }

  return {
    items: pageRuns.map((run) => {
      const profile = profileById[run.user_id]
      const mappedTitle = run.title || 'Тренировка'

      return {
        id: run.id,
        user_id: run.user_id,
        title: mappedTitle,
        distance_km: Number(run.distance_km ?? 0),
        pace: formatPace(Number(run.distance_km ?? 0), run.duration_minutes ?? null),
        xp: Number(run.xp ?? 0),
        created_at: run.created_at,
        displayName: profile?.name?.trim() || profile?.email || 'Бегун',
        avatar_url: profile?.avatar_url ?? null,
        totalXp: totalXpByUser[run.user_id] ?? 0,
        likesCount: likesSummary.likesByRunId[run.id] ?? 0,
        likedByMe: likesSummary.likedRunIds.has(run.id),
      }
    }),
    hasMore: pageRuns.length === limit,
  }
}
