import type { DashboardOverview } from './dashboard-overview'
import { getProfileDisplayName } from './profiles'
import { loadRaceEventLikesSummaryForRaceEventIds } from './race-event-likes'
import { getPersonalRecordRaceEventIds } from './race-events'
import { loadEntityCommentVisibilitySummaryForEntityIds } from './run-comments'
import { loadRunLikesSummaryForRunIds } from './run-likes'
import { getRunXpBreakdownRows, type RunXpBreakdownRow } from './run-xp-presentation'
import { supabase } from './supabase'

type ProfileRow = {
  id: string
  name: string | null
  nickname?: string | null
  email?: string | null
  avatar_url?: string | null
  total_xp?: number | null
  app_access_status?: 'active' | 'blocked' | null
}

type RunRow = {
  id: string
  user_id: string
  name: string | null
  title?: string | null
  description?: string | null
  shoe_id?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
  external_source?: string | null
  distance_km: number | null
  duration_minutes: number | null
  duration_seconds?: number | null
  moving_time_seconds?: number | null
  elevation_gain_meters?: number | null
  map_polyline?: string | null
  xp: number | null
  xp_breakdown?: unknown
  created_at: string
}

type RunLinkedRaceEventRow = {
  id: string
  linked_run_id: string | null
  name: string
  race_date: string
  result_time_seconds: number | null
  target_time_seconds: number | null
  status?: string | null
}

type RunInsightHistoryRow = {
  id: string
  user_id: string
  distance_km: number | null
  duration_minutes?: number | null
  duration_seconds?: number | null
  moving_time_seconds?: number | null
  created_at: string
}

type RunPhotoRow = {
  id: string
  run_id: string
  public_url: string
  thumbnail_url: string | null
  sort_order: number
  created_at?: string | null
}

type AppEventFeedRow = {
  id: string
  type: 'race_event.created' | 'race_event.completed' | 'challenge.completed'
  actor_user_id: string | null
  entity_id: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

type PersonalRecordAppEventRow = {
  id: string
  entity_id: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

type FeedRaceEventCurrentRow = {
  id: string
  user_id: string
  name: string
  race_date: string
  linked_run_id: string | null
  distance_meters: number | null
  result_time_seconds: number | null
  target_time_seconds: number | null
  linked_run: {
    id: string
    name: string | null
    title?: string | null
    distance_km?: number | null
    moving_time_seconds?: number | null
    created_at?: string | null
  } | Array<{
    id: string
    name: string | null
    title?: string | null
    distance_km?: number | null
    moving_time_seconds?: number | null
    created_at?: string | null
  }> | null
}

export type FeedRunPhoto = {
  id: string
  public_url: string
  thumbnail_url: string | null
}

export type DashboardRunItem = {
  id: string
  user_id: string
  title: string
  description: string | null
  shoe_id: string | null
  city?: string | null
  country?: string | null
  external_source?: string | null
  distance_km: number
  pace: string | number | null
  movingTime: string | null
  map_polyline?: string | null
  xp: number
  xpBreakdownRows: RunXpBreakdownRow[]
  created_at: string
  displayName: string
  avatar_url: string | null
  likesCount: number
  commentsCount: number
  likedByMe: boolean
  photos: FeedRunPhoto[]
  insight: FeedRunInsight | null
  linkedRaceEvent: {
    id: string
    name: string
    raceDate: string
    resultTimeSeconds: number | null
    targetTimeSeconds: number | null
  } | null
}

export type FeedRunInsight = {
  type: 'personal_record' | 'best_pace_7d' | 'longest_14d' | 'longest_30d' | 'faster_than_average_10'
  label: string
}

export type FeedRunItem = DashboardRunItem & {
  avatar_url: string | null
  totalXp: number
}

export type FeedRaceEventItem = {
  id: string
  type: 'race_event.created' | 'race_event.completed'
  user_id: string
  raceEventId: string
  raceName: string
  raceDate: string | null
  distanceMeters: number | null
  resultTimeSeconds: number | null
  targetTimeSeconds: number | null
  isPersonalRecord: boolean
  created_at: string
  displayName: string
  avatar_url: string | null
  totalXp: number
  raceEventLikeCount: number
  raceEventLikedByViewer: boolean
  commentsCount: number
  linkedRun: {
    id: string
    name: string | null
    distanceKm: number | null
    movingTimeSeconds: number | null
    createdAt: string | null
  } | null
}

export type FeedChallengeItem = {
  id: string
  type: 'challenge.completed'
  user_id: string
  challengeId: string | null
  challengeTitle: string
  xpAwarded: number | null
  created_at: string
  displayName: string
  avatar_url: string | null
  totalXp: number
  targetPath: string | null
}

export type FeedItem =
  | ({ kind: 'run' } & FeedRunItem)
  | ({ kind: 'race_event' } & FeedRaceEventItem)
  | ({ kind: 'challenge' } & FeedChallengeItem)

export type FeedRunPage = {
  items: FeedItem[]
  hasMore: boolean
}

export type UserProfileSummary = {
  name: string | null
  nickname: string | null
  email: string | null
}

const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000
const TOTAL_XP_CACHE_TTL_MS = 60 * 1000
const RUN_INSIGHT_MIN_DISTANCE_KM = 3
const RUN_INSIGHT_BEST_PACE_WINDOW_DAYS = 7
const RUN_INSIGHT_LONGEST_14D_WINDOW_DAYS = 14
const RUN_INSIGHT_LONGEST_30D_WINDOW_DAYS = 30
const RUN_INSIGHT_LONGEST_MIN_DISTANCE_KM = 5
const RUN_INSIGHT_AVERAGE_RUN_COUNT = 10

const profileCache = new Map<string, { value: ProfileRow | null; expiresAt: number }>()
const totalXpCache = new Map<string, { value: number; expiresAt: number }>()

function formatPace(distanceKm: number, totalDurationSeconds: number | null) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null
  if (!Number.isFinite(Number(totalDurationSeconds)) || Number(totalDurationSeconds) <= 0) return null

  const totalSeconds = Math.round(Number(totalDurationSeconds))
  const paceSeconds = Math.round(totalSeconds / distanceKm)
  const minutes = Math.floor(paceSeconds / 60)
  const seconds = paceSeconds % 60

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatMovingTime(totalDurationSeconds: number | null) {
  if (!Number.isFinite(Number(totalDurationSeconds)) || Number(totalDurationSeconds) <= 0) {
    return null
  }

  const totalSeconds = Math.max(0, Math.round(Number(totalDurationSeconds)))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function toNullableTrimmedText(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

function asRecord(value: unknown) {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function getContextRecord(payload: Record<string, unknown> | null | undefined) {
  return asRecord(payload?.context)
}

function getPayloadPreviewRecord(payload: Record<string, unknown> | null | undefined) {
  return asRecord(asRecord(payload)?.preview)
}

function getPayloadTargetPath(payload: Record<string, unknown> | null | undefined) {
  const record = asRecord(payload)
  return typeof record?.targetPath === 'string' && record.targetPath.startsWith('/')
    ? record.targetPath
    : null
}

function getFeedLinkedRun(
  linkedRun:
    | FeedRaceEventCurrentRow['linked_run']
    | null
    | undefined
) {
  if (Array.isArray(linkedRun)) {
    return linkedRun[0] ?? null
  }

  return linkedRun ?? null
}

function parseFiniteNumber(value: unknown) {
  const numericValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function compareFeedItemsByCreatedAt(
  left: FeedItem,
  right: FeedItem
) {
  const createdAtComparison = right.created_at.localeCompare(left.created_at)

  if (createdAtComparison !== 0) {
    return createdAtComparison
  }

  return right.id.localeCompare(left.id)
}

type RunDurationFields = {
  moving_time_seconds?: number | null
  duration_seconds?: number | null
  duration_minutes?: number | null
}

function resolveDurationSeconds(run: RunDurationFields) {
  if (Number.isFinite(run.moving_time_seconds) && (run.moving_time_seconds ?? 0) > 0) {
    return Math.round(run.moving_time_seconds ?? 0)
  }

  if (Number.isFinite(run.duration_seconds) && (run.duration_seconds ?? 0) > 0) {
    return Math.round(run.duration_seconds ?? 0)
  }

  if (Number.isFinite(run.duration_minutes) && (run.duration_minutes ?? 0) > 0) {
    return Math.round(Number(run.duration_minutes ?? 0) * 60)
  }

  return null
}

function getRunCreatedAtMs(run: Pick<RunInsightHistoryRow, 'created_at'>) {
  const timestamp = new Date(run.created_at).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function getComparablePaceSeconds(
  run: Pick<RunInsightHistoryRow, 'distance_km' | 'moving_time_seconds' | 'duration_seconds' | 'duration_minutes'>
) {
  const distanceKm = Number(run.distance_km ?? 0)

  if (!Number.isFinite(distanceKm) || distanceKm < RUN_INSIGHT_MIN_DISTANCE_KM) {
    return null
  }

  const durationSeconds = resolveDurationSeconds(run)

  if (!Number.isFinite(durationSeconds) || (durationSeconds ?? 0) <= 0) {
    return null
  }

  const paceSeconds = Number(durationSeconds) / distanceKm
  return Number.isFinite(paceSeconds) && paceSeconds > 0 ? paceSeconds : null
}

function getPositiveDistanceKm(run: Pick<RunInsightHistoryRow, 'distance_km'>) {
  const distanceKm = Number(run.distance_km ?? 0)
  return Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : null
}

function getPersonalRecordDistanceLabel(distanceMeters: number) {
  switch (distanceMeters) {
    case 5000:
      return '5 км'
    case 10000:
      return '10 км'
    case 21097:
      return '21.1 км'
    case 42195:
      return '42.2 км'
    default:
      return `${Math.round(distanceMeters)} м`
  }
}

function getPersonalRecordDistanceMetersFromPayload(payload: Record<string, unknown> | null | undefined) {
  const context = getContextRecord(payload)
  const distanceMeters = parseFiniteNumber(context?.distanceMeters)
  return Number.isFinite(distanceMeters) && (distanceMeters ?? 0) > 0
    ? Math.round(Number(distanceMeters))
    : null
}

function buildPersonalRecordInsight(
  runId: string,
  personalRecordEventsByRunId: Map<string, PersonalRecordAppEventRow[]>
): FeedRunInsight | null {
  const personalRecordEvents = personalRecordEventsByRunId.get(runId) ?? []

  if (personalRecordEvents.length === 0) {
    return null
  }

  const bestEvent = personalRecordEvents.reduce<PersonalRecordAppEventRow | null>((bestValue, event) => {
    if (!bestValue) {
      return event
    }

    const bestDistanceMeters = getPersonalRecordDistanceMetersFromPayload(bestValue.payload) ?? 0
    const eventDistanceMeters = getPersonalRecordDistanceMetersFromPayload(event.payload) ?? 0

    if (eventDistanceMeters !== bestDistanceMeters) {
      return eventDistanceMeters > bestDistanceMeters ? event : bestValue
    }

    return event.created_at > bestValue.created_at ? event : bestValue
  }, null)

  const distanceMeters = getPersonalRecordDistanceMetersFromPayload(bestEvent?.payload)

  return {
    type: 'personal_record',
    label: distanceMeters
      ? `Новый рекорд ${getPersonalRecordDistanceLabel(distanceMeters)}`
      : 'Новый рекорд',
  }
}

function getPreviousWindowRuns<T extends RunInsightHistoryRow>(
  userRuns: T[],
  currentRunIndex: number,
  currentCreatedAtMs: number,
  windowDays: number,
  predicate: (candidateRun: T) => boolean
) {
  const windowStartMs = currentCreatedAtMs - windowDays * 24 * 60 * 60 * 1000

  return userRuns
    .slice(currentRunIndex + 1)
    .filter((candidateRun) => {
      const createdAtMs = getRunCreatedAtMs(candidateRun)

      return (
        createdAtMs != null &&
        createdAtMs >= windowStartMs &&
        createdAtMs <= currentCreatedAtMs &&
        predicate(candidateRun)
      )
    })
}

function buildLongestRunInsight(
  currentRun: RunInsightHistoryRow,
  userRuns: RunInsightHistoryRow[],
  currentRunIndex: number,
  currentCreatedAtMs: number
): FeedRunInsight | null {
  const currentDistanceKm = getPositiveDistanceKm(currentRun)

  if (
    currentDistanceKm == null
    || currentDistanceKm < RUN_INSIGHT_LONGEST_MIN_DISTANCE_KM
  ) {
    return null
  }

  const previousRuns14d = getPreviousWindowRuns(
    userRuns,
    currentRunIndex,
    currentCreatedAtMs,
    RUN_INSIGHT_LONGEST_14D_WINDOW_DAYS,
    (candidateRun) => getPositiveDistanceKm(candidateRun) != null
  )

  if (previousRuns14d.length > 0) {
    const maxPreviousDistanceKm14d = previousRuns14d.reduce((bestValue, candidateRun) => {
      const distanceKm = getPositiveDistanceKm(candidateRun)
      return distanceKm != null && distanceKm > bestValue ? distanceKm : bestValue
    }, 0)

    if (currentDistanceKm > maxPreviousDistanceKm14d) {
      return {
        type: 'longest_14d',
        label: 'Самая длинная за 14 дней',
      }
    }
  }

  const previousRuns30d = getPreviousWindowRuns(
    userRuns,
    currentRunIndex,
    currentCreatedAtMs,
    RUN_INSIGHT_LONGEST_30D_WINDOW_DAYS,
    (candidateRun) => getPositiveDistanceKm(candidateRun) != null
  )

  if (previousRuns30d.length === 0) {
    return null
  }

  const maxPreviousDistanceKm30d = previousRuns30d.reduce((bestValue, candidateRun) => {
    const distanceKm = getPositiveDistanceKm(candidateRun)
    return distanceKm != null && distanceKm > bestValue ? distanceKm : bestValue
  }, 0)

  if (currentDistanceKm > maxPreviousDistanceKm30d) {
    return {
      type: 'longest_30d',
      label: 'Самая длинная за 30 дней',
    }
  }

  return null
}

function buildRunInsight(
  run: RunRow,
  runsByUserId: Record<string, RunInsightHistoryRow[]>,
  runIndexById: Record<string, number>,
  personalRecordEventsByRunId: Map<string, PersonalRecordAppEventRow[]>
): FeedRunInsight | null {
  const personalRecordInsight = buildPersonalRecordInsight(run.id, personalRecordEventsByRunId)

  if (personalRecordInsight) {
    return personalRecordInsight
  }

  const userRuns = runsByUserId[run.user_id] ?? []

  if (userRuns.length < 2) {
    return null
  }

  const currentRunIndex = runIndexById[run.id]

  if (!Number.isInteger(currentRunIndex) || currentRunIndex < 0) {
    return null
  }

  const currentRun = userRuns[currentRunIndex]
  const currentCreatedAtMs = getRunCreatedAtMs(currentRun)

  if (currentCreatedAtMs == null) {
    return null
  }

  const currentPaceSeconds = getComparablePaceSeconds(currentRun)

  if (currentPaceSeconds != null) {
    const previousComparableRunsInWindow = getPreviousWindowRuns(
      userRuns,
      currentRunIndex,
      currentCreatedAtMs,
      RUN_INSIGHT_BEST_PACE_WINDOW_DAYS,
      (candidateRun) => getComparablePaceSeconds(candidateRun) != null
    )

    if (previousComparableRunsInWindow.length > 0) {
      const bestPreviousPaceSeconds = previousComparableRunsInWindow.reduce((bestValue, candidateRun) => {
        const paceSeconds = getComparablePaceSeconds(candidateRun)
        return paceSeconds != null && paceSeconds < bestValue ? paceSeconds : bestValue
      }, Number.POSITIVE_INFINITY)

      if (currentPaceSeconds < bestPreviousPaceSeconds) {
        return {
          type: 'best_pace_7d',
          label: 'Лучший темп за 7 дней',
        }
      }
    }
  }

  const longestRunInsight = buildLongestRunInsight(currentRun, userRuns, currentRunIndex, currentCreatedAtMs)

  if (longestRunInsight) {
    return longestRunInsight
  }

  if (currentPaceSeconds != null) {
    const previousComparableRuns = userRuns
      .slice(currentRunIndex + 1)
      .filter((candidateRun) => getComparablePaceSeconds(candidateRun) != null)
      .slice(0, RUN_INSIGHT_AVERAGE_RUN_COUNT)

    if (previousComparableRuns.length === RUN_INSIGHT_AVERAGE_RUN_COUNT) {
      const averagePreviousPaceSeconds =
        previousComparableRuns.reduce((sum, candidateRun) => {
          const paceSeconds = getComparablePaceSeconds(candidateRun)
          return sum + Number(paceSeconds ?? 0)
        }, 0) / RUN_INSIGHT_AVERAGE_RUN_COUNT

      if (currentPaceSeconds < averagePreviousPaceSeconds) {
        return {
          type: 'faster_than_average_10',
          label: 'Быстрее среднего за 10 тренировок',
        }
      }
    }
  }

  return null
}

type ProfileFieldSelection = {
  includeEmail?: boolean
  includeAvatarUrl?: boolean
}

function getProfileCacheKey(userId: string, options?: ProfileFieldSelection) {
  return [
    userId,
    options?.includeEmail === false ? 'no-email' : 'email',
    options?.includeAvatarUrl === false ? 'no-avatar' : 'avatar',
  ].join(':')
}

function getProfileSelectClause(options?: ProfileFieldSelection) {
  const fields = ['id', 'name', 'nickname', 'total_xp', 'app_access_status']

  if (options?.includeEmail !== false) {
    fields.push('email')
  }

  if (options?.includeAvatarUrl !== false) {
    fields.push('avatar_url')
  }

  return fields.join(', ')
}

function getFreshCachedValue<T>(cacheEntry: { value: T; expiresAt: number } | undefined) {
  if (!cacheEntry || cacheEntry.expiresAt <= Date.now()) {
    return { found: false as const, value: null as T | null }
  }

  return { found: true as const, value: cacheEntry.value }
}

async function loadProfilesByUserIds(userIds: string[], options?: ProfileFieldSelection) {
  if (userIds.length === 0) {
    return {} as Record<string, ProfileRow | null>
  }

  const uniqueUserIds = Array.from(new Set(userIds))
  const profileById: Record<string, ProfileRow | null> = {}
  const missingUserIds: string[] = []

  for (const userId of uniqueUserIds) {
    const cacheKey = getProfileCacheKey(userId, options)
    const cachedProfile = getFreshCachedValue(profileCache.get(cacheKey))
    if (cachedProfile.found) {
      profileById[userId] = cachedProfile.value
    } else {
      missingUserIds.push(userId)
    }
  }

  if (missingUserIds.length > 0) {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select(getProfileSelectClause(options))
      .in('id', missingUserIds)

    if (!error) {
      const fetchedProfiles = (profiles as unknown as ProfileRow[] | null) ?? []
      const fetchedProfileById = Object.fromEntries(fetchedProfiles.map((profile) => [profile.id, profile]))

      for (const userId of missingUserIds) {
        const profile = fetchedProfileById[userId] ?? null
        profileById[userId] = profile
        profileCache.set(getProfileCacheKey(userId, options), {
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

export async function loadTotalXpByUserIds(userIds: string[]) {
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

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, total_xp')
    .in('id', missingUserIds)

  const totalXpByUserId = Object.fromEntries(
    (((profiles as Array<{ id: string; total_xp: number | null }> | null) ?? []).map((profile) => [
      profile.id,
      Number(profile.total_xp ?? 0),
    ]))
  ) as Record<string, number>

  for (const userId of missingUserIds) {
    const totalXp = profilesError ? 0 : totalXpByUserId[userId] ?? 0

    totalsByUserId[userId] = totalXp
    totalXpCache.set(userId, {
      value: totalXp,
      expiresAt: Date.now() + TOTAL_XP_CACHE_TTL_MS,
    })
  }

  return totalsByUserId
}

function buildEmptyDashboardOverview(): DashboardOverview {
  return {
    stats: {
      totalKmThisMonth: 0,
      runsCount: 0,
      totalXp: 0,
    },
    profileSummary: {
      name: null,
      nickname: null,
      email: null,
    },
    activeChallenges: [],
    allChallengesCompleted: false,
  }
}

function isDashboardOverview(value: unknown): value is DashboardOverview {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<DashboardOverview>

  return (
    !!candidate.stats &&
    typeof candidate.stats === 'object' &&
    typeof candidate.stats.totalKmThisMonth === 'number' &&
    typeof candidate.stats.runsCount === 'number' &&
    typeof candidate.stats.totalXp === 'number' &&
    !!candidate.profileSummary &&
    typeof candidate.profileSummary === 'object' &&
    'name' in candidate.profileSummary &&
    'nickname' in candidate.profileSummary &&
    'email' in candidate.profileSummary &&
    typeof candidate.allChallengesCompleted === 'boolean' &&
    Array.isArray(candidate.activeChallenges)
  )
}

export async function loadDashboardOverview(userId: string): Promise<DashboardOverview> {
  void userId

  try {
    const response = await fetch('/api/dashboard/overview', {
      credentials: 'include',
    })
    const payload = await response.json().catch(() => null) as unknown

    if (response.ok && isDashboardOverview(payload)) {
      return payload
    }

    console.error('[dashboard] invalid overview payload', {
      status: response.status,
      payload,
    })
  } catch (error) {
    console.error('[dashboard] failed to load overview', error)
  }

  return buildEmptyDashboardOverview()
}

export async function loadUserProfileSummary(userId: string): Promise<UserProfileSummary> {
  const profileById = await loadProfilesByUserIds([userId], { includeAvatarUrl: false })
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
  limit = 10,
  targetUserId?: string | null
): Promise<FeedRunPage> {
  const pageFetchSize = limit * 3
  const end = start + pageFetchSize - 1
  let runsQuery = supabase
    .from('runs')
    .select('id, user_id, name, title, description, shoe_id, city, region, country, external_source, distance_km, duration_minutes, duration_seconds, moving_time_seconds, elevation_gain_meters, map_polyline, xp, xp_breakdown, created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(start, end)

  let raceEventsQuery = supabase
    .from('app_events')
    .select('id, type, actor_user_id, entity_id, payload, created_at')
    .in('type', ['race_event.created', 'race_event.completed', 'challenge.completed'])
    .is('target_user_id', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(start, end)

  if (targetUserId) {
    runsQuery = runsQuery.eq('user_id', targetUserId)
    raceEventsQuery = raceEventsQuery.eq('actor_user_id', targetUserId)
  }

  const [{ data: runs, error: runsError }, appEventsResult] = await Promise.all([
    runsQuery,
    currentUserId
      ? raceEventsQuery
      : Promise.resolve({ data: [] as AppEventFeedRow[], error: null }),
  ])
  const { data: appEvents, error: appEventsError } = appEventsResult

  if (runsError || appEventsError) {
    throw new Error('Не удалось загрузить ленту')
  }

  const pageRuns = (runs as RunRow[] | null) ?? []
  const pageAppEvents = (appEvents as AppEventFeedRow[] | null) ?? []
  const currentRaceEventIds = currentUserId
    ? pageAppEvents
        .filter((event) => event.type !== 'challenge.completed')
        .filter((event) => event.actor_user_id === currentUserId && Boolean(event.entity_id))
        .map((event) => event.entity_id as string)
    : []
  const raceEventIds = Array.from(new Set(
    pageAppEvents
      .filter((event) => event.type !== 'challenge.completed')
      .map((event) => event.entity_id)
      .filter((value): value is string => Boolean(value))
  ))
  const userIds = Array.from(new Set([
    ...pageRuns.map((run) => run.user_id),
    ...pageAppEvents.map((event) => event.actor_user_id).filter((value): value is string => Boolean(value)),
  ]))
  const runIds = pageRuns.map((run) => run.id)

  const [
    profileById,
    likesSummary,
    raceEventLikesSummary,
    raceEventCommentSummary,
    photosResult,
    currentRaceEventsResult,
    historicalRunsResult,
    linkedRaceEventsResult,
    personalRecordEventsResult,
  ] = await Promise.all([
    loadProfilesByUserIds(userIds),
    loadRunLikesSummaryForRunIds(runIds, currentUserId),
    loadRaceEventLikesSummaryForRaceEventIds(raceEventIds, currentUserId),
    loadEntityCommentVisibilitySummaryForEntityIds('race', raceEventIds),
    runIds.length === 0
      ? Promise.resolve({ data: [] as RunPhotoRow[], error: null })
      : supabase
          .from('run_photos')
          .select('id, run_id, public_url, thumbnail_url, sort_order, created_at')
          .in('run_id', runIds)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })
          .order('id', { ascending: true }),
    currentRaceEventIds.length === 0
      ? Promise.resolve({ data: [] as FeedRaceEventCurrentRow[], error: null })
      : supabase
          .from('race_events')
          .select(`
            id,
            user_id,
            name,
            race_date,
            linked_run_id,
            distance_meters,
            result_time_seconds,
            target_time_seconds,
            linked_run:runs!race_events_linked_run_id_fkey (
              id,
              name,
              title,
              distance_km,
              moving_time_seconds,
              created_at
            )
          `)
          .in('id', currentRaceEventIds)
          .eq('user_id', currentUserId),
    userIds.length === 0
      ? Promise.resolve({ data: [] as RunInsightHistoryRow[], error: null })
      : supabase
          .from('runs')
          .select('id, user_id, distance_km, duration_minutes, duration_seconds, moving_time_seconds, created_at')
          .in('user_id', userIds)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }),
    runIds.length === 0
      ? Promise.resolve({ data: [] as RunLinkedRaceEventRow[], error: null })
      : supabase
          .from('race_events')
          .select('id, linked_run_id, name, race_date, result_time_seconds, target_time_seconds, status')
          .in('linked_run_id', runIds)
          .neq('status', 'cancelled'),
    !currentUserId || runIds.length === 0
      ? Promise.resolve({ data: [] as PersonalRecordAppEventRow[], error: null })
      : supabase
          .from('app_events')
          .select('id, entity_id, payload, created_at')
          .eq('type', 'personal_record.achieved')
          .eq('target_user_id', currentUserId)
          .in('entity_id', runIds)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }),
  ])

  const photosByRunId = ((photosResult.data as RunPhotoRow[] | null) ?? []).reduce<Record<string, FeedRunPhoto[]>>(
    (accumulator, photo) => {
      if (
        typeof photo.run_id !== 'string' ||
        photo.run_id.length === 0 ||
        typeof photo.id !== 'string' ||
        photo.id.length === 0 ||
        typeof photo.public_url !== 'string' ||
        photo.public_url.trim().length === 0
      ) {
        return accumulator
      }

      if (!accumulator[photo.run_id]) {
        accumulator[photo.run_id] = []
      }

      accumulator[photo.run_id].push({
        id: photo.id,
        public_url: photo.public_url,
        thumbnail_url: photo.thumbnail_url ?? null,
      })

      return accumulator
    },
    {}
  )
  const currentRaceEventById = Object.fromEntries(
    (((currentRaceEventsResult.data as FeedRaceEventCurrentRow[] | null) ?? []).map((raceEvent) => [
      raceEvent.id,
      raceEvent,
    ]))
  ) as Record<string, FeedRaceEventCurrentRow>
  const historicalRunsByUserId = (((historicalRunsResult.data as RunInsightHistoryRow[] | null) ?? [])).reduce<
    Record<string, RunInsightHistoryRow[]>
  >((accumulator, historicalRun) => {
    if (typeof historicalRun.user_id !== 'string' || historicalRun.user_id.length === 0) {
      return accumulator
    }

    if (!accumulator[historicalRun.user_id]) {
      accumulator[historicalRun.user_id] = []
    }

    accumulator[historicalRun.user_id].push(historicalRun)
    return accumulator
  }, {})
  const historicalRunIndexById = Object.fromEntries(
    Object.values(historicalRunsByUserId).flatMap((userRuns) =>
      userRuns.map((historicalRun, index) => [historicalRun.id, index] as const)
    )
  ) as Record<string, number>
  const linkedRaceEventByRunId = new Map<string, RunLinkedRaceEventRow>()
  for (const raceEvent of (linkedRaceEventsResult.data as RunLinkedRaceEventRow[] | null) ?? []) {
    if (!raceEvent.linked_run_id || linkedRaceEventByRunId.has(raceEvent.linked_run_id)) {
      continue
    }

    linkedRaceEventByRunId.set(raceEvent.linked_run_id, raceEvent)
  }
  const personalRecordEventsByRunId = ((personalRecordEventsResult.data as PersonalRecordAppEventRow[] | null) ?? []).reduce(
    (accumulator, event) => {
      const runId = event.entity_id?.trim()

      if (!runId) {
        return accumulator
      }

      const existingEvents = accumulator.get(runId) ?? []
      existingEvents.push(event)
      accumulator.set(runId, existingEvents)

      return accumulator
    },
    new Map<string, PersonalRecordAppEventRow[]>()
  )
  const activePageRuns = pageRuns.filter((run) => profileById[run.user_id]?.app_access_status === 'active')
  const activePageAppEvents = pageAppEvents.filter(
    (event) => event.actor_user_id && profileById[event.actor_user_id]?.app_access_status === 'active'
  )

  const runItems: FeedItem[] = activePageRuns.map((run) => {
      const profile = profileById[run.user_id]
      const mappedTitle = run.name?.trim() || run.title?.trim() || 'Тренировка'
      const resolvedDurationSeconds = resolveDurationSeconds(run)
      const xpBreakdownRows = getRunXpBreakdownRows(run, historicalRunsByUserId[run.user_id] ?? [])
      const linkedRaceEvent = linkedRaceEventByRunId.get(run.id) ?? null

      return {
        kind: 'run',
        id: run.id,
        user_id: run.user_id,
        title: mappedTitle,
        description: toNullableTrimmedText(run.description),
        shoe_id: toNullableTrimmedText(run.shoe_id),
        city: toNullableTrimmedText(run.city),
        country: toNullableTrimmedText(run.country),
        external_source: run.external_source ?? null,
        distance_km: Number(run.distance_km ?? 0),
        pace: formatPace(Number(run.distance_km ?? 0), resolvedDurationSeconds),
        movingTime: formatMovingTime(resolvedDurationSeconds),
        map_polyline: run.map_polyline ?? null,
        xp: Number(run.xp ?? 0),
        xpBreakdownRows,
        created_at: run.created_at,
        displayName: getProfileDisplayName(profile, 'Бегун'),
        avatar_url: profile?.avatar_url ?? null,
        totalXp: Number(profile?.total_xp ?? 0),
        likesCount: likesSummary.likesByRunId[run.id] ?? 0,
        commentsCount: 0,
        likedByMe: likesSummary.likedRunIds.has(run.id),
        photos: photosByRunId[run.id] ?? [],
        insight: buildRunInsight(run, historicalRunsByUserId, historicalRunIndexById, personalRecordEventsByRunId),
        linkedRaceEvent: linkedRaceEvent ? {
          id: linkedRaceEvent.id,
          name: linkedRaceEvent.name,
          raceDate: linkedRaceEvent.race_date,
          resultTimeSeconds: linkedRaceEvent.result_time_seconds,
          targetTimeSeconds: linkedRaceEvent.target_time_seconds,
        } : null,
      }
    })

  const raceEventItemsRaw = activePageAppEvents.flatMap((event) => {
    if (event.type === 'challenge.completed') {
      return []
    }

    if (!event.actor_user_id || !event.entity_id) {
      return []
    }

    const profile = profileById[event.actor_user_id]
    const context = getContextRecord(event.payload)
    const currentRaceEvent = currentRaceEventById[event.entity_id]
    const currentLinkedRun = getFeedLinkedRun(currentRaceEvent?.linked_run)
    const raceName = currentRaceEvent?.name?.trim()
      || (typeof context?.raceName === 'string' && context.raceName.trim() ? context.raceName.trim() : '')
      || 'Старт'
    const raceDate = currentRaceEvent?.race_date?.trim()
      || (typeof context?.raceDate === 'string' && context.raceDate.trim() ? context.raceDate.trim() : null)
    const linkedRunId = currentRaceEvent?.linked_run_id?.trim()
      || (typeof context?.linkedRunId === 'string' && context.linkedRunId.trim() ? context.linkedRunId.trim() : null)

    // Linked completed starts should be represented by the run card only.
    if (linkedRunId) {
      return []
    }

    const linkedRunName = currentLinkedRun?.name?.trim()
      || currentLinkedRun?.title?.trim()
      || (typeof context?.linkedRunName === 'string' && context.linkedRunName.trim() ? context.linkedRunName.trim() : null)
    const linkedRunCreatedAt =
      (typeof currentLinkedRun?.created_at === 'string' && currentLinkedRun.created_at.trim()
        ? currentLinkedRun.created_at.trim()
        : null)
      || (typeof context?.linkedRunCreatedAt === 'string' && context.linkedRunCreatedAt.trim() ? context.linkedRunCreatedAt.trim() : null)
    const linkedRunDistanceKm =
      parseFiniteNumber(currentLinkedRun?.distance_km) ?? parseFiniteNumber(context?.linkedRunDistanceKm)
    const linkedRunMovingTimeSeconds =
      parseFiniteNumber(currentLinkedRun?.moving_time_seconds) ?? parseFiniteNumber(context?.linkedRunMovingTimeSeconds)
    const distanceMeters =
      parseFiniteNumber(currentRaceEvent?.distance_meters)
      ?? parseFiniteNumber(context?.distanceMeters)
      ?? (
        Number.isFinite(linkedRunDistanceKm) && (linkedRunDistanceKm ?? 0) > 0
          ? Math.round(Number(linkedRunDistanceKm ?? 0) * 1000)
          : null
      )
    const resultTimeSeconds =
      parseFiniteNumber(currentRaceEvent?.result_time_seconds)
      ?? parseFiniteNumber(context?.resultTimeSeconds)
      ?? (
        Number.isFinite(linkedRunMovingTimeSeconds) && (linkedRunMovingTimeSeconds ?? 0) >= 0
          ? Math.round(Number(linkedRunMovingTimeSeconds ?? 0))
          : null
      )
    const targetTimeSeconds =
      parseFiniteNumber(currentRaceEvent?.target_time_seconds) ?? parseFiniteNumber(context?.targetTimeSeconds)

    return [{
      kind: 'race_event' as const,
      id: event.id,
      type: event.type,
      user_id: event.actor_user_id,
      raceEventId: event.entity_id,
      raceName,
      raceDate,
      distanceMeters,
      resultTimeSeconds,
      targetTimeSeconds,
      isPersonalRecord: false,
      created_at: event.created_at,
      displayName: getProfileDisplayName(profile, 'Бегун'),
      avatar_url: profile?.avatar_url ?? null,
      totalXp: Number(profile?.total_xp ?? 0),
      raceEventLikeCount: raceEventLikesSummary.likesByRaceEventId[event.entity_id] ?? 0,
      raceEventLikedByViewer: raceEventLikesSummary.likedRaceEventIds.has(event.entity_id),
      commentsCount: raceEventCommentSummary.countsByEntityId[event.entity_id] ?? 0,
      linkedRun: linkedRunId ? {
        id: linkedRunId,
        name: linkedRunName,
        distanceKm: linkedRunDistanceKm,
        movingTimeSeconds: linkedRunMovingTimeSeconds,
        createdAt: linkedRunCreatedAt,
      } : null,
    }]
  })

  const challengeItems: FeedItem[] = activePageAppEvents.flatMap((event) => {
    if (event.type !== 'challenge.completed' || !event.actor_user_id) {
      return []
    }

    const profile = profileById[event.actor_user_id]
    const context = getContextRecord(event.payload)
    const preview = getPayloadPreviewRecord(event.payload)
    const challengeTitle =
      (typeof preview?.body === 'string' && preview.body.trim() ? preview.body.trim() : '')
      || (typeof preview?.title === 'string' && preview.title.trim() ? preview.title.trim() : '')
      || 'Челлендж'

    return [{
      kind: 'challenge' as const,
      id: event.id,
      type: 'challenge.completed' as const,
      user_id: event.actor_user_id,
      challengeId: event.entity_id,
      challengeTitle,
      xpAwarded: parseFiniteNumber(context?.xpAwarded),
      created_at: event.created_at,
      displayName: getProfileDisplayName(profile, 'Бегун'),
      avatar_url: profile?.avatar_url ?? null,
      totalXp: Number(profile?.total_xp ?? 0),
      targetPath: getPayloadTargetPath(event.payload),
    }]
  })

  const personalRecordRaceEventIds = getPersonalRecordRaceEventIds(
    raceEventItemsRaw.map((item) => ({
      id: item.id,
      user_id: item.user_id,
      name: item.raceName,
      race_date: item.raceDate ?? '',
      linked_run_id: item.linkedRun?.id ?? null,
      distance_meters: item.distanceMeters,
      result_time_seconds: item.resultTimeSeconds,
      created_at: item.created_at,
      linked_run: null,
    }))
  )

  const raceEventItems: FeedItem[] = raceEventItemsRaw.map((item) => ({
    ...item,
    isPersonalRecord: personalRecordRaceEventIds.has(item.id),
  }))

  const combinedItems = [...runItems, ...raceEventItems, ...challengeItems]
    .sort(compareFeedItemsByCreatedAt)
    .slice(0, limit)

  return {
    items: combinedItems,
    hasMore: (activePageRuns.length + activePageAppEvents.length) > limit,
  }
}
