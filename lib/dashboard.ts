import type { DashboardOverview } from './dashboard-overview'
import { getProfileDisplayName } from './profiles'
import { getPersonalRecordRaceEventIds } from './race-events'
import { loadRunLikesSummaryForRunIds } from './run-likes'
import { supabase } from './supabase'

type ProfileRow = {
  id: string
  name: string | null
  nickname?: string | null
  email?: string | null
  avatar_url?: string | null
  total_xp?: number | null
}

type RunRow = {
  id: string
  user_id: string
  name: string | null
  title?: string | null
  description?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
  external_source?: string | null
  distance_km: number | null
  duration_minutes: number | null
  duration_seconds?: number | null
  moving_time_seconds?: number | null
  map_polyline?: string | null
  xp: number | null
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
  type: 'race_event.created' | 'race_event.completed'
  actor_user_id: string | null
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
  city?: string | null
  country?: string | null
  external_source?: string | null
  distance_km: number
  pace: string | number | null
  movingTime: string | null
  map_polyline?: string | null
  xp: number
  created_at: string
  displayName: string
  avatar_url: string | null
  likesCount: number
  commentsCount: number
  likedByMe: boolean
  photos: FeedRunPhoto[]
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
  linkedRun: {
    id: string
    name: string | null
    distanceKm: number | null
    movingTimeSeconds: number | null
    createdAt: string | null
  } | null
}

export type FeedItem =
  | ({ kind: 'run' } & FeedRunItem)
  | ({ kind: 'race_event' } & FeedRaceEventItem)

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

function resolveDurationSeconds(run: Pick<RunRow, 'moving_time_seconds' | 'duration_seconds' | 'duration_minutes'>) {
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
  const fields = ['id', 'name', 'nickname', 'total_xp']

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
    .select('id, user_id, name, title, description, city, region, country, external_source, distance_km, duration_minutes, duration_seconds, moving_time_seconds, map_polyline, xp, created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(start, end)

  let raceEventsQuery = supabase
    .from('app_events')
    .select('id, type, actor_user_id, entity_id, payload, created_at')
    .in('type', ['race_event.created', 'race_event.completed'])
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
  const pageRaceEvents = (appEvents as AppEventFeedRow[] | null) ?? []
  const editableRaceEventIds = currentUserId
    ? pageRaceEvents
        .filter((event) => event.actor_user_id === currentUserId && Boolean(event.entity_id))
        .map((event) => event.entity_id as string)
    : []
  const userIds = Array.from(new Set([
    ...pageRuns.map((run) => run.user_id),
    ...pageRaceEvents.map((event) => event.actor_user_id).filter((value): value is string => Boolean(value)),
  ]))
  const runIds = pageRuns.map((run) => run.id)

  const [
    profileById,
    likesSummary,
    photosResult,
    currentRaceEventsResult,
  ] = await Promise.all([
    loadProfilesByUserIds(userIds),
    loadRunLikesSummaryForRunIds(runIds, currentUserId),
    runIds.length === 0
      ? Promise.resolve({ data: [] as RunPhotoRow[], error: null })
      : supabase
          .from('run_photos')
          .select('id, run_id, public_url, thumbnail_url, sort_order, created_at')
          .in('run_id', runIds)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })
          .order('id', { ascending: true }),
    editableRaceEventIds.length === 0
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
          .in('id', editableRaceEventIds)
          .eq('user_id', currentUserId),
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

  const runItems: FeedItem[] = pageRuns.map((run) => {
      const profile = profileById[run.user_id]
      const mappedTitle = run.name?.trim() || run.title?.trim() || 'Тренировка'
      const resolvedDurationSeconds = resolveDurationSeconds(run)

      return {
        kind: 'run',
        id: run.id,
        user_id: run.user_id,
        title: mappedTitle,
        description: toNullableTrimmedText(run.description),
        city: toNullableTrimmedText(run.city),
        country: toNullableTrimmedText(run.country),
        external_source: run.external_source ?? null,
        distance_km: Number(run.distance_km ?? 0),
        pace: formatPace(Number(run.distance_km ?? 0), resolvedDurationSeconds),
        movingTime: formatMovingTime(resolvedDurationSeconds),
        map_polyline: run.map_polyline ?? null,
        xp: Number(run.xp ?? 0),
        created_at: run.created_at,
        displayName: getProfileDisplayName(profile, 'Бегун'),
        avatar_url: profile?.avatar_url ?? null,
        totalXp: Number(profile?.total_xp ?? 0),
        likesCount: likesSummary.likesByRunId[run.id] ?? 0,
        commentsCount: 0,
        likedByMe: likesSummary.likedRunIds.has(run.id),
        photos: photosByRunId[run.id] ?? [],
      }
    })

  const raceEventItemsRaw = pageRaceEvents.flatMap((event) => {
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
      linkedRun: linkedRunId ? {
        id: linkedRunId,
        name: linkedRunName,
        distanceKm: linkedRunDistanceKm,
        movingTimeSeconds: linkedRunMovingTimeSeconds,
        createdAt: linkedRunCreatedAt,
      } : null,
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

  const combinedItems = [...runItems, ...raceEventItems]
    .sort(compareFeedItemsByCreatedAt)
    .slice(0, limit)

  return {
    items: combinedItems,
    hasMore: (pageRuns.length + pageRaceEvents.length) > limit,
  }
}
