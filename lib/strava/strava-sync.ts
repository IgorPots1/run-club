import 'server-only'

import { upsertPersonalRecordsFromStravaPayload } from '@/lib/personal-records'
import { reverseGeocode } from '@/lib/geocoding/mapbox'
import { loadProfileTotalXp } from '@/lib/profile-total-xp'
import {
  buildPersistedRunXpBreakdown,
  calculateRunXp,
  type PersistedRunXpBreakdown,
} from '@/lib/run-xp'
import { updateRunShoeImpact } from '@/lib/run-shoe-impact'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getLevelFromXP, type XpBreakdownItem } from '@/lib/xp'
import {
  fetchStravaActivityById,
  fetchStravaActivityPhotos,
  fetchActivityStreams,
  fetchStravaActivities,
  isStravaAuthError,
  isStravaNotFoundError,
  refreshStravaAccessToken,
  StravaApiError,
} from './strava-client'
import type {
  StravaActivityPhoto,
  StravaActivityStreams,
  StravaActivitySummary,
  StravaActivityType,
  StravaInitialSyncResult,
  StravaLapSummary,
} from './strava-types'

const STRAVA_EXTERNAL_SOURCE = 'strava'
const FALLBACK_RUN_NAME = 'Бег'
const INITIAL_SYNC_CUTOFF = '2026-01-01T00:00:00Z'
const INITIAL_SYNC_CUTOFF_MS = new Date(INITIAL_SYNC_CUTOFF).getTime()
const INITIAL_SYNC_CUTOFF_UNIX_SECONDS = Math.floor(INITIAL_SYNC_CUTOFF_MS / 1000)
const MAX_SYNC_ERROR_DETAILS = 10
const RUN_DETAIL_SERIES_BACKFILL_BATCH_SIZE = 5
const HEARTRATE_BACKFILL_WINDOW_DAYS = 45
const HEARTRATE_BACKFILL_LOOKUP_LIMIT = 20
const HEARTRATE_BACKFILL_BATCH_SIZE = 5
const RUN_DETAIL_SERIES_DEBUG_RUN_ID = '586eec1e-41cc-4553-9e90-1c8f048bbbda'
const RUN_DETAIL_SERIES_DEBUG_ACTIVITY_ID = 17777010725
const MOJIBAKE_PATTERN = /(?:Ð.|Ñ.|Ã.|Â.)/
const ALLOWED_STRAVA_RUN_TYPES: StravaActivityType[] = ['Run']
const STRAVA_TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000
const MAX_SERIES_POINTS = 48
const MIN_SERIES_POINTS = 4
const STRAVA_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000

type StravaRunInsertPayload = {
  user_id: string
  name: string
  title: string
  distance_km: number
  distance_meters: number
  duration_minutes: number
  duration_seconds: number
  moving_time_seconds: number
  elapsed_time_seconds: number
  average_pace_seconds: number
  elevation_gain_meters: number
  average_heartrate: number | null
  max_heartrate: number | null
  map_polyline: string | null
  calories: number | null
  average_cadence: number | null
  raw_strava_payload: Record<string, unknown> | null
  description: string | null
  photo_count: number | null
  city: string | null
  region: string | null
  country: string | null
  sport_type: string | null
  achievement_count: number | null
  strava_synced_at: string
  created_at: string
  external_source: string
  external_id: string
  xp: number
  xp_breakdown: PersistedRunXpBreakdown | null
}

type StravaConnectionRow = {
  id: string
  user_id: string
  strava_athlete_id: number
  access_token: string
  refresh_token: string
  expires_at: string
  last_synced_at: string | null
  rate_limited_until: string | null
  status: string
}

type ExistingStravaRunRow = {
  id: string
  user_id: string
  name: string | null
  description: string | null
  city: string | null
  region: string | null
  country: string | null
  shoe_id: string | null
  distance_meters: number | null
  xp: number | null
  xp_breakdown: PersistedRunXpBreakdown | null
  name_manually_edited: boolean
  description_manually_edited: boolean
}

type StravaSyncRowErrorDetail = {
  activityId: string
  field?: string
  value?: number | string | null
  error: string
}

type MissingRunDetailSeriesRow = {
  id: string
  external_id: string | null
}

type ExistingRunDetailSeriesStatusRow = {
  run_id: string
  cadence_points: unknown | null
  altitude_points: unknown | null
}

type MissingHeartrateBackfillRunRow = {
  id: string
  external_id: string | null
}

type AutoLinkRaceEventCandidateRow = {
  id: string
  race_date: string
  distance_meters: number | null
}

type StravaImportOutcome = 'imported' | 'updated' | 'skipped_existing' | 'skipped_invalid'

type StravaImportResult = {
  status: StravaImportOutcome
  activityId: string
  runId?: string | null
  xpGained?: number
  breakdown?: XpBreakdownItem[]
  levelUp?: boolean
  newLevel?: number | null
}

type ImportStravaActivityOptions = {
  updateExisting?: boolean
  debugRunId?: string
  accessToken?: string
}

type StravaSyncMode = 'incremental' | 'backfill'

type SyncStravaRunsOptions = {
  mode?: StravaSyncMode
  debugRunId?: string
  allowTargetedDebugOwnerBypass?: boolean
}

type RunDetailSeriesPoint = {
  time: number
  value: number
}

type RunDetailDistanceSeriesPoint = {
  distance: number
  value: number
}

type RunLapUpsertPayload = {
  run_id: string
  strava_activity_id: number
  lap_index: number
  name: string | null
  distance_meters: number | null
  elapsed_time_seconds: number | null
  moving_time_seconds: number | null
  average_speed: number | null
  max_speed: number | null
  average_heartrate: number | null
  max_heartrate: number | null
  total_elevation_gain: number | null
  start_date: string | null
  start_index: number | null
  end_index: number | null
  pace_seconds_per_km: number | null
}

type RunPhotoUpsertPayload = {
  run_id: string
  source: string
  source_photo_id: string
  public_url: string
  thumbnail_url: string | null
  sort_order: number
  metadata: Record<string, unknown> | null
}

type RunLapsSyncStatus =
  | 'fetched_and_saved'
  | 'fetched_but_not_saved'
  | 'no_laps_returned'
  | 'laps_fetch_failed'

type RunLapsSyncResult = {
  synced: boolean
  fetchedCount: number
  savedCount: number
  status: RunLapsSyncStatus
  errorMessage: string | null
  httpStatus: number | null
}

function getMissingRunDetailSeriesReasons(row: ExistingRunDetailSeriesStatusRow | null) {
  const reasons: Array<'missing_detail_series_row' | 'missing_cadence_points' | 'missing_altitude_points'> = []

  if (!row) {
    reasons.push('missing_detail_series_row')
    return reasons
  }

  if (row.cadence_points == null) {
    reasons.push('missing_cadence_points')
  }

  if (row.altitude_points == null) {
    reasons.push('missing_altitude_points')
  }

  return reasons
}

function getLevelUpState(previousTotalXp: number, nextTotalXp: number) {
  const previousLevel = getLevelFromXP(previousTotalXp).level
  const nextLevel = getLevelFromXP(nextTotalXp).level
  const levelUp = nextLevel > previousLevel

  return {
    levelUp,
    newLevel: levelUp ? nextLevel : null,
  }
}

function getStravaRateLimitCooldownRemainingMs(rateLimitedUntil: string | null | undefined) {
  if (!rateLimitedUntil) {
    return 0
  }

  const untilMs = new Date(rateLimitedUntil).getTime()

  if (!Number.isFinite(untilMs)) {
    return 0
  }

  return Math.max(0, untilMs - Date.now())
}

function hasActiveStravaRateLimitCooldown(connection: Pick<StravaConnectionRow, 'rate_limited_until'>) {
  return getStravaRateLimitCooldownRemainingMs(connection.rate_limited_until) > 0
}

function buildStravaRateLimitCooldownUntilIso(nowMs = Date.now()) {
  return new Date(nowMs + STRAVA_RATE_LIMIT_COOLDOWN_MS).toISOString()
}

export async function recordStravaRateLimitCooldown(
  connectionId: string,
  context: string,
  metadata: Record<string, unknown> = {}
) {
  const supabase = createSupabaseAdminClient()
  const rateLimitedUntil = buildStravaRateLimitCooldownUntilIso()
  const { error } = await supabase
    .from('strava_connections')
    .update({
      rate_limited_until: rateLimitedUntil,
    })
    .eq('id', connectionId)

  if (error) {
    throw new Error(error.message)
  }

  console.warn('Strava cooldown recorded after rate limit', {
    connectionId,
    context,
    rateLimitedUntil,
    cooldownMs: STRAVA_RATE_LIMIT_COOLDOWN_MS,
    ...metadata,
  })

  return rateLimitedUntil
}

function logStravaCooldownActive(
  context: string,
  connection: Pick<StravaConnectionRow, 'id' | 'user_id' | 'rate_limited_until'>,
  metadata: Record<string, unknown> = {}
) {
  const remainingMs = getStravaRateLimitCooldownRemainingMs(connection.rate_limited_until)

  console.info('Strava cooldown active', {
    connectionId: connection.id,
    userId: connection.user_id,
    context,
    rateLimitedUntil: connection.rate_limited_until,
    remainingMs,
    ...metadata,
  })
}

function shouldDebugRunDetailSeries(input: {
  runId?: string | null
  activityId?: number | string | null
  externalId?: string | null
}) {
  const normalizedActivityId = Number(input.activityId ?? input.externalId ?? NaN)
  return (
    input.runId === RUN_DETAIL_SERIES_DEBUG_RUN_ID ||
    normalizedActivityId === RUN_DETAIL_SERIES_DEBUG_ACTIVITY_ID
  )
}

function matchesDebugRunId(runId: string | null | undefined, debugRunId?: string) {
  return typeof debugRunId === 'string' && debugRunId.length > 0 && runId === debugRunId
}

function getStreamLengths(streams: StravaActivityStreams) {
  return {
    time: streams.time?.length ?? 0,
    distance: streams.distance?.length ?? 0,
    velocity_smooth: streams.velocity_smooth?.length ?? 0,
    heartrate: streams.heartrate?.length ?? 0,
    cadence: streams.cadence?.length ?? 0,
    altitude: streams.altitude?.length ?? 0,
  }
}

export class StravaReconnectRequiredError extends Error {
  constructor(message = 'Strava reconnect required') {
    super(message)
    this.name = 'StravaReconnectRequiredError'
  }
}

class StravaSyncRowError extends Error {
  field?: string
  value?: number | string | null

  constructor(message: string, detail: Omit<StravaSyncRowErrorDetail, 'activityId' | 'error'> = {}) {
    super(message)
    this.name = 'StravaSyncRowError'
    this.field = detail.field
    this.value = detail.value
  }
}

function toDistanceKm(distanceMeters: number) {
  return Number((distanceMeters / 1000).toFixed(3))
}

function toDurationMinutes(movingTimeSeconds: number) {
  return Math.max(1, normalizeIntegerField('duration_minutes', movingTimeSeconds / 60))
}

function toDurationSeconds(movingTimeSeconds: number) {
  return Math.max(1, normalizeIntegerField('duration_seconds', movingTimeSeconds))
}

function toDistanceMeters(distanceMeters: number) {
  return Math.max(1, normalizeIntegerField('distance_meters', distanceMeters))
}

function toMovingTimeSeconds(movingTimeSeconds: number) {
  return Math.max(1, normalizeIntegerField('moving_time_seconds', movingTimeSeconds))
}

function toElapsedTimeSeconds(elapsedTimeSeconds: number, fallbackMovingTimeSeconds: number) {
  const safeElapsedTime = Number.isFinite(elapsedTimeSeconds) && elapsedTimeSeconds > 0
    ? elapsedTimeSeconds
    : fallbackMovingTimeSeconds

  return Math.max(1, normalizeIntegerField('elapsed_time_seconds', safeElapsedTime))
}

function toAveragePaceSeconds(movingTimeSeconds: number, distanceMeters: number) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    throw new StravaSyncRowError('Invalid numeric value for average_pace_seconds', {
      field: 'distance_meters',
      value: distanceMeters,
    })
  }

  return Math.max(
    1,
    normalizeIntegerField('average_pace_seconds', movingTimeSeconds / (distanceMeters / 1000))
  )
}

function toElevationGainMeters(totalElevationGain: number) {
  const safeElevationGain = Number.isFinite(totalElevationGain) ? totalElevationGain : 0
  return Math.max(0, normalizeIntegerField('elevation_gain_meters', safeElevationGain))
}

function toNullableIntegerField(field: string, value: number | null | undefined) {
  if (value == null) {
    return null
  }

  if (!Number.isFinite(value)) {
    throw new StravaSyncRowError(`Invalid numeric value for ${field}`, {
      field,
      value: String(value),
    })
  }

  return Math.round(value)
}

function toMapPolyline(activity: Pick<StravaActivitySummary, 'map'>) {
  const polyline = activity.map?.summary_polyline?.trim() || activity.map?.polyline?.trim() || null
  return polyline && polyline.length > 0 ? polyline : null
}

function toNullableTrimmedText(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

function getReverseGeocodeCoordinates(
  activity: Pick<StravaActivitySummary, 'start_latlng' | 'end_latlng'>
) {
  const coordinates = Array.isArray(activity.start_latlng) && activity.start_latlng.length === 2
    ? activity.start_latlng
    : Array.isArray(activity.end_latlng) && activity.end_latlng.length === 2
      ? activity.end_latlng
      : null

  if (!coordinates) {
    return null
  }

  const [lat, lng] = coordinates

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }

  return { lat, lng }
}

function toPhotoCount(activity: Pick<StravaActivitySummary, 'photos' | 'photo_count' | 'total_photo_count'>) {
  if (Number.isFinite(activity.total_photo_count)) {
    return Math.max(0, Math.round(Number(activity.total_photo_count)))
  }

  const photos = activity.photos

  if (!photos) {
    if (Number.isFinite(activity.photo_count)) {
      return Math.max(0, Math.round(Number(activity.photo_count)))
    }

    return null
  }

  if (Number.isFinite(photos.count)) {
    return Math.max(0, Math.round(Number(photos.count)))
  }

  if (Number.isFinite(activity.photo_count)) {
    return Math.max(0, Math.round(Number(activity.photo_count)))
  }

  if (photos.primary && typeof photos.primary === 'object') {
    return 1
  }

  return null
}

function toRawJsonObject(value: unknown) {
  try {
    const serialized = JSON.stringify(value)

    if (!serialized) {
      return null
    }

    const parsed = JSON.parse(serialized) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function toRawStravaPayload(activity: StravaActivitySummary) {
  return toRawJsonObject(activity)
}

function toStravaPhotoSourcePhotoId(photo: StravaActivityPhoto) {
  const uniqueId = toNullableTrimmedText(photo.unique_id)

  if (uniqueId) {
    return uniqueId
  }

  const uid = toNullableTrimmedText(photo.uid)

  if (uid) {
    return uid
  }

  if (Number.isFinite(photo.id)) {
    return String(Math.round(Number(photo.id)))
  }

  return toNullableTrimmedText(photo.ref)
}

function getSortedPhotoUrlEntries(urls: StravaActivityPhoto['urls']) {
  return Object.entries(urls ?? {})
    .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : ''] as const)
    .filter(([, value]) => value.length > 0)
    .sort(([leftKey], [rightKey]) => {
      const leftSize = Number(leftKey)
      const rightSize = Number(rightKey)

      if (Number.isFinite(leftSize) && Number.isFinite(rightSize)) {
        return leftSize - rightSize
      }

      if (Number.isFinite(leftSize)) {
        return -1
      }

      if (Number.isFinite(rightSize)) {
        return 1
      }

      return leftKey.localeCompare(rightKey)
    })
}

function buildRunPhotoUpsertPayloads(runId: string, photos: StravaActivityPhoto[]): RunPhotoUpsertPayload[] {
  return photos.flatMap((photo, index) => {
    const sourcePhotoId = toStravaPhotoSourcePhotoId(photo)
    const urlEntries = getSortedPhotoUrlEntries(photo.urls)
    const publicUrl = urlEntries[urlEntries.length - 1]?.[1] ?? null
    const thumbnailUrl = urlEntries[0]?.[1] ?? publicUrl

    if (!sourcePhotoId || !publicUrl) {
      return []
    }

    return [{
      run_id: runId,
      source: STRAVA_EXTERNAL_SOURCE,
      source_photo_id: sourcePhotoId,
      public_url: publicUrl,
      thumbnail_url: thumbnailUrl,
      sort_order: index,
      metadata: toRawJsonObject(photo),
    }]
  })
}

async function getStravaActivityForImport(
  activity: StravaActivitySummary,
  accessToken?: string
) {
  if (accessToken) {
    console.info('Strava detailed activity fetch deferred on import hot path', {
      activityId: activity.id,
      request: 'activities/{id}',
      reason: 'fresh_import_priority',
    })
  }

  return activity
}

function normalizeIntegerField(field: string, value: number) {
  if (!Number.isFinite(value)) {
    throw new StravaSyncRowError(`Invalid numeric value for ${field}`, {
      field,
      value: String(value),
    })
  }

  return Math.round(value)
}

function toNullableFiniteNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : null
}

function toNullableInteger(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : null
}

function toNormalizedLapIndex(value: number | null | undefined, fallbackLapIndex: number) {
  if (Number.isFinite(value) && Number(value) > 0) {
    return Math.round(Number(value))
  }

  return fallbackLapIndex
}

function toNullableIsoTimestamp(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const parsedTimestamp = new Date(value)

  if (Number.isNaN(parsedTimestamp.getTime())) {
    return null
  }

  return parsedTimestamp.toISOString()
}

function roundToTwoDecimals(value: number) {
  return Number(value.toFixed(2))
}

function computeLapPaceSecondsPerKm(lap: StravaLapSummary) {
  const averageSpeed = toNullableFiniteNumber(lap.average_speed)

  if (averageSpeed && averageSpeed > 0) {
    return roundToTwoDecimals(1000 / averageSpeed)
  }

  const distanceMeters = toNullableFiniteNumber(lap.distance)
  const movingTimeSeconds = toNullableInteger(lap.moving_time)
  const elapsedTimeSeconds = toNullableInteger(lap.elapsed_time)

  if (distanceMeters && distanceMeters > 0 && movingTimeSeconds && movingTimeSeconds > 0) {
    return roundToTwoDecimals(movingTimeSeconds / (distanceMeters / 1000))
  }

  if (distanceMeters && distanceMeters > 0 && elapsedTimeSeconds && elapsedTimeSeconds > 0) {
    return roundToTwoDecimals(elapsedTimeSeconds / (distanceMeters / 1000))
  }

  return null
}

function buildRunLapUpsertPayloads(
  runId: string,
  activityId: number,
  laps: StravaLapSummary[]
): RunLapUpsertPayload[] {
  return laps.map((lap, index) => {
    const fallbackLapIndex = index + 1
    const lapName = typeof lap.name === 'string' ? lap.name.trim() : ''

    return {
      run_id: runId,
      strava_activity_id: activityId,
      lap_index: toNormalizedLapIndex(lap.lap_index, fallbackLapIndex),
      name: lapName.length > 0 ? lapName : null,
      distance_meters: toNullableFiniteNumber(lap.distance),
      elapsed_time_seconds: toNullableInteger(lap.elapsed_time),
      moving_time_seconds: toNullableInteger(lap.moving_time),
      average_speed: toNullableFiniteNumber(lap.average_speed),
      max_speed: toNullableFiniteNumber(lap.max_speed),
      average_heartrate: toNullableFiniteNumber(lap.average_heartrate),
      max_heartrate: toNullableFiniteNumber(lap.max_heartrate),
      total_elevation_gain: toNullableFiniteNumber(lap.total_elevation_gain),
      start_date: toNullableIsoTimestamp(lap.start_date),
      start_index: toNullableInteger(lap.start_index),
      end_index: toNullableInteger(lap.end_index),
      pace_seconds_per_km: computeLapPaceSecondsPerKm(lap),
    }
  })
}

function buildBucketedTimeSeries(
  timeValues: number[] | undefined,
  values: number[] | undefined,
  toYValue: (value: number) => number | null
): RunDetailSeriesPoint[] | null {
  if (
    !Array.isArray(timeValues) ||
    !Array.isArray(values) ||
    timeValues.length === 0 ||
    values.length === 0 ||
    timeValues.length !== values.length
  ) {
    return null
  }

  const bucketCount = Math.min(MAX_SERIES_POINTS, values.length)
  const points: RunDetailSeriesPoint[] = []

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const start = Math.floor((bucketIndex * values.length) / bucketCount)
    const end = Math.floor(((bucketIndex + 1) * values.length) / bucketCount)
    const bucketPoints = values
      .slice(start, Math.max(start + 1, end))
      .map((value, indexOffset) => ({
        time: Number(timeValues[start + indexOffset]),
        value: toYValue(value),
      }))
      .filter(
        (point): point is { time: number; value: number } =>
          Number.isFinite(point.time) && Number.isFinite(point.value)
      )

    if (bucketPoints.length === 0) {
      continue
    }

    const averageTime = bucketPoints.reduce((sum, point) => sum + point.time, 0) / bucketPoints.length
    const averageValue = bucketPoints.reduce((sum, point) => sum + point.value, 0) / bucketPoints.length
    points.push({
      time: Math.round(averageTime),
      value: Math.round(averageValue),
    })
  }

  return points.length >= MIN_SERIES_POINTS ? points : null
}

function buildBucketedDistanceSeries(
  distanceValues: number[] | undefined,
  values: number[] | undefined,
  toYValue: (value: number) => number | null
): RunDetailDistanceSeriesPoint[] | null {
  if (
    !Array.isArray(distanceValues) ||
    !Array.isArray(values) ||
    distanceValues.length === 0 ||
    values.length === 0 ||
    distanceValues.length !== values.length
  ) {
    return null
  }

  const bucketCount = Math.min(MAX_SERIES_POINTS, values.length)
  const points: RunDetailDistanceSeriesPoint[] = []

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const start = Math.floor((bucketIndex * values.length) / bucketCount)
    const end = Math.floor(((bucketIndex + 1) * values.length) / bucketCount)
    const bucketPoints = values
      .slice(start, Math.max(start + 1, end))
      .map((value, indexOffset) => ({
        distance: Number(distanceValues[start + indexOffset]),
        value: toYValue(value),
      }))
      .filter(
        (point): point is { distance: number; value: number } =>
          Number.isFinite(point.distance) && point.distance >= 0 && Number.isFinite(point.value)
      )

    if (bucketPoints.length === 0) {
      continue
    }

    const averageDistance = bucketPoints.reduce((sum, point) => sum + point.distance, 0) / bucketPoints.length
    const averageValue = bucketPoints.reduce((sum, point) => sum + point.value, 0) / bucketPoints.length
    points.push({
      distance: Math.round(averageDistance),
      value: Math.round(averageValue),
    })
  }

  return points.length >= MIN_SERIES_POINTS ? points : null
}

function buildPaceSeriesPoints(streams: StravaActivityStreams) {
  return buildBucketedTimeSeries(streams.time, streams.velocity_smooth, (velocityMetersPerSecond) => {
    if (!Number.isFinite(velocityMetersPerSecond) || velocityMetersPerSecond <= 0) {
      return null
    }

    const paceSecondsPerKm = 1000 / velocityMetersPerSecond

    if (paceSecondsPerKm < 120 || paceSecondsPerKm > 1200) {
      return null
    }

    return paceSecondsPerKm
  })
}

function buildHeartrateSeriesPoints(
  streams: StravaActivityStreams,
  activityId?: number
) {
  const heartrateValues = Array.isArray(streams.heartrate) ? streams.heartrate : undefined
  const totalInputPoints = heartrateValues?.length ?? 0
  const validHeartrateValues = (heartrateValues ?? []).filter(
    (heartrate) => Number.isFinite(heartrate) && heartrate >= 40 && heartrate <= 240
  )

  let producedBucketCount = 0
  const points = buildBucketedTimeSeries(streams.time, heartrateValues, (heartrate) => {
    if (!Number.isFinite(heartrate) || heartrate < 40 || heartrate > 240) {
      return null
    }

    return heartrate
  })

  if (Array.isArray(heartrateValues) && heartrateValues.length > 0) {
    const bucketCount = Math.min(MAX_SERIES_POINTS, heartrateValues.length)

    for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
      const start = Math.floor((bucketIndex * heartrateValues.length) / bucketCount)
      const end = Math.floor(((bucketIndex + 1) * heartrateValues.length) / bucketCount)
      const bucketValues = heartrateValues
        .slice(start, Math.max(start + 1, end))
        .filter((heartrate) => Number.isFinite(heartrate) && heartrate >= 40 && heartrate <= 240)

      if (bucketValues.length > 0) {
        producedBucketCount += 1
      }
    }
  }

  console.info('[strava-hr-debug] normalization_result', {
    activityId: activityId ?? null,
    totalInputPoints,
    survivingPoints: validHeartrateValues.length,
    producedBucketCount,
    finalResultNull: points == null,
  })

  return points
}

function buildCadenceSeriesPoints(streams: StravaActivityStreams) {
  return buildBucketedTimeSeries(streams.time, streams.cadence, (cadence) => {
    if (!Number.isFinite(cadence) || cadence < 30 || cadence > 260) {
      return null
    }

    return cadence
  })
}

function buildAltitudeSeriesPoints(streams: StravaActivityStreams) {
  return buildBucketedDistanceSeries(streams.distance, streams.altitude, (altitudeMeters) => {
    if (!Number.isFinite(altitudeMeters) || altitudeMeters < -1000 || altitudeMeters > 10000) {
      return null
    }

    return altitudeMeters
  })
}

async function syncRunDetailSeriesForActivity(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: string,
  activityId: number,
  accessToken: string,
  debugRunId?: string,
  connectionId?: string
): Promise<boolean> {
  const shouldDebug =
    shouldDebugRunDetailSeries({ runId, activityId }) || matchesDebugRunId(runId, debugRunId)

  try {
    const { data: existingSeriesStatus, error: existingSeriesStatusError } = await supabase
      .from('run_detail_series')
      .select('run_id, cadence_points, altitude_points')
      .eq('run_id', runId)
      .maybeSingle()

    if (existingSeriesStatusError) {
      throw new Error(existingSeriesStatusError.message)
    }

    const normalizedExistingSeriesStatus = (existingSeriesStatus as ExistingRunDetailSeriesStatusRow | null) ?? null
    const missingReasons = getMissingRunDetailSeriesReasons(normalizedExistingSeriesStatus)
    const shouldPopulateAllSeries = normalizedExistingSeriesStatus == null
    const shouldBackfillCadencePoints = missingReasons.includes('missing_cadence_points')
    const shouldBackfillAltitudePoints = missingReasons.includes('missing_altitude_points')

    if (missingReasons.length === 0) {
      if (shouldDebug) {
        console.info('[run-detail-debug] run_detail_series_backfill_not_needed', {
          runId,
          activityId,
        })
      }

      console.info('Strava run detail series backfill skipped', {
        runId,
        activityId,
        reason: 'all_detail_series_fields_present',
      })

      return false
    }

    if (shouldDebug) {
      console.info('[run-detail-debug] run_detail_series_backfill_needed', {
        runId,
        activityId,
        missingReasons,
      })
    }

    console.info('Strava run detail series backfill needed', {
      runId,
      activityId,
      missingReasons,
    })

    console.info('[strava-webhook-debug] fetch_streams_start', {
      runId,
      activityId,
    })

    if (shouldDebug) {
      console.info('[run-detail-debug] before_fetch_streams', {
        runId,
        activityId,
      })
    }

    const streams = await fetchActivityStreams(activityId, accessToken)
    const streamLengths = getStreamLengths(streams)

    console.info('[strava-hr-debug] after_fetch_streams', {
      activityId,
      heartrateExists: Array.isArray(streams.heartrate),
      heartrateLength: streams.heartrate?.length ?? 0,
      heartrateFirst10: streams.heartrate?.slice(0, 10) ?? [],
    })

    if (shouldDebug) {
      console.info('[run-detail-debug] after_fetch_streams', {
        runId,
        activityId,
        streamKeys: Object.entries(streamLengths)
          .filter(([, length]) => length > 0)
          .map(([key]) => key),
        streamLengths,
      })
    }

    console.info('[strava-webhook-debug] fetch_streams_success', {
      runId,
      activityId,
      streamKeys: Object.entries(streamLengths)
        .filter(([, length]) => length > 0)
        .map(([key]) => key),
      streamLengths,
    })

    const pacePoints = buildPaceSeriesPoints(streams)
    const heartratePoints = buildHeartrateSeriesPoints(streams, activityId)
    const cadencePoints = buildCadenceSeriesPoints(streams)
    const altitudePoints = buildAltitudeSeriesPoints(streams)

    if (shouldBackfillCadencePoints && cadencePoints == null) {
      console.info('Strava cadence points unavailable during backfill', {
        runId,
        activityId,
      })
    }

    if (shouldBackfillAltitudePoints && altitudePoints == null) {
      console.info('Strava altitude points unavailable during backfill', {
        runId,
        activityId,
      })
    }

    if (heartratePoints == null && pacePoints != null) {
      const heartrateValues = Array.isArray(streams.heartrate) ? streams.heartrate : undefined
      const validHeartrateCount = (heartrateValues ?? []).filter(
        (heartrate) => Number.isFinite(heartrate) && heartrate >= 40 && heartrate <= 240
      ).length
      const heartrateReason = !heartrateValues
        ? 'missing_heartrate_stream'
        : heartrateValues.length === 0
          ? 'empty_heartrate_stream'
          : validHeartrateCount === 0
            ? 'all_heartrate_values_filtered'
            : 'insufficient_heartrate_buckets'

      console.info('[strava-hr-debug] heartrate_missing_while_pace_present', {
        activityId,
        reason: heartrateReason,
        heartrateLength: heartrateValues?.length ?? 0,
        validHeartrateCount,
        pacePointsLength: pacePoints.length,
      })
    }

    if (shouldDebug) {
      console.info('[run-detail-debug] before_run_detail_series_upsert', {
        runId,
        activityId,
        pacePointsLength: pacePoints?.length ?? 0,
        heartratePointsLength: heartratePoints?.length ?? 0,
        cadencePointsLength: cadencePoints?.length ?? 0,
        altitudePointsLength: altitudePoints?.length ?? 0,
      })
    }

    const { error } = await supabase
      .from('run_detail_series')
      .upsert(
        {
          run_id: runId,
          ...(shouldPopulateAllSeries ? {
            pace_points: pacePoints,
            heartrate_points: heartratePoints,
          } : {}),
          ...(shouldPopulateAllSeries || shouldBackfillCadencePoints ? {
            cadence_points: cadencePoints,
          } : {}),
          ...(shouldPopulateAllSeries || shouldBackfillAltitudePoints ? {
            altitude_points: altitudePoints,
          } : {}),
          source: STRAVA_EXTERNAL_SOURCE,
        },
        {
          onConflict: 'run_id',
        }
      )

    if (error) {
      if (shouldDebug) {
        console.error('[run-detail-debug] run_detail_series_upsert_failed', {
          runId,
          activityId,
          error: error.message,
        })
      }
      throw new Error(error.message)
    }

    if (shouldDebug) {
      console.info('[run-detail-debug] run_detail_series_upsert_succeeded', {
        runId,
        activityId,
      })
    }

    return true
  } catch (caughtError) {
    if (isStravaNotFoundError(caughtError)) {
      console.info('Strava activity streams not ready yet', {
        runId,
        activityId,
        status: caughtError.status,
      })
      console.info('[strava-webhook-debug] fetch_streams_not_ready_yet', {
        runId,
        activityId,
        status: caughtError.status,
      })
      return false
    }

    if (caughtError instanceof StravaApiError && caughtError.status === 429) {
      if (connectionId) {
        await recordStravaRateLimitCooldown(connectionId, 'supplemental_streams', {
          runId,
          activityId,
        })
      }

      console.warn('Strava supplemental sync deferred due to rate pressure', {
        runId,
        activityId,
        request: 'activities/{id}/streams',
      })
      return false
    }

    if (shouldDebug) {
      console.warn('[run-detail-debug] run_detail_series_sync_failed', {
        runId,
        activityId,
        error: caughtError instanceof Error ? caughtError.message : 'Unknown streams sync error',
      })
    }

    console.warn('[strava-webhook-debug] fetch_streams_failure', {
      runId,
      activityId,
      error: caughtError instanceof Error ? caughtError.message : 'Unknown streams sync error',
    })

    console.warn('Strava run detail series sync skipped', {
      runId,
      activityId,
      error: caughtError instanceof Error ? caughtError.message : 'Unknown streams sync error',
    })

    return false
  }
}

async function syncRunLapsForActivity(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: string,
  activityId: number,
  accessToken: string,
  debugRunId?: string,
  connectionId?: string
): Promise<RunLapsSyncResult> {
  const shouldDebug =
    shouldDebugRunDetailSeries({ runId, activityId }) || matchesDebugRunId(runId, debugRunId)
  let fetchedCount = 0

  try {
    const detailedActivity = await fetchStravaActivityById(accessToken, activityId)
    const laps = Array.isArray(detailedActivity.laps) ? detailedActivity.laps : []

    fetchedCount = laps.length
    const lapRows = buildRunLapUpsertPayloads(runId, activityId, laps)

    if (lapRows.length === 0) {
      if (shouldDebug) {
        console.info('[run-detail-debug] run_laps_sync_empty', {
          runId,
          activityId,
        })
      }

      console.info('Strava run laps sync completed with no laps', {
        runId,
        activityId,
      })

      return {
        synced: true,
        fetchedCount: 0,
        savedCount: 0,
        status: 'no_laps_returned',
        errorMessage: null,
        httpStatus: null,
      }
    }

    const { error } = await supabase
      .from('run_laps')
      .upsert(lapRows, {
        onConflict: 'run_id,lap_index',
      })

    if (error) {
      throw new Error(error.message)
    }

    if (shouldDebug) {
      console.info('[run-detail-debug] run_laps_sync_succeeded', {
        runId,
        activityId,
        lapsCount: lapRows.length,
      })
    }

    console.info('Strava run laps synced', {
      runId,
      activityId,
      lapsCount: lapRows.length,
    })

    return {
      synced: true,
      fetchedCount,
      savedCount: lapRows.length,
      status: 'fetched_and_saved',
      errorMessage: null,
      httpStatus: null,
    }
  } catch (caughtError) {
    if (isStravaNotFoundError(caughtError)) {
      console.info('Strava run laps not ready yet', {
        runId,
        activityId,
        status: caughtError.status,
      })
      return {
        synced: false,
        fetchedCount: 0,
        savedCount: 0,
        status: 'laps_fetch_failed',
        errorMessage: caughtError.message,
        httpStatus: caughtError.status,
      }
    }

    if (caughtError instanceof StravaApiError && caughtError.status === 429) {
      if (connectionId) {
        await recordStravaRateLimitCooldown(connectionId, 'supplemental_laps', {
          runId,
          activityId,
        })
      }

      console.warn('Strava supplemental sync deferred due to rate pressure', {
        runId,
        activityId,
        request: 'activities/{id}',
        resource: 'laps',
      })
      return {
        synced: false,
        fetchedCount,
        savedCount: 0,
        status: fetchedCount > 0 ? 'fetched_but_not_saved' : 'laps_fetch_failed',
        errorMessage: caughtError.message,
        httpStatus: caughtError.status,
      }
    }

    console.warn('Strava run laps sync skipped', {
      runId,
      activityId,
      error: caughtError instanceof Error ? caughtError.message : 'Unknown laps sync error',
    })

    if (shouldDebug) {
      console.warn('[run-detail-debug] run_laps_sync_failed', {
        runId,
        activityId,
        error: caughtError instanceof Error ? caughtError.message : 'Unknown laps sync error',
      })
    }

    return {
      synced: false,
      fetchedCount,
      savedCount: 0,
      status: fetchedCount > 0 ? 'fetched_but_not_saved' : 'laps_fetch_failed',
      errorMessage: caughtError instanceof Error ? caughtError.message : 'Unknown laps sync error',
      httpStatus: caughtError instanceof StravaApiError ? caughtError.status : null,
    }
  }
}

async function syncRunPhotosForActivity(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: string,
  activityId: number,
  accessToken: string,
  debugRunId?: string,
  connectionId?: string
) {
  const shouldDebug = shouldDebugRunDetailSeries({ runId, activityId })

  try {
    console.log('[PHOTO_SYNC_START]', { runId, activityId })
    console.info('[strava-photo-debug] sync_start', {
      runId,
      activityId,
    })

    const photos = await fetchStravaActivityPhotos(accessToken, activityId)
    console.log('[PHOTO_SYNC_FETCHED]', { count: photos.length })
    const photoRows = buildRunPhotoUpsertPayloads(runId, photos)
    console.log('[PHOTO_SYNC_MAPPED]', { rows: photoRows.length })

    console.info('[strava-photo-debug] sync_mapped', {
      runId,
      activityId,
      fetchedPhotosCount: Array.isArray(photos) ? photos.length : 0,
      mappedPhotoRowsCount: photoRows.length,
    })

    if (photoRows.length === 0) {
      console.info('[strava-photo-debug] sync_no_rows', {
        runId,
        activityId,
        fetchedPhotosCount: Array.isArray(photos) ? photos.length : 0,
      })

      if (shouldDebug) {
        console.info('[run-detail-debug] run_photos_sync_skipped', {
          runId,
          activityId,
          fetchedCount: Array.isArray(photos) ? photos.length : 0,
          reason: 'no_valid_photos',
        })
      }

      return false
    }

    const { error } = await supabase
      .from('run_photos')
      .upsert(photoRows, { onConflict: 'run_id,source,source_photo_id' })

    console.log('[PHOTO_SYNC_UPSERT]', { success: !error, error })

    if (error) {
      console.warn('[strava-photo-debug] upsert_error', {
        runId,
        activityId,
        mappedPhotoRowsCount: photoRows.length,
        error: error.message,
      })
      throw new Error(error.message)
    }

    console.info('[strava-photo-debug] upsert_success', {
      runId,
      activityId,
      mappedPhotoRowsCount: photoRows.length,
    })

    console.info('Strava run photos synced', {
      runId,
      activityId,
      photosCount: photoRows.length,
    })

    if (shouldDebug || matchesDebugRunId(runId, debugRunId)) {
      console.info('[run-detail-debug] run_photos_sync_succeeded', {
        runId,
        activityId,
        photosCount: photoRows.length,
      })
    }

    return true
  } catch (caughtError) {
    if (caughtError instanceof StravaApiError && caughtError.status === 429) {
      if (connectionId) {
        await recordStravaRateLimitCooldown(connectionId, 'supplemental_photos', {
          runId,
          activityId,
        })
      }

      console.warn('Strava supplemental sync deferred due to rate pressure', {
        runId,
        activityId,
        request: 'activities/{id}/photos',
      })
      return false
    }

    console.warn('Strava run photos sync skipped', {
      runId,
      activityId,
      error: caughtError instanceof Error ? caughtError.message : 'Unknown photo sync error',
    })

    if (shouldDebug || matchesDebugRunId(runId, debugRunId)) {
      console.warn('[run-detail-debug] run_photos_sync_failed', {
        runId,
        activityId,
        error: caughtError instanceof Error ? caughtError.message : 'Unknown photo sync error',
      })
    }

    return false
  }
}

function logDeferredHotPathSupplementalSync(params: {
  runId: string
  activityId: number
  outcome: StravaImportOutcome
  reason: string
}) {
  console.info('Strava supplemental sync deferred on import hot path', {
    runId: params.runId,
    activityId: params.activityId,
    outcome: params.outcome,
    reason: params.reason,
    deferredRequests: ['activities/{id}/streams', 'activities/{id}', 'activities/{id}/photos'],
  })
}

async function syncRunSupplementalStravaDataForActivity(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: string,
  activityId: number,
  accessToken: string,
  debugRunId?: string,
  connectionId?: string
) {
  const detailSeriesSynced = await syncRunDetailSeriesForActivity(
    supabase,
    runId,
    activityId,
    accessToken,
    debugRunId,
    connectionId
  )
  const lapsSyncResult = await syncRunLapsForActivity(
    supabase,
    runId,
    activityId,
    accessToken,
    debugRunId,
    connectionId
  )
  console.log('[PHOTO_SYNC_CALL]', { runId, activityId })
  const photosSynced = await syncRunPhotosForActivity(
    supabase,
    runId,
    activityId,
    accessToken,
    debugRunId,
    connectionId
  )

  return detailSeriesSynced || lapsSyncResult.synced || photosSynced
}

async function resolveExistingStravaRunIdForSupplementalSync(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  externalId: string
) {
  const { data, error } = await supabase
    .from('runs')
    .select('id')
    .eq('external_source', STRAVA_EXTERNAL_SOURCE)
    .eq('external_id', externalId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data?.id ?? null
}

async function backfillMissingRunDetailSeriesForUser(
  userId: string,
  accessToken: string,
  debugRunId?: string,
  connectionId?: string
) {
  const supabase = createSupabaseAdminClient()

  if (debugRunId) {
    const { data: targetRun, error: targetRunError } = await supabase
      .from('runs')
      .select('id, external_id')
      .eq('id', debugRunId)
      .eq('user_id', userId)
      .eq('external_source', STRAVA_EXTERNAL_SOURCE)
      .maybeSingle()

    if (targetRunError) {
      console.warn('[run-detail-debug] target_run_lookup_failed', {
        userId,
        runId: debugRunId,
        error: targetRunError.message,
      })
      return
    }

    console.info('[run-detail-debug] target_run_found', {
      userId,
      runId: debugRunId,
      found: Boolean(targetRun),
    })

    if (!targetRun) {
      return
    }

    const activityId = Number(targetRun.external_id)

    if (!Number.isFinite(activityId) || activityId <= 0) {
      console.warn('[run-detail-debug] target_run_skipped', {
        runId: debugRunId,
        externalId: targetRun.external_id,
        reason: 'invalid_external_id',
      })
      return
    }

    console.info('[run-detail-debug] target_run_selected', {
      runId: debugRunId,
      activityId,
      externalId: targetRun.external_id,
      reason: 'forced_debug_run',
    })

    console.info('[run-detail-debug] target_run_sync_start', {
      runId: debugRunId,
      activityId,
      path: 'forced_historical_detail_series_backfill',
    })

    await syncRunSupplementalStravaDataForActivity(
      supabase,
      targetRun.id,
      activityId,
      accessToken,
      debugRunId,
      connectionId
    )
    return
  }

  const { data: stravaRuns, error: runsError } = await supabase
    .from('runs')
    .select('id, external_id')
    .eq('user_id', userId)
    .eq('external_source', STRAVA_EXTERNAL_SOURCE)
    .order('created_at', { ascending: false })

  if (runsError) {
    console.warn('Strava run detail series batch lookup failed', {
      userId,
      error: runsError.message,
    })
    return
  }

  const candidateRuns = ((stravaRuns as MissingRunDetailSeriesRow[] | null) ?? [])
    .filter((run) => typeof run.id === 'string' && run.id.length > 0)

  if (candidateRuns.length === 0) {
    return
  }

  console.info('Strava run detail series backfill scanning recent missing runs first', {
    userId,
    batchSize: RUN_DETAIL_SERIES_BACKFILL_BATCH_SIZE,
  })

  if (shouldDebugRunDetailSeries({ runId: RUN_DETAIL_SERIES_DEBUG_RUN_ID })) {
    console.info('[run-detail-debug] fallback_candidates_loaded', {
      userId,
      candidateRunsCount: candidateRuns.length,
      targetRunPresent: candidateRuns.some((run) => run.id === RUN_DETAIL_SERIES_DEBUG_RUN_ID),
    })
  }

  const { data: existingSeriesRows, error: existingSeriesError } = await supabase
    .from('run_detail_series')
    .select('run_id, cadence_points, altitude_points')
    .in('run_id', candidateRuns.map((run) => run.id))

  if (existingSeriesError) {
    console.warn('Strava run detail series existing rows lookup failed', {
      userId,
      error: existingSeriesError.message,
    })
    return
  }

  const existingSeriesRowsByRunId = new Map(
    ((existingSeriesRows as ExistingRunDetailSeriesStatusRow[] | null) ?? [])
      .filter((row) => typeof row.run_id === 'string' && row.run_id.length > 0)
      .map((row) => [row.run_id, row] as const)
  )

  const missingRuns = candidateRuns.filter((run) =>
    getMissingRunDetailSeriesReasons(existingSeriesRowsByRunId.get(run.id) ?? null).length > 0
  )

  const selectedRuns = debugRunId
    ? missingRuns.filter((run) => run.id === debugRunId).slice(0, 1)
    : missingRuns.slice(0, RUN_DETAIL_SERIES_BACKFILL_BATCH_SIZE)

  if (selectedRuns.length === 0) {
    if (shouldDebugRunDetailSeries({ runId: debugRunId ?? RUN_DETAIL_SERIES_DEBUG_RUN_ID })) {
      console.info('[run-detail-debug] target_run_not_selected_for_fallback', {
        userId,
        debugRunId: debugRunId ?? null,
        targetRunId: RUN_DETAIL_SERIES_DEBUG_RUN_ID,
        targetMissingSeries: missingRuns.some((run) => run.id === RUN_DETAIL_SERIES_DEBUG_RUN_ID),
      })
    }
    return
  }

  if (debugRunId) {
    console.info('Strava run detail series targeted fallback selected', {
      userId,
      runId: debugRunId,
      batchSize: selectedRuns.length,
    })
  } else {
    console.info('Strava run detail series historical backfill queued', {
      userId,
      batchSize: selectedRuns.length,
    })
  }

  for (const run of selectedRuns) {
    const activityId = Number(run.external_id)

    if (shouldDebugRunDetailSeries({ runId: run.id, activityId })) {
      console.info('[run-detail-debug] target_run_selected_for_fallback', {
        runId: run.id,
        activityId,
        externalId: run.external_id,
      })
    }

    if (!Number.isFinite(activityId) || activityId <= 0) {
      if (shouldDebugRunDetailSeries({ runId: run.id, externalId: run.external_id })) {
        console.warn('[run-detail-debug] target_run_skipped', {
          runId: run.id,
          externalId: run.external_id,
          reason: 'invalid_external_id',
        })
      }
      console.warn('Strava run detail series historical backfill skipped invalid external id', {
        userId,
        runId: run.id,
        externalId: run.external_id,
      })
      continue
    }

    console.info('Strava run detail series fallback sync triggered', {
      runId: run.id,
      activityId,
      fallback_reason: getMissingRunDetailSeriesReasons(existingSeriesRowsByRunId.get(run.id) ?? null),
    })

    await syncRunSupplementalStravaDataForActivity(supabase, run.id, activityId, accessToken, undefined, connectionId)
  }
}

async function backfillMissingHeartratePointsForUser(
  userId: string,
  accessToken: string,
  connectionId?: string
) {
  const recentWindowStartIso = new Date(
    Date.now() - HEARTRATE_BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  const supabase = createSupabaseAdminClient()
  const { data: recentRuns, error: recentRunsError } = await supabase
    .from('runs')
    .select('id, external_id')
    .eq('user_id', userId)
    .eq('external_source', STRAVA_EXTERNAL_SOURCE)
    .gte('created_at', recentWindowStartIso)
    .order('created_at', { ascending: false })
    .limit(HEARTRATE_BACKFILL_LOOKUP_LIMIT)

  if (recentRunsError) {
    console.warn('Strava heartrate backfill recent runs lookup failed', {
      userId,
      error: recentRunsError.message,
    })
    return
  }

  const candidateRuns = ((recentRuns as MissingHeartrateBackfillRunRow[] | null) ?? [])
    .filter((run) => typeof run.id === 'string' && run.id.length > 0)

  if (candidateRuns.length === 0) {
    return
  }

  const { data: missingHeartrateRows, error: missingHeartrateRowsError } = await supabase
    .from('run_detail_series')
    .select('run_id')
    .in('run_id', candidateRuns.map((run) => run.id))
    .is('heartrate_points', null)

  if (missingHeartrateRowsError) {
    console.warn('Strava heartrate backfill missing-series lookup failed', {
      userId,
      error: missingHeartrateRowsError.message,
    })
    return
  }

  const missingHeartrateRunIds = new Set(
    (missingHeartrateRows ?? [])
      .map((row) => row.run_id)
      .filter((runId): runId is string => typeof runId === 'string' && runId.length > 0)
  )

  const selectedRuns = candidateRuns
    .filter((run) => missingHeartrateRunIds.has(run.id))
    .slice(0, HEARTRATE_BACKFILL_BATCH_SIZE)

  if (selectedRuns.length === 0) {
    return
  }

  console.info('Strava heartrate backfill queued', {
    userId,
    batchSize: selectedRuns.length,
    windowDays: HEARTRATE_BACKFILL_WINDOW_DAYS,
  })

  for (const run of selectedRuns) {
    const activityId = Number(run.external_id)
    const shouldDebug = shouldDebugRunDetailSeries({ runId: run.id, activityId })

    if (!Number.isFinite(activityId) || activityId <= 0) {
      console.warn('Strava heartrate backfill skipped invalid external id', {
        userId,
        runId: run.id,
        externalId: run.external_id,
      })
      continue
    }

    try {
      const streams = await fetchActivityStreams(activityId, accessToken)
      const heartratePoints = buildHeartrateSeriesPoints(streams, activityId)

      if (shouldDebug) {
        console.info('[run-detail-debug] heartrate_backfill_preview', {
          runId: run.id,
          activityId,
          timeStreamExists: Array.isArray(streams.time) && streams.time.length > 0,
          timeFirst5: streams.time?.slice(0, 5) ?? [],
          heartratePointsFirst5: heartratePoints?.slice(0, 5) ?? [],
          heartrateStoredRealElapsedSeconds:
            Array.isArray(streams.time) &&
            Array.isArray(streams.heartrate) &&
            streams.time.length === streams.heartrate.length &&
            Array.isArray(heartratePoints),
        })
      }

      if (!heartratePoints) {
        console.info('Strava heartrate backfill skipped missing normalized heartrate', {
          runId: run.id,
          activityId,
        })
        continue
      }

      const { error: updateError } = await supabase
        .from('run_detail_series')
        .update({
          heartrate_points: heartratePoints,
        })
        .eq('run_id', run.id)
        .is('heartrate_points', null)

      if (updateError) {
        throw new Error(updateError.message)
      }

      console.info('Strava heartrate backfill updated', {
        runId: run.id,
        activityId,
        heartratePointsCount: heartratePoints.length,
      })
    } catch (caughtError) {
      if (isStravaNotFoundError(caughtError)) {
        console.info('Strava heartrate backfill streams not ready yet', {
          runId: run.id,
          activityId,
          status: caughtError.status,
        })
        continue
      }

      if (caughtError instanceof StravaApiError && caughtError.status === 429) {
        if (connectionId) {
          await recordStravaRateLimitCooldown(connectionId, 'heartrate_backfill', {
            runId: run.id,
            activityId,
          })
        }

        console.warn('Strava supplemental sync deferred due to rate pressure', {
          runId: run.id,
          activityId,
          request: 'activities/{id}/streams',
          resource: 'heartrate_backfill',
        })
        continue
      }

      console.warn('Strava heartrate backfill failed', {
        runId: run.id,
        activityId,
        error: caughtError instanceof Error ? caughtError.message : 'Unknown heartrate backfill error',
      })
    }
  }
}

function normalizeImportedRunName(rawName: string) {
  const trimmedName = rawName.trim()

  if (!trimmedName) {
    return FALLBACK_RUN_NAME
  }

  if (!MOJIBAKE_PATTERN.test(trimmedName)) {
    return trimmedName
  }

  try {
    const decodedName = Buffer.from(trimmedName, 'latin1').toString('utf8').trim()
    return decodedName && !decodedName.includes('\uFFFD') ? decodedName : trimmedName
  } catch {
    return trimmedName
  }
}

export function isValidStravaRun(activity: StravaActivitySummary) {
  return (
    ALLOWED_STRAVA_RUN_TYPES.includes(activity.type as StravaActivityType) &&
    Number.isFinite(activity.distance) &&
    activity.distance > 0 &&
    Number.isFinite(activity.moving_time) &&
    activity.moving_time > 0 &&
    Boolean(activity.start_date)
  )
}

function isOnOrAfterInitialSyncCutoff(startDate: string | null | undefined) {
  if (!startDate) {
    return false
  }

  const activityStartDateMs = new Date(startDate).getTime()

  if (Number.isNaN(activityStartDateMs) || Number.isNaN(INITIAL_SYNC_CUTOFF_MS)) {
    return false
  }

  return activityStartDateMs >= INITIAL_SYNC_CUTOFF_MS
}

function buildRunInsertPayload(userId: string, activity: StravaActivitySummary): StravaRunInsertPayload {
  const normalizedName = normalizeImportedRunName(activity.name)
  const distanceMeters = toDistanceMeters(activity.distance)
  const distanceKm = toDistanceKm(distanceMeters)
  const movingTimeSeconds = toMovingTimeSeconds(activity.moving_time)
  const durationSeconds = toDurationSeconds(movingTimeSeconds)
  const elapsedTimeSeconds = toElapsedTimeSeconds(activity.elapsed_time, movingTimeSeconds)
  const syncedAt = new Date().toISOString()
  const normalizedDescription = toNullableTrimmedText(activity.description)
  const normalizedSportType = toNullableTrimmedText(activity.sport_type) ?? toNullableTrimmedText(activity.type)

  return {
    user_id: userId,
    name: normalizedName,
    title: normalizedName,
    distance_km: distanceKm,
    distance_meters: distanceMeters,
    duration_minutes: toDurationMinutes(durationSeconds),
    duration_seconds: durationSeconds,
    moving_time_seconds: movingTimeSeconds,
    elapsed_time_seconds: elapsedTimeSeconds,
    average_pace_seconds: toAveragePaceSeconds(movingTimeSeconds, distanceMeters),
    elevation_gain_meters: toElevationGainMeters(activity.total_elevation_gain),
    average_heartrate: toNullableIntegerField('average_heartrate', activity.average_heartrate),
    max_heartrate: toNullableIntegerField('max_heartrate', activity.max_heartrate),
    map_polyline: toMapPolyline(activity),
    calories: toNullableIntegerField('calories', activity.calories),
    average_cadence: toNullableIntegerField('average_cadence', activity.average_cadence),
    raw_strava_payload: toRawStravaPayload(activity),
    description: normalizedDescription,
    photo_count: toPhotoCount(activity),
    city: toNullableTrimmedText(activity.location_city),
    region: toNullableTrimmedText(activity.location_state),
    country: toNullableTrimmedText(activity.location_country),
    sport_type: normalizedSportType,
    achievement_count: toNullableIntegerField('achievement_count', activity.achievement_count),
    strava_synced_at: syncedAt,
    created_at: new Date(activity.start_date).toISOString(),
    external_source: STRAVA_EXTERNAL_SOURCE,
    external_id: String(activity.id),
    xp: 0,
    xp_breakdown: null,
  }
}

function getDateValueFromIsoString(value: string) {
  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return null
  }

  return parsedDate.toISOString().slice(0, 10)
}

function shiftDateValue(dateValue: string, days: number) {
  const parsedDate = new Date(`${dateValue}T12:00:00Z`)

  if (Number.isNaN(parsedDate.getTime())) {
    return null
  }

  parsedDate.setUTCDate(parsedDate.getUTCDate() + days)
  return parsedDate.toISOString().slice(0, 10)
}

function getDateDistanceDays(leftDateValue: string, rightDateValue: string) {
  const leftDate = new Date(`${leftDateValue}T12:00:00Z`)
  const rightDate = new Date(`${rightDateValue}T12:00:00Z`)

  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) {
    return Number.POSITIVE_INFINITY
  }

  return Math.round(Math.abs(leftDate.getTime() - rightDate.getTime()) / (24 * 60 * 60 * 1000))
}

async function autoLinkRunToRaceEvent(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>
  userId: string
  runId: string
  runCreatedAt: string
  runDistanceMeters: number
}) {
  const runDateValue = getDateValueFromIsoString(params.runCreatedAt)

  if (!runDateValue || !Number.isFinite(params.runDistanceMeters) || params.runDistanceMeters <= 0) {
    return
  }

  const lowerBoundDate = shiftDateValue(runDateValue, -1)
  const upperBoundDate = shiftDateValue(runDateValue, 1)

  if (!lowerBoundDate || !upperBoundDate) {
    return
  }

  try {
    const { data, error } = await params.supabase
      .from('race_events')
      .select('id, race_date, distance_meters')
      .eq('user_id', params.userId)
      .is('linked_run_id', null)
      .not('distance_meters', 'is', null)
      .gte('race_date', lowerBoundDate)
      .lte('race_date', upperBoundDate)

    if (error) {
      console.warn('Race event auto-link lookup failed', {
        userId: params.userId,
        runId: params.runId,
        error: error.message,
      })
      return
    }

    const eligibleCandidates = ((data as AutoLinkRaceEventCandidateRow[] | null) ?? [])
      .filter((candidate) => Number.isFinite(candidate.distance_meters) && (candidate.distance_meters ?? 0) > 0)
      .map((candidate) => {
        const raceDistanceMeters = Math.round(candidate.distance_meters ?? 0)
        const distanceDifferenceMeters = Math.abs(params.runDistanceMeters - raceDistanceMeters)
        const allowedDifferenceMeters = Math.max(1, Math.min(Math.round(raceDistanceMeters * 0.1), 1500))

        return {
          candidate,
          distanceDifferenceMeters,
          dateDifferenceDays: getDateDistanceDays(candidate.race_date, runDateValue),
          allowedDifferenceMeters,
        }
      })
      .filter((candidate) => candidate.distanceDifferenceMeters <= candidate.allowedDifferenceMeters)
      .sort((left, right) => {
        if (left.distanceDifferenceMeters !== right.distanceDifferenceMeters) {
          return left.distanceDifferenceMeters - right.distanceDifferenceMeters
        }

        return left.dateDifferenceDays - right.dateDifferenceDays
      })

    const bestCandidate = eligibleCandidates[0]
    const secondCandidate = eligibleCandidates[1]

    if (!bestCandidate) {
      return
    }

    if (secondCandidate && secondCandidate.distanceDifferenceMeters === bestCandidate.distanceDifferenceMeters) {
      return
    }

    const { error: updateError } = await params.supabase
      .from('race_events')
      .update({
        linked_run_id: params.runId,
      })
      .eq('id', bestCandidate.candidate.id)
      .eq('user_id', params.userId)
      .is('linked_run_id', null)

    if (updateError) {
      console.warn('Race event auto-link update failed', {
        userId: params.userId,
        runId: params.runId,
        raceEventId: bestCandidate.candidate.id,
        error: updateError.message,
      })
    }
  } catch (error) {
    console.warn('Race event auto-link unexpected failure', {
      userId: params.userId,
      runId: params.runId,
      error: error instanceof Error ? error.message : 'unknown_error',
    })
  }
}

function findLikelyInvalidIntegerField(payload: StravaRunInsertPayload) {
  const integerFields: Array<
    keyof Pick<
      StravaRunInsertPayload,
      | 'distance_meters'
      | 'duration_minutes'
      | 'duration_seconds'
      | 'moving_time_seconds'
      | 'elapsed_time_seconds'
      | 'average_pace_seconds'
      | 'elevation_gain_meters'
      | 'xp'
    >
  > = [
    'distance_meters',
    'duration_minutes',
    'duration_seconds',
    'moving_time_seconds',
    'elapsed_time_seconds',
    'average_pace_seconds',
    'elevation_gain_meters',
    'xp',
  ]

  for (const field of integerFields) {
    if (!Number.isInteger(payload[field])) {
      return {
        field,
        value: payload[field],
      }
    }
  }

  return null
}

function isUniqueViolationError(error: { code?: string | null } | null | undefined) {
  return error?.code === '23505'
}

function formatSupabaseError(error: {
  message?: string | null
  details?: string | null
  hint?: string | null
  code?: string | null
} | null | undefined) {
  const parts = [
    error?.message?.trim(),
    error?.details?.trim() ? `details=${error.details.trim()}` : null,
    error?.hint?.trim() ? `hint=${error.hint.trim()}` : null,
    error?.code?.trim() ? `code=${error.code.trim()}` : null,
  ].filter((part): part is string => Boolean(part))

  return parts.join(' | ') || 'Unknown Supabase error'
}

function isStravaTokenExpiringSoon(expiresAt: string) {
  const expiresAtMs = new Date(expiresAt).getTime()

  if (Number.isNaN(expiresAtMs)) {
    return true
  }

  return expiresAtMs <= Date.now() + STRAVA_TOKEN_REFRESH_BUFFER_MS
}

async function markStravaConnectionReconnectRequired(connectionId: string) {
  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('strava_connections')
    .update({
      status: 'reconnect_required',
    })
    .eq('id', connectionId)

  if (error) {
    throw new Error(error.message)
  }
}

export async function touchStravaConnection(connectionId: string) {
  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('strava_connections')
    .update({
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', connectionId)

  if (error) {
    throw new Error(error.message)
  }
}

async function getStravaConnectionByColumn(
  column: 'user_id' | 'strava_athlete_id',
  value: string | number
): Promise<StravaConnectionRow | null> {
  console.info('[strava-sync-debug] get_connection_start', {
    column,
    valueType: typeof value,
  })

  const supabase = createSupabaseAdminClient()

  console.info('[strava-sync-debug] get_connection_admin_client_ready', {
    column,
  })

  console.info('[strava-sync-debug] get_connection_query_start', {
    column,
  })

  const { data, error } = await supabase
    .from('strava_connections')
    .select('id, user_id, strava_athlete_id, access_token, refresh_token, expires_at, last_synced_at, rate_limited_until, status')
    .eq(column, value)
    .maybeSingle()

  if (error) {
    console.warn('[strava-sync-debug] get_connection_query_failed', {
      column,
      error: error.message,
    })
    throw new Error(error.message)
  }

  console.info('[strava-sync-debug] get_connection_query_succeeded', {
    column,
    foundConnection: Boolean(data),
  })

  return (data as StravaConnectionRow | null) ?? null
}

async function ensureFreshStravaConnection(connection: StravaConnectionRow): Promise<StravaConnectionRow> {
  if (connection.status === 'reconnect_required') {
    throw new StravaReconnectRequiredError()
  }

  if (!isStravaTokenExpiringSoon(connection.expires_at)) {
    console.info('[strava-sync-debug] refresh_branch_skipped', {
      connectionId: connection.id,
      reason: 'token_still_fresh',
    })
    return connection
  }

  console.info('[strava-sync-debug] refresh_branch_entered', {
    connectionId: connection.id,
    expiresAt: connection.expires_at,
  })

  let refreshedToken

  try {
    console.info('[strava-webhook-debug] refresh_token_start', {
      connectionId: connection.id,
      athleteId: connection.strava_athlete_id,
    })

    // #region agent log
    fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: `refresh-${connection.id}`, hypothesisId: 'H5', location: 'lib/strava/strava-sync.ts:ensureFreshStravaConnection:refresh_attempt', message: 'Refreshing Strava token', data: { connectionId: connection.id, athleteId: connection.strava_athlete_id, expiresAt: connection.expires_at }, timestamp: Date.now() }) }).catch(() => {})
    // #endregion
    refreshedToken = await refreshStravaAccessToken(connection.refresh_token)
    console.info('[strava-webhook-debug] refresh_token_success', {
      connectionId: connection.id,
      athleteId: connection.strava_athlete_id,
    })
  } catch (caughtError) {
    console.warn('[strava-webhook-debug] refresh_token_failure', {
      connectionId: connection.id,
      athleteId: connection.strava_athlete_id,
      error: caughtError instanceof Error ? caughtError.message : 'Unknown refresh token error',
    })

    if (isStravaAuthError(caughtError)) {
      // #region agent log
      fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: `refresh-${connection.id}`, hypothesisId: 'H5', location: 'lib/strava/strava-sync.ts:ensureFreshStravaConnection:refresh_auth_failure', message: 'Strava token refresh auth failure', data: { connectionId: connection.id, athleteId: connection.strava_athlete_id }, timestamp: Date.now() }) }).catch(() => {})
      // #endregion
      await markStravaConnectionReconnectRequired(connection.id)
      throw new StravaReconnectRequiredError()
    }

    throw caughtError
  }

  const nextConnection: StravaConnectionRow = {
    ...connection,
    access_token: refreshedToken.access_token,
    refresh_token: refreshedToken.refresh_token,
    expires_at: new Date(refreshedToken.expires_at * 1000).toISOString(),
    strava_athlete_id: refreshedToken.athlete?.id ?? connection.strava_athlete_id,
    status: 'connected',
  }

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('strava_connections')
    .update({
      access_token: nextConnection.access_token,
      refresh_token: nextConnection.refresh_token,
      expires_at: nextConnection.expires_at,
      strava_athlete_id: nextConnection.strava_athlete_id,
      status: nextConnection.status,
    })
    .eq('id', connection.id)

  if (error) {
    throw new Error(error.message)
  }

  return nextConnection
}

export async function getStravaConnectionForUser(userId: string) {
  const connection = await getStravaConnectionByColumn('user_id', userId)
  return connection ? ensureFreshStravaConnection(connection) : null
}

export async function getStravaConnectionForAthlete(stravaAthleteId: number) {
  const connection = await getStravaConnectionByColumn('strava_athlete_id', stravaAthleteId)
  return connection ? ensureFreshStravaConnection(connection) : null
}

export async function importStravaActivityForUser(
  userId: string,
  activity: StravaActivitySummary,
  options: ImportStravaActivityOptions = {}
): Promise<StravaImportResult> {
  const activityForImport = await getStravaActivityForImport(activity, options.accessToken)
  const activityMatchesDebugRun = shouldDebugRunDetailSeries({ activityId: activityForImport.id })

  if (!isValidStravaRun(activityForImport)) {
    if (activityMatchesDebugRun) {
      console.warn('[run-detail-debug] target_run_skipped', {
        activityId: activityForImport.id,
        reason: 'invalid_strava_run',
      })
    }
    return {
      status: 'skipped_invalid',
      activityId: String(activityForImport.id),
      runId: null,
    }
  }

  const supabase = createSupabaseAdminClient()
  const payload = buildRunInsertPayload(userId, activityForImport)
  const { data: existingRun, error: existingRunError } = await supabase
    .from('runs')
    .select('id, user_id, name, description, city, region, country, shoe_id, distance_meters, xp, xp_breakdown, name_manually_edited, description_manually_edited')
    .eq('external_source', STRAVA_EXTERNAL_SOURCE)
    .eq('external_id', payload.external_id)
    .maybeSingle()

  if (existingRunError) {
    console.error('[strava-sync-debug] existing_run_lookup_failed', {
      userId,
      externalId: payload.external_id,
      message: existingRunError.message,
      details: existingRunError.details ?? null,
      hint: existingRunError.hint ?? null,
      code: existingRunError.code ?? null,
    })
    throw new Error(formatSupabaseError(existingRunError))
  }

  const normalizedExistingRun = (existingRun as ExistingStravaRunRow | null) ?? null
  const shouldAttemptXpRecovery = normalizedExistingRun
    ? Math.max(0, Math.round(Number(normalizedExistingRun.xp ?? 0))) === 0
    : false
  let runXp = null as Awaited<ReturnType<typeof calculateRunXp>> | null

  if (normalizedExistingRun) {
    if (shouldAttemptXpRecovery) {
      try {
        runXp = await calculateRunXp({
          userId,
          createdAt: payload.created_at,
          distanceKm: payload.distance_km,
          elevationGainMeters: payload.elevation_gain_meters,
          externalSource: payload.external_source,
          excludeRunId: normalizedExistingRun.id,
          supabase,
        })
      } catch (runXpRecoveryError) {
        console.error('[strava-sync-debug] xp_recovery_failed', {
          userId,
          runId: normalizedExistingRun.id,
          externalId: payload.external_id,
          createdAt: payload.created_at,
          error: runXpRecoveryError instanceof Error
            ? runXpRecoveryError.message
            : formatSupabaseError(runXpRecoveryError as {
                message?: string | null
                details?: string | null
                hint?: string | null
                code?: string | null
              }),
        })
      }
    }
  } else {
    runXp = await calculateRunXp({
      userId,
      createdAt: payload.created_at,
      distanceKm: payload.distance_km,
      elevationGainMeters: payload.elevation_gain_meters,
      externalSource: payload.external_source,
      supabase,
    })
  }

  payload.xp = normalizedExistingRun
    ? shouldAttemptXpRecovery
      ? Math.max(
          0,
          Math.round(Number(runXp?.xp ?? 0)) > 0
            ? Number(runXp?.xp ?? 0)
            : Number(normalizedExistingRun.xp ?? 0)
        )
      : Math.max(0, Math.round(Number(normalizedExistingRun.xp ?? 0)))
    : Math.max(0, Math.round(Number(runXp?.xp ?? 0)))
  payload.xp_breakdown = normalizedExistingRun
    ? shouldAttemptXpRecovery && runXp
      ? buildPersistedRunXpBreakdown(runXp)
      : normalizedExistingRun.xp_breakdown ?? null
    : runXp
      ? buildPersistedRunXpBreakdown(runXp)
      : null
  let finalCity = payload.city
  let finalRegion = payload.region
  let finalCountry = payload.country
  const startCoordinates = Array.isArray(activityForImport.start_latlng)
    ? activityForImport.start_latlng
    : null
  const endCoordinates = Array.isArray(activityForImport.end_latlng)
    ? activityForImport.end_latlng
    : null

  console.info('[strava-location-debug] before_decision', {
    activityId: activityForImport.id,
    payloadCity: payload.city,
    payloadRegion: payload.region,
    payloadCountry: payload.country,
    existingRunId: normalizedExistingRun?.id ?? null,
    existingCity: normalizedExistingRun?.city ?? null,
    existingRegion: normalizedExistingRun?.region ?? null,
    existingCountry: normalizedExistingRun?.country ?? null,
    startLatLng: startCoordinates,
    endLatLng: endCoordinates,
  })

  if (!finalCity) {
    if (normalizedExistingRun?.city) {
      console.info('[strava-location-debug] decision_branch', {
        activityId: activityForImport.id,
        branch: 'preserving_existing_db_location',
      })
      finalCity = normalizedExistingRun.city
      finalRegion = normalizedExistingRun.region
      finalCountry = normalizedExistingRun.country
    } else {
      const startCoordinatesAreUsable =
        Array.isArray(activityForImport.start_latlng) && activityForImport.start_latlng.length === 2
      const endCoordinatesAreUsable =
        Array.isArray(activityForImport.end_latlng) && activityForImport.end_latlng.length === 2
      const coordinates = getReverseGeocodeCoordinates(activityForImport)

      if (coordinates) {
        console.info('[strava-location-debug] decision_branch', {
          activityId: activityForImport.id,
          branch: startCoordinatesAreUsable ? 'calling_start_latlng_geocode' : 'calling_end_latlng_geocode',
          lat: coordinates.lat,
          lng: coordinates.lng,
        })
        const geocodedLocation = await reverseGeocode(coordinates.lat, coordinates.lng)

        if (geocodedLocation) {
          console.info('[strava-location-debug] geocode_result', {
            activityId: activityForImport.id,
            city: geocodedLocation.city,
            region: geocodedLocation.region,
            country: geocodedLocation.country,
          })
          finalCity = geocodedLocation.city
          finalRegion = geocodedLocation.region
          finalCountry = geocodedLocation.country
        } else {
          console.info('[strava-location-debug] geocode_result', {
            activityId: activityForImport.id,
            city: null,
            region: null,
            country: null,
          })
        }
      } else if (endCoordinatesAreUsable || startCoordinatesAreUsable) {
        console.info('[strava-location-debug] decision_branch', {
          activityId: activityForImport.id,
          branch: 'skipping_due_to_invalid_coordinates',
        })
      } else {
        console.info('[strava-location-debug] decision_branch', {
          activityId: activityForImport.id,
          branch: 'skipping_because_no_coordinates',
        })
      }
    }
  } else {
    console.info('[strava-location-debug] decision_branch', {
      activityId: activityForImport.id,
      branch: 'using_strava_payload',
    })
  }

  finalCity = finalCity ?? normalizedExistingRun?.city ?? null
  finalRegion = finalRegion ?? normalizedExistingRun?.region ?? null
  finalCountry = finalCountry ?? normalizedExistingRun?.country ?? null

  console.info('[strava-location-debug] before_db_write', {
    activityId: activityForImport.id,
    path: normalizedExistingRun ? 'update' : 'insert',
    finalCity,
    finalRegion,
    finalCountry,
  })

  payload.city = finalCity
  payload.region = finalRegion
  payload.country = finalCountry

  if (!normalizedExistingRun) {
    const previousTotalXp = await loadProfileTotalXp(userId, { supabase })

    console.info('[strava-webhook-debug] insert_branch', {
      userId,
      activityId: activityForImport.id,
      externalId: payload.external_id,
    })

    const { data: insertedRun, error: insertError } = await supabase
      .from('runs')
      .insert(payload)
      .select('id')
      .single()

    if (insertError) {
      console.error('[strava-sync-debug] run_insert_failed', {
        userId,
        activityId: activityForImport.id,
        externalId: payload.external_id,
        message: insertError.message,
        details: insertError.details ?? null,
        hint: insertError.hint ?? null,
        code: insertError.code ?? null,
      })
      // #region agent log
      if (options.debugRunId) {
        fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: options.debugRunId, hypothesisId: 'H4', location: 'lib/strava/strava-sync.ts:importStravaActivityForUser:insert_error', message: 'Run insert failed', data: { userId, externalId: payload.external_id, errorCode: insertError.code ?? null, errorMessage: insertError.message }, timestamp: Date.now() }) }).catch(() => {})
      }
      // #endregion
      if (isUniqueViolationError(insertError)) {
        const resolvedRunId = await resolveExistingStravaRunIdForSupplementalSync(
          supabase,
          payload.external_id
        )

        console.info('[strava-photo-debug] existing_run_resolved', {
          activityId: activityForImport.id,
          externalId: payload.external_id,
          outcome: options.updateExisting ? 'updated' : 'skipped_existing',
          inserted: false,
          updated: Boolean(options.updateExisting),
          skipped: !options.updateExisting,
          resolvedRunId,
        })

        if (resolvedRunId) {
          if (options.accessToken) {
            logDeferredHotPathSupplementalSync({
              runId: resolvedRunId,
              activityId: activityForImport.id,
              outcome: options.updateExisting ? 'updated' : 'skipped_existing',
              reason: 'fresh_import_priority',
            })
          }
        }

        // #region agent log
        if (options.debugRunId) {
          fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: options.debugRunId, hypothesisId: 'H3', location: 'lib/strava/strava-sync.ts:importStravaActivityForUser:unique_violation', message: 'Run insert hit unique constraint', data: { userId, externalId: payload.external_id, updateExisting: Boolean(options.updateExisting) }, timestamp: Date.now() }) }).catch(() => {})
        }
        // #endregion
        return {
          status: options.updateExisting ? 'updated' : 'skipped_existing',
          activityId: payload.external_id,
          runId: resolvedRunId ?? null,
        }
      }

      throw new Error(formatSupabaseError(insertError))
    }

    console.info('[strava-location-debug] after_db_write', {
      activityId: activityForImport.id,
      path: 'insert',
      runId: insertedRun?.id ?? null,
      attemptedCity: payload.city,
      attemptedRegion: payload.region,
      attemptedCountry: payload.country,
    })

    if (insertedRun?.id) {
      await upsertPersonalRecordsFromStravaPayload({
        supabase,
        userId,
        runId: insertedRun.id,
        rawStravaPayload: payload.raw_strava_payload,
        fallbackRecordDate: payload.created_at,
        fallbackStravaActivityId: activityForImport.id,
      })
    }

    const nextTotalXp = await loadProfileTotalXp(userId, { supabase })
    const levelState = getLevelUpState(previousTotalXp, nextTotalXp)

    if (insertedRun?.id && options.accessToken) {
      console.info('[strava-photo-debug] existing_run_resolved', {
        activityId: activityForImport.id,
        externalId: payload.external_id,
        outcome: 'imported',
        inserted: true,
        updated: false,
        skipped: false,
        resolvedRunId: insertedRun.id,
      })

      logDeferredHotPathSupplementalSync({
        runId: insertedRun.id,
        activityId: activityForImport.id,
        outcome: 'imported',
        reason: 'fresh_import_priority',
      })
    }

    if (insertedRun?.id) {
      await autoLinkRunToRaceEvent({
        supabase,
        userId,
        runId: insertedRun.id,
        runCreatedAt: payload.created_at,
        runDistanceMeters: payload.distance_meters,
      })
    }

    return {
      status: 'imported',
      activityId: payload.external_id,
      runId: insertedRun?.id ?? null,
      xpGained: Math.max(0, Math.round(Number(runXp?.xp ?? 0))),
      breakdown: runXp?.breakdown ?? [],
      levelUp: levelState.levelUp,
      newLevel: levelState.newLevel,
    }
  }

  const requiresOwnerRepair = normalizedExistingRun.user_id !== userId

  console.info('[strava-webhook-debug] update_branch', {
    userId,
    runId: normalizedExistingRun.id,
    activityId: activityForImport.id,
    externalId: payload.external_id,
    requiresOwnerRepair,
  })

  if (shouldDebugRunDetailSeries({ runId: normalizedExistingRun.id, activityId: activityForImport.id })) {
    console.info('[run-detail-debug] target_run_selected_for_processing', {
      runId: normalizedExistingRun.id,
      activityId: activityForImport.id,
      path: !options.updateExisting && !requiresOwnerRepair ? 'skipped_existing_branch' : 'update_existing_branch',
      accessTokenPresent: Boolean(options.accessToken),
      requiresOwnerRepair,
    })
  }

  const resolvedExistingRunId = await resolveExistingStravaRunIdForSupplementalSync(
    supabase,
    payload.external_id
  )
  const existingRunIdForSupplementalSync = resolvedExistingRunId ?? normalizedExistingRun.id

  console.info('[strava-photo-debug] existing_run_resolved', {
    activityId: activityForImport.id,
    externalId: payload.external_id,
    outcome: !options.updateExisting && !requiresOwnerRepair ? 'skipped_existing' : 'updated',
    inserted: false,
    updated: options.updateExisting || requiresOwnerRepair,
    skipped: !options.updateExisting && !requiresOwnerRepair,
    resolvedRunId: existingRunIdForSupplementalSync,
    initialExistingRunId: normalizedExistingRun.id,
  })

  if (!options.updateExisting && !requiresOwnerRepair) {
    await autoLinkRunToRaceEvent({
      supabase,
      userId,
      runId: existingRunIdForSupplementalSync,
      runCreatedAt: payload.created_at,
      runDistanceMeters: payload.distance_meters,
    })

    if (options.accessToken) {
      logDeferredHotPathSupplementalSync({
        runId: existingRunIdForSupplementalSync,
        activityId: activityForImport.id,
        outcome: 'skipped_existing',
        reason: 'fresh_import_priority',
      })
    }
    // #region agent log
    if (options.debugRunId) {
      fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: options.debugRunId, hypothesisId: 'H3', location: 'lib/strava/strava-sync.ts:importStravaActivityForUser:duplicate_skip', message: 'Skipping existing Strava run', data: { userId, externalId: payload.external_id, existingRunUserId: normalizedExistingRun.user_id }, timestamp: Date.now() }) }).catch(() => {})
    }
    // #endregion
    return {
      status: 'skipped_existing',
      activityId: payload.external_id,
      runId: existingRunIdForSupplementalSync,
    }
  }

  const runUpdatePayload: {
    user_id: string
    title: string
    distance_km: number
    distance_meters: number
    duration_minutes: number
    duration_seconds: number
    moving_time_seconds: number
    elapsed_time_seconds: number
    average_pace_seconds: number
    elevation_gain_meters: number
    average_heartrate: number | null
    max_heartrate: number | null
    map_polyline: string | null
    calories: number | null
    average_cadence: number | null
    raw_strava_payload: Record<string, unknown> | null
    description?: string | null
    photo_count: number | null
    city: string | null
    region: string | null
    country: string | null
    sport_type: string | null
    achievement_count: number | null
    strava_synced_at: string
    created_at: string
    xp: number
    xp_breakdown: PersistedRunXpBreakdown | null
    name?: string
  } = {
    user_id: payload.user_id,
    title: payload.title,
    distance_km: payload.distance_km,
    distance_meters: payload.distance_meters,
    duration_minutes: payload.duration_minutes,
    duration_seconds: payload.duration_seconds,
    moving_time_seconds: payload.moving_time_seconds,
    elapsed_time_seconds: payload.elapsed_time_seconds,
    average_pace_seconds: payload.average_pace_seconds,
    elevation_gain_meters: payload.elevation_gain_meters,
    average_heartrate: payload.average_heartrate,
    max_heartrate: payload.max_heartrate,
    map_polyline: payload.map_polyline,
    calories: payload.calories,
    average_cadence: payload.average_cadence,
    raw_strava_payload: payload.raw_strava_payload,
    photo_count: payload.photo_count,
    city: payload.city,
    region: payload.region,
    country: payload.country,
    sport_type: payload.sport_type,
    achievement_count: payload.achievement_count,
    strava_synced_at: payload.strava_synced_at,
    created_at: payload.created_at,
    xp: payload.xp,
    xp_breakdown: payload.xp_breakdown,
  }

  const previousTotalXp = await loadProfileTotalXp(userId, { supabase })

  if (!normalizedExistingRun.name_manually_edited) {
    runUpdatePayload.name = payload.name
  }

  if (!normalizedExistingRun.description_manually_edited) {
    runUpdatePayload.description = payload.description
  }

  try {
    await updateRunShoeImpact(supabase, {
      previousRun: {
        userId: normalizedExistingRun.user_id,
        shoeId: normalizedExistingRun.shoe_id,
        distanceMeters: normalizedExistingRun.distance_meters,
      },
      nextRun: {
        userId: normalizedExistingRun.user_id,
        shoeId: normalizedExistingRun.shoe_id,
        distanceMeters: payload.distance_meters,
      },
    })
  } catch (shoeImpactError) {
    throw new Error(
      shoeImpactError instanceof Error ? shoeImpactError.message : 'strava_shoe_impact_failed'
    )
  }

  const { error: updateError } = await supabase
    .from('runs')
    .update(runUpdatePayload)
    .eq('id', normalizedExistingRun.id)

  if (updateError) {
    console.error('[strava-sync-debug] run_update_failed', {
      userId,
      runId: normalizedExistingRun.id,
      activityId: activityForImport.id,
      externalId: payload.external_id,
      message: updateError.message,
      details: updateError.details ?? null,
      hint: updateError.hint ?? null,
      code: updateError.code ?? null,
    })
    await updateRunShoeImpact(supabase, {
      previousRun: {
        userId: normalizedExistingRun.user_id,
        shoeId: normalizedExistingRun.shoe_id,
        distanceMeters: payload.distance_meters,
      },
      nextRun: {
        userId: normalizedExistingRun.user_id,
        shoeId: normalizedExistingRun.shoe_id,
        distanceMeters: normalizedExistingRun.distance_meters,
      },
    }).catch(() => {})

    throw new Error(formatSupabaseError(updateError))
  }

  console.info('[strava-location-debug] after_db_write', {
    activityId: activityForImport.id,
    path: 'update',
    runId: normalizedExistingRun.id,
    attemptedCity: runUpdatePayload.city,
    attemptedRegion: runUpdatePayload.region,
    attemptedCountry: runUpdatePayload.country,
  })

  await upsertPersonalRecordsFromStravaPayload({
    supabase,
    userId,
    runId: existingRunIdForSupplementalSync,
    rawStravaPayload: payload.raw_strava_payload,
    fallbackRecordDate: payload.created_at,
    fallbackStravaActivityId: activityForImport.id,
  })

  const nextTotalXp = await loadProfileTotalXp(userId, { supabase })
  const levelState = getLevelUpState(previousTotalXp, nextTotalXp)

  if (options.accessToken) {
    logDeferredHotPathSupplementalSync({
      runId: existingRunIdForSupplementalSync,
      activityId: activityForImport.id,
      outcome: 'updated',
      reason: 'fresh_import_priority',
    })
  } else if (shouldDebugRunDetailSeries({ runId: existingRunIdForSupplementalSync, activityId: activityForImport.id })) {
    console.warn('[run-detail-debug] target_run_skipped', {
      runId: existingRunIdForSupplementalSync,
      activityId: activityForImport.id,
      reason: 'missing_access_token',
    })
  }

  await autoLinkRunToRaceEvent({
    supabase,
    userId,
    runId: existingRunIdForSupplementalSync,
    runCreatedAt: payload.created_at,
    runDistanceMeters: payload.distance_meters,
  })

  return {
    status: 'updated',
    activityId: payload.external_id,
    runId: existingRunIdForSupplementalSync,
    xpGained: shouldAttemptXpRecovery ? Math.max(0, Math.round(Number(runXp?.xp ?? 0))) : 0,
    breakdown: shouldAttemptXpRecovery ? runXp?.breakdown ?? [] : [],
    levelUp: levelState.levelUp,
    newLevel: levelState.newLevel,
  }
}

export async function importHistoricalStravaActivityByIdForUser(
  userId: string,
  stravaActivityId: number
) {
  const normalizedUserId = userId.trim()
  const normalizedActivityId = Math.round(Number(stravaActivityId))

  if (!normalizedUserId || !Number.isFinite(normalizedActivityId) || normalizedActivityId <= 0) {
    return null
  }

  const supabase = createSupabaseAdminClient()
  const externalId = String(normalizedActivityId)
  const { data: existingRun, error: existingRunError } = await supabase
    .from('runs')
    .select('id, user_id')
    .eq('external_source', STRAVA_EXTERNAL_SOURCE)
    .eq('external_id', externalId)
    .maybeSingle()

  if (existingRunError) {
    throw new Error(formatSupabaseError(existingRunError))
  }

  if (existingRun?.id && existingRun.user_id === normalizedUserId) {
    return existingRun.id
  }

  let connection: StravaConnectionRow | null = null

  try {
    connection = await getStravaConnectionForUser(normalizedUserId)
  } catch (error) {
    if (error instanceof StravaReconnectRequiredError) {
      return null
    }

    throw error
  }

  if (!connection) {
    return null
  }

  const activity = await fetchStravaActivityById(connection.access_token, normalizedActivityId)
  const result = await importStravaActivityForUser(normalizedUserId, activity, {
    updateExisting: true,
  })

  return result.runId ?? null
}

export async function syncStravaRuns(
  userId: string,
  options: SyncStravaRunsOptions = {}
): Promise<StravaInitialSyncResult> {
  const targetDebugRunId = options.debugRunId?.trim() || undefined
  const allowTargetedDebugOwnerBypass = Boolean(
    targetDebugRunId && options.allowTargetedDebugOwnerBypass
  )
  const sessionDebugId = `sync-${Date.now()}-${userId.slice(0, 8)}`
  const syncMode: StravaSyncMode = options.mode ?? 'incremental'
  let connection: StravaConnectionRow | null = null

  console.info('[strava-sync-debug] debug_context', {
    userId,
    sessionDebugId,
    targetDebugRunId: targetDebugRunId ?? null,
  })

  try {
    connection = await getStravaConnectionForUser(userId)
  } catch (caughtError) {
    if (caughtError instanceof StravaReconnectRequiredError) {
      return {
        ok: false,
        step: 'reconnect_required',
      }
    }

    throw caughtError
  }

  if (!connection) {
    return {
      ok: false,
      step: 'missing_connection',
      debug: {
        step: 'missing_connection',
        userId,
        athleteId: null,
        connectionId: null,
        totalActivitiesFetched: 0,
        firstFetchedActivityId: null,
        firstFetchedActivityType: null,
        runActivitiesCount: 0,
        imported: 0,
        skipped: 0,
        failed: 0,
        firstFailure: null,
        afterParamUsed: null,
        latestExistingStravaRunAt: null,
      },
    }
  }

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: sessionDebugId, hypothesisId: 'H5', location: 'lib/strava/strava-sync.ts:syncStravaRuns:connection_loaded', message: 'Loaded Strava connection for user', data: { userId, connectionId: connection.id, connectionUserId: connection.user_id, athleteId: connection.strava_athlete_id, status: connection.status, expiresAt: connection.expires_at, targetDebugRunId: targetDebugRunId ?? null }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  if (connection.status === 'reconnect_required') {
    return {
      ok: false,
      step: 'reconnect_required',
      debug: {
        step: 'reconnect_required',
        userId,
        athleteId: connection.strava_athlete_id,
        connectionId: connection.id,
        totalActivitiesFetched: 0,
        firstFetchedActivityId: null,
        firstFetchedActivityType: null,
        runActivitiesCount: 0,
        imported: 0,
        skipped: 0,
        failed: 0,
        firstFailure: null,
        afterParamUsed: null,
        latestExistingStravaRunAt: null,
      },
    }
  }

  if (hasActiveStravaRateLimitCooldown(connection)) {
    logStravaCooldownActive('sync_start_blocked', connection, {
      mode: syncMode,
      targetDebugRunId: targetDebugRunId ?? null,
    })
    return {
      ok: false,
      step: 'rate_limited',
    }
  }

  if (targetDebugRunId) {
    const supabase = createSupabaseAdminClient()
    const normalizedAuthUserId = userId.trim().toLowerCase()
    const normalizedConnectionUserId = connection.user_id.trim().toLowerCase()

    const { data: targetRun, error: targetRunError } = await supabase
      .from('runs')
      .select('id, user_id, external_source, external_id')
      .eq('id', targetDebugRunId)
      .eq('external_source', STRAVA_EXTERNAL_SOURCE)
      .maybeSingle()

    if (targetRunError) {
      throw new Error(targetRunError.message)
    }

    if (!targetRun) {
      return {
        ok: true,
        imported: 0,
        skipped: 0,
        failed: 0,
        totalRunsFetched: 0,
        errors: [],
        debug: {
          step: 'targeted_sync_complete',
          userId,
          athleteId: connection.strava_athlete_id,
          connectionId: connection.id,
          totalActivitiesFetched: 0,
          firstFetchedActivityId: null,
          firstFetchedActivityType: null,
          runActivitiesCount: 0,
          imported: 0,
          skipped: 0,
          failed: 0,
          firstFailure: null,
          afterParamUsed: null,
          latestExistingStravaRunAt: null,
          targetedRunId: targetDebugRunId,
          targetedActivityId: null,
          targetedSyncAttempted: false,
          targetedSyncSucceeded: false,
          targetedOwnerMismatch: false,
          targetedRunOwnerUserId: null,
        },
      }
    }

    const normalizedRunOwnerUserId = targetRun.user_id.trim().toLowerCase()
    const ownerCheckPassed =
      normalizedRunOwnerUserId === normalizedConnectionUserId ||
      normalizedRunOwnerUserId === normalizedAuthUserId

    if (!ownerCheckPassed && !allowTargetedDebugOwnerBypass) {
      console.warn('[run-detail-debug] target_run_owner_mismatch', {
        runId: targetDebugRunId,
        currentUserId: userId,
        connectionUserId: connection.user_id,
        ownerUserId: targetRun.user_id,
        externalSource: targetRun.external_source,
        externalId: targetRun.external_id,
      })

      return {
        ok: true,
        imported: 0,
        skipped: 0,
        failed: 0,
        totalRunsFetched: 0,
        errors: [],
        debug: {
          step: 'targeted_sync_complete',
          userId,
          athleteId: connection.strava_athlete_id,
          connectionId: connection.id,
          totalActivitiesFetched: 0,
          firstFetchedActivityId: null,
          firstFetchedActivityType: null,
          runActivitiesCount: 0,
          imported: 0,
          skipped: 0,
          failed: 0,
          firstFailure: null,
          afterParamUsed: null,
          latestExistingStravaRunAt: null,
          targetedRunId: targetDebugRunId,
          targetedActivityId: null,
          targetedSyncAttempted: false,
          targetedSyncSucceeded: false,
          targetedOwnerMismatch: true,
          targetedRunOwnerUserId: targetRun.user_id,
        },
      }
    }

    if (!ownerCheckPassed && allowTargetedDebugOwnerBypass) {
      console.info('[run-detail-debug] target_run_owner_mismatch_bypassed', {
        runId: targetDebugRunId,
        currentUserId: userId,
        connectionUserId: connection.user_id,
        ownerUserId: targetRun.user_id,
        externalSource: targetRun.external_source,
        externalId: targetRun.external_id,
      })
    }

    const targetedActivityId = Number(targetRun.external_id)

    if (!Number.isFinite(targetedActivityId) || targetedActivityId <= 0) {
      console.warn('[run-detail-debug] target_run_skipped', {
        runId: targetDebugRunId,
        externalId: targetRun.external_id,
        reason: 'invalid_external_id',
      })

      return {
        ok: true,
        imported: 0,
        skipped: 0,
        failed: 0,
        totalRunsFetched: 0,
        errors: [],
        debug: {
          step: 'targeted_sync_complete',
          userId,
          athleteId: connection.strava_athlete_id,
          connectionId: connection.id,
          totalActivitiesFetched: 0,
          firstFetchedActivityId: null,
          firstFetchedActivityType: null,
          runActivitiesCount: 0,
          imported: 0,
          skipped: 0,
          failed: 0,
          firstFailure: null,
          afterParamUsed: null,
          latestExistingStravaRunAt: null,
          targetedRunId: targetDebugRunId,
          targetedActivityId: null,
          targetedSyncAttempted: false,
          targetedSyncSucceeded: false,
          targetedOwnerMismatch: false,
          targetedRunOwnerUserId: targetRun.user_id,
        },
      }
    }

    const targetedActivity = await fetchStravaActivityById(connection.access_token, targetedActivityId)
    const detailedActivityDebug = {
      id: targetedActivity.id ?? null,
      type: targetedActivity.type ?? null,
      sport_type: targetedActivity.sport_type ?? null,
      description: targetedActivity.description ?? null,
      location_city: targetedActivity.location_city ?? null,
      location_state: targetedActivity.location_state ?? null,
      location_country: targetedActivity.location_country ?? null,
      start_latlng: targetedActivity.start_latlng ?? null,
      end_latlng: targetedActivity.end_latlng ?? null,
    }
    await importStravaActivityForUser(connection.user_id, targetedActivity, {
      updateExisting: true,
      debugRunId: targetDebugRunId,
      accessToken: connection.access_token,
    })

    const targetedSyncSucceeded = await syncRunSupplementalStravaDataForActivity(
      supabase,
      targetRun.id,
      targetedActivityId,
      connection.access_token,
      targetDebugRunId,
      connection.id
    )

    return {
      ok: true,
      imported: 0,
      skipped: 0,
      failed: 0,
      totalRunsFetched: 0,
      errors: [],
      debug: {
        step: 'targeted_sync_complete',
        userId,
        athleteId: connection.strava_athlete_id,
        connectionId: connection.id,
        totalActivitiesFetched: 0,
        firstFetchedActivityId: null,
        firstFetchedActivityType: null,
        runActivitiesCount: 0,
        imported: 0,
        skipped: 0,
        failed: 0,
        firstFailure: null,
        afterParamUsed: null,
        latestExistingStravaRunAt: null,
        targetedRunId: targetDebugRunId,
        targetedActivityId,
        targetedSyncAttempted: true,
        targetedSyncSucceeded,
        targetedOwnerMismatch: false,
        targetedRunOwnerUserId: targetRun.user_id,
        detailedActivityDebug,
      },
    }
  }

  let latestImportedRun: { created_at: string } | null = null

  if (syncMode === 'incremental') {
    const supabase = createSupabaseAdminClient()
    const { data: latestImportedRunData, error: latestImportedRunError } = await supabase
      .from('runs')
      .select('created_at')
      .eq('user_id', userId)
      .eq('external_source', STRAVA_EXTERNAL_SOURCE)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestImportedRunError) {
      throw new Error(latestImportedRunError.message)
    }

    latestImportedRun = latestImportedRunData
  }

  const latestImportedRunTimestamp = latestImportedRun?.created_at
    ? Math.floor(new Date(latestImportedRun.created_at).getTime() / 1000)
    : null
  const afterUnixSeconds = syncMode === 'backfill'
    ? INITIAL_SYNC_CUTOFF_UNIX_SECONDS
    : latestImportedRunTimestamp
      ? Math.max(0, latestImportedRunTimestamp - 1)
      : INITIAL_SYNC_CUTOFF_UNIX_SECONDS

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: sessionDebugId, hypothesisId: 'H1', location: 'lib/strava/strava-sync.ts:syncStravaRuns:after_param', message: 'Computed Strava activities after parameter', data: { userId, connectionId: connection.id, latestExistingStravaRunAt: latestImportedRun?.created_at ?? null, afterParamUsed: afterUnixSeconds, targetDebugRunId: targetDebugRunId ?? null }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  let activities: StravaActivitySummary[] = []

  console.info('[strava-sync-debug] before_fetch_activities', {
    userId,
    connectionId: connection.id,
    afterUnixSeconds,
    sessionDebugId,
    targetDebugRunId: targetDebugRunId ?? null,
  })

  try {
    activities = await fetchStravaActivities(connection.access_token, afterUnixSeconds)
  } catch (caughtError) {
    if (caughtError instanceof StravaApiError && caughtError.status === 429) {
      const rateLimitedUntil = await recordStravaRateLimitCooldown(connection.id, 'sync_activity_list', {
        userId,
        afterUnixSeconds,
      })
      console.warn('[strava-sync] rate_limited', {
        userId,
        connectionId: connection.id,
        afterUnixSeconds,
        rateLimitedUntil,
      })
      return {
        ok: false,
        step: 'rate_limited',
      }
    }

    if (isStravaAuthError(caughtError)) {
      await markStravaConnectionReconnectRequired(connection.id)
      return {
        ok: false,
        step: 'reconnect_required',
      }
    }

    throw caughtError
  }

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: sessionDebugId, hypothesisId: 'H1', location: 'lib/strava/strava-sync.ts:syncStravaRuns:activities_fetched', message: 'Fetched Strava activities list', data: { userId, connectionId: connection.id, totalActivitiesFetched: activities.length, firstFetchedActivityId: activities[0] ? String(activities[0].id) : null, firstFetchedActivityType: activities[0]?.type ?? null, firstFiveFetchedActivities: activities.slice(0, 5).map((activity) => ({ id: String(activity.id), type: activity.type ?? null })), targetDebugRunId: targetDebugRunId ?? null }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  const runActivities = activities
    .filter((activity) => isValidStravaRun(activity) && isOnOrAfterInitialSyncCutoff(activity.start_date))
    .sort((left, right) => new Date(left.start_date).getTime() - new Date(right.start_date).getTime())

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: sessionDebugId, hypothesisId: 'H2', location: 'lib/strava/strava-sync.ts:syncStravaRuns:activities_filtered', message: 'Filtered Strava activities to valid runs', data: { userId, connectionId: connection.id, totalActivitiesFetched: activities.length, runActivitiesCount: runActivities.length, firstFetchedActivityId: activities[0] ? String(activities[0].id) : null, firstFetchedActivityType: activities[0]?.type ?? null, targetDebugRunId: targetDebugRunId ?? null }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  let imported = 0
  let skipped = 0
  const errors: StravaSyncRowErrorDetail[] = []
  let xpGained = 0
  let workoutXpGained = 0
  let distanceXpGained = 0
  let highestLevelUp: number | null = null

  for (const activity of runActivities) {
    let payload: StravaRunInsertPayload | null = null

    try {
      payload = buildRunInsertPayload(userId, activity)
      const result = await importStravaActivityForUser(userId, activity, {
        updateExisting: true,
        debugRunId: targetDebugRunId,
        accessToken: connection.access_token,
      })

      if (result.status === 'imported') {
        imported += 1
      } else if (result.status === 'skipped_existing' || result.status === 'updated') {
        skipped += 1
      }

      xpGained += Number(result.xpGained ?? 0)
      for (const item of result.breakdown ?? []) {
        if (item.label === 'Тренировка') {
          workoutXpGained += Number(item.value ?? 0)
        } else if (item.label === 'Дистанция') {
          distanceXpGained += Number(item.value ?? 0)
        }
      }

      if (result.levelUp && Number.isFinite(result.newLevel)) {
        highestLevelUp = Math.max(highestLevelUp ?? 0, Number(result.newLevel))
      }

      // #region agent log
      fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: sessionDebugId, hypothesisId: 'H3', location: 'lib/strava/strava-sync.ts:syncStravaRuns:activity_outcome', message: 'Filtered activity processed', data: { userId, connectionId: connection.id, activityId: String(activity.id), activityType: activity.type ?? null, outcome: result.status, targetDebugRunId: targetDebugRunId ?? null }, timestamp: Date.now() }) }).catch(() => {})
      // #endregion
    } catch (caughtError) {
      const errorDetail: StravaSyncRowErrorDetail = {
        activityId: String(activity.id),
        error: caughtError instanceof Error
          ? caughtError.message
          : formatSupabaseError(caughtError as {
              message?: string | null
              details?: string | null
              hint?: string | null
              code?: string | null
            }),
      }

      if (caughtError instanceof StravaSyncRowError) {
        errorDetail.field = caughtError.field
        errorDetail.value = caughtError.value
      } else if (payload) {
        const likelyInvalidField = findLikelyInvalidIntegerField(payload)

        if (likelyInvalidField) {
          errorDetail.field = likelyInvalidField.field
          errorDetail.value = likelyInvalidField.value
        }
      }

      if (errors.length < MAX_SYNC_ERROR_DETAILS) {
        errors.push(errorDetail)
      }

      console.error('Strava sync row failed', {
        activityId: activity.id,
        error: errorDetail.error,
        field: errorDetail.field ?? null,
        value: errorDetail.value ?? null,
      })

      // #region agent log
      fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: sessionDebugId, hypothesisId: 'H4', location: 'lib/strava/strava-sync.ts:syncStravaRuns:activity_failed', message: 'Filtered activity failed during import', data: { userId, connectionId: connection.id, activityId: String(activity.id), activityType: activity.type ?? null, outcome: 'failed', error: errorDetail.error, targetDebugRunId: targetDebugRunId ?? null }, timestamp: Date.now() }) }).catch(() => {})
      // #endregion
    }
  }

  if (targetDebugRunId) {
    await backfillMissingRunDetailSeriesForUser(userId, connection.access_token, targetDebugRunId, connection.id)
    await backfillMissingHeartratePointsForUser(userId, connection.access_token, connection.id)
  } else {
    console.info('Strava supplemental backfill deferred after sync', {
      userId,
      reason: 'fresh_import_priority',
      deferredRequests: ['activities/{id}/streams', 'activities/{id}', 'activities/{id}/photos'],
    })
  }

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: sessionDebugId, hypothesisId: 'H5', location: 'lib/strava/strava-sync.ts:syncStravaRuns:before_touch_connection', message: 'About to update last_synced_at', data: { userId, connectionId: connection.id, imported, skipped, filteredActivitiesCount: runActivities.length, importedIsZero: imported === 0, targetDebugRunId: targetDebugRunId ?? null }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  await touchStravaConnection(connection.id)

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: sessionDebugId, hypothesisId: 'H5', location: 'lib/strava/strava-sync.ts:syncStravaRuns:after_touch_connection', message: 'Updated last_synced_at', data: { userId, connectionId: connection.id, imported, skipped, filteredActivitiesCount: runActivities.length, importedIsZero: imported === 0, targetDebugRunId: targetDebugRunId ?? null }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  const failed = runActivities.length - imported - skipped
  const firstFailure = errors[0] ?? null
  const breakdown: XpBreakdownItem[] = []

  if (workoutXpGained > 0) {
    breakdown.push({ label: 'Тренировка', value: workoutXpGained })
  }

  if (distanceXpGained > 0) {
    breakdown.push({ label: 'Дистанция', value: distanceXpGained })
  }

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: sessionDebugId, hypothesisId: 'H4', location: 'lib/strava/strava-sync.ts:syncStravaRuns:summary', message: 'Completed Strava sync summary', data: { userId, athleteId: connection.strava_athlete_id, connectionId: connection.id, totalActivitiesFetched: activities.length, firstFetchedActivityId: activities[0] ? String(activities[0].id) : null, firstFetchedActivityType: activities[0]?.type ?? null, runActivitiesCount: runActivities.length, imported, skipped, failed, firstFailure, afterParamUsed: afterUnixSeconds, latestExistingStravaRunAt: latestImportedRun?.created_at ?? null, targetDebugRunId: targetDebugRunId ?? null }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  return {
    ok: true,
    imported,
    skipped,
    failed,
    totalRunsFetched: runActivities.length,
    xpGained,
    breakdown,
    levelUp: highestLevelUp !== null,
    newLevel: highestLevelUp,
    errors,
    debug: {
      step: 'initial_sync_complete',
      userId,
      athleteId: connection.strava_athlete_id,
      connectionId: connection.id,
      totalActivitiesFetched: activities.length,
      firstFetchedActivityId: activities[0] ? String(activities[0].id) : null,
      firstFetchedActivityType: activities[0]?.type ?? null,
      runActivitiesCount: runActivities.length,
      imported,
      skipped,
      failed,
      firstFailure,
      afterParamUsed: afterUnixSeconds,
      latestExistingStravaRunAt: latestImportedRun?.created_at ?? null,
    },
  }
}

export async function backfillStravaSupplementalDataForRun(userId: string, runId: string) {
  const result = await syncStravaRuns(userId, {
    mode: 'backfill',
    debugRunId: runId,
  })

  return Boolean(result.ok && result.debug?.targetedSyncSucceeded)
}
