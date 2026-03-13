import { getChallengeProgress, sortChallengesByPriority, type Challenge, type ChallengeWithProgress, type RunRecord } from './challenges'
import { loadLikeXpByUser, loadLikeXpByUserIds } from './likes-xp'
import { getProfileDisplayName } from './profiles'
import { loadRunLikesSummaryForRunIds } from './run-likes'
import { supabase } from './supabase'
import { loadChallengeXpByUser, loadChallengeXpByUserIds } from './user-challenges'

type ProfileRow = {
  id: string
  name: string | null
  nickname?: string | null
  email: string | null
  avatar_url?: string | null
}

type RunRow = {
  id: string
  user_id: string
  name: string | null
  title?: string | null
  external_source?: string | null
  distance_km: number | null
  duration_minutes: number | null
  xp: number | null
  created_at: string
}

export type DashboardRunItem = {
  id: string
  user_id: string
  title: string
  external_source?: string | null
  distance_km: number
  pace: string | number | null
  movingTime: string | null
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
  profileSummary: UserProfileSummary
  activeChallenge: ChallengeWithProgress | null
  allChallengesCompleted: boolean
}

export type UserProfileSummary = {
  name: string | null
  nickname: string | null
  email: string | null
}

const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000
const TOTAL_XP_CACHE_TTL_MS = 60 * 1000

const profileCache = new Map<string, { value: ProfileRow | null; expiresAt: number }>()
const totalXpCache = new Map<string, { value: number; expiresAt: number }>()

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

function formatMovingTime(durationMinutes: number | null) {
  if (!Number.isFinite(Number(durationMinutes)) || Number(durationMinutes) <= 0) {
    return null
  }

  const totalSeconds = Math.max(0, Math.round(Number(durationMinutes) * 60))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function getFreshCachedValue<T>(cacheEntry: { value: T; expiresAt: number } | undefined) {
  if (!cacheEntry || cacheEntry.expiresAt <= Date.now()) {
    return { found: false as const, value: null as T | null }
  }

  return { found: true as const, value: cacheEntry.value }
}

async function loadProfilesByUserIds(userIds: string[]) {
  if (userIds.length === 0) {
    return {} as Record<string, ProfileRow | null>
  }

  const uniqueUserIds = Array.from(new Set(userIds))
  const profileById: Record<string, ProfileRow | null> = {}
  const missingUserIds: string[] = []

  for (const userId of uniqueUserIds) {
    const cachedProfile = getFreshCachedValue(profileCache.get(userId))
    if (cachedProfile.found) {
      profileById[userId] = cachedProfile.value
    } else {
      missingUserIds.push(userId)
    }
  }

  if (missingUserIds.length > 0) {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, name, nickname, email, avatar_url')
      .in('id', missingUserIds)

    if (!error) {
      const fetchedProfiles = (profiles as ProfileRow[] | null) ?? []
      const fetchedProfileById = Object.fromEntries(fetchedProfiles.map((profile) => [profile.id, profile]))

      for (const userId of missingUserIds) {
        const profile = fetchedProfileById[userId] ?? null
        profileById[userId] = profile
        profileCache.set(userId, {
          value: profile,
          expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
        })
      }
    } else {
      for (const userId of missingUserIds) {
        profileById[userId] = null
      }
    }
  }

  return profileById
}

async function loadTotalXpByUserIds(userIds: string[]) {
  if (userIds.length === 0) {
    return {} as Record<string, number>
  }

  const uniqueUserIds = Array.from(new Set(userIds))
  const totalsByUserId: Record<string, number> = {}
  const missingUserIds: string[] = []

  for (const userId of uniqueUserIds) {
    const cachedTotalXp = getFreshCachedValue(totalXpCache.get(userId))
    if (cachedTotalXp.found) {
      totalsByUserId[userId] = cachedTotalXp.value ?? 0
    } else {
      missingUserIds.push(userId)
    }
  }

  if (missingUserIds.length === 0) {
    return totalsByUserId
  }

  const [
    { data: userRuns, error: userRunsError },
    challengeXpByUser,
    likeXpByUser,
  ] = await Promise.all([
    supabase.from('runs').select('user_id, xp').in('user_id', missingUserIds),
    loadChallengeXpByUserIds(missingUserIds),
    loadLikeXpByUserIds(missingUserIds),
  ])

  const runXpByUserId: Record<string, number> = {}

  for (const run of (userRuns as Array<{ user_id: string; xp: number | null }> | null) ?? []) {
    runXpByUserId[run.user_id] = (runXpByUserId[run.user_id] ?? 0) + Number(run.xp ?? 0)
  }

  for (const userId of missingUserIds) {
    const totalXp =
      (userRunsError ? 0 : runXpByUserId[userId] ?? 0) +
      (challengeXpByUser[userId] ?? 0) +
      (likeXpByUser[userId] ?? 0)

    totalsByUserId[userId] = totalXp
    totalXpCache.set(userId, {
      value: totalXp,
      expiresAt: Date.now() + TOTAL_XP_CACHE_TTL_MS,
    })
  }

  return totalsByUserId
}

export async function loadDashboardOverview(userId: string): Promise<DashboardOverview> {
  const [
    profileById,
    { data: myRuns, error: myRunsError },
    { data: challenges, error: challengesError },
    challengeXpByUser,
    likeXpByUser,
  ] = await Promise.all([
    loadProfilesByUserIds([userId]),
    supabase
      .from('runs')
      .select('distance_km, xp, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('challenges')
      .select('*')
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
  const challengeItems = ((challenges as Challenge[] | null) ?? []).map((challenge) => getChallengeProgress(challenge, currentUserRuns))
  const activeChallenges = sortChallengesByPriority(challengeItems.filter((challenge) => !challenge.isCompleted))
  const firstActiveChallenge = activeChallenges[0] ?? null
  const profile = profileById[userId]

  return {
    stats: {
      totalKmThisMonth,
      runsCount: currentUserRuns.length,
      totalXp: totalRunXp + (challengeXpByUser[userId] ?? 0) + (likeXpByUser[userId] ?? 0),
    },
    profileSummary: {
      name: profile?.name?.trim() || null,
      nickname: profile?.nickname?.trim() || null,
      email: profile?.email ?? null,
    },
    activeChallenge: firstActiveChallenge,
    allChallengesCompleted: challengeItems.length > 0 && activeChallenges.length === 0,
  }
}

export async function loadUserProfileSummary(userId: string): Promise<UserProfileSummary> {
  const profileById = await loadProfilesByUserIds([userId])
  const data = profileById[userId]

  if (!data) {
    return {
      name: null,
      nickname: null,
      email: null,
    }
  }

  return {
    name: data?.name?.trim() || null,
    nickname: data?.nickname?.trim() || null,
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
    .select('id, user_id, name, title, external_source, distance_km, duration_minutes, xp, created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(start, end)

  if (runsError) {
    throw new Error('Не удалось загрузить ленту')
  }

  const pageRuns = (runs as RunRow[] | null) ?? []
  const userIds = Array.from(new Set(pageRuns.map((run) => run.user_id)))
  const runIds = pageRuns.map((run) => run.id)

  const [
    profileById,
    totalXpByUser,
    likesSummary,
  ] = await Promise.all([
    loadProfilesByUserIds(userIds),
    loadTotalXpByUserIds(userIds),
    loadRunLikesSummaryForRunIds(runIds, currentUserId),
  ])

  return {
    items: pageRuns.map((run) => {
      const profile = profileById[run.user_id]
      const mappedTitle = run.name?.trim() || run.title?.trim() || 'Тренировка'

      return {
        id: run.id,
        user_id: run.user_id,
        title: mappedTitle,
        external_source: run.external_source ?? null,
        distance_km: Number(run.distance_km ?? 0),
        pace: formatPace(Number(run.distance_km ?? 0), run.duration_minutes ?? null),
        movingTime: formatMovingTime(run.duration_minutes ?? null),
        xp: Number(run.xp ?? 0),
        created_at: run.created_at,
        displayName: getProfileDisplayName(profile, 'Бегун'),
        avatar_url: profile?.avatar_url ?? null,
        totalXp: totalXpByUser[run.user_id] ?? 0,
        likesCount: likesSummary.likesByRunId[run.id] ?? 0,
        likedByMe: likesSummary.likedRunIds.has(run.id),
      }
    }),
    hasMore: pageRuns.length === limit,
  }
}
