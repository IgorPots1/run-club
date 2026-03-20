import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { fetchActivityStreams, fetchStravaActivities, isStravaAuthError, isStravaNotFoundError, refreshStravaAccessToken } from './strava-client'
import type { StravaActivityStreams, StravaActivitySummary, StravaActivityType, StravaInitialSyncResult } from './strava-types'

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
  created_at: string
  external_source: string
  external_id: string
  xp: number
}

type StravaConnectionRow = {
  id: string
  user_id: string
  strava_athlete_id: number
  access_token: string
  refresh_token: string
  expires_at: string
  last_synced_at: string | null
  status: string
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

type MissingHeartrateBackfillRunRow = {
  id: string
  external_id: string | null
}

type StravaImportOutcome = 'imported' | 'updated' | 'skipped_existing' | 'skipped_invalid'

type StravaImportResult = {
  status: StravaImportOutcome
  activityId: string
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
}

type RunDetailSeriesPoint = {
  x: number
  y: number
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

function normalizeIntegerField(field: string, value: number) {
  if (!Number.isFinite(value)) {
    throw new StravaSyncRowError(`Invalid numeric value for ${field}`, {
      field,
      value: String(value),
    })
  }

  return Math.round(value)
}

function toXp(distanceKm: number) {
  return Math.max(0, normalizeIntegerField('xp', 50 + distanceKm * 10))
}

function buildBucketedSeries(
  values: number[] | undefined,
  toYValue: (value: number) => number | null
): RunDetailSeriesPoint[] | null {
  if (!Array.isArray(values) || values.length === 0) {
    return null
  }

  const bucketCount = Math.min(MAX_SERIES_POINTS, values.length)
  const points: RunDetailSeriesPoint[] = []

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const start = Math.floor((bucketIndex * values.length) / bucketCount)
    const end = Math.floor(((bucketIndex + 1) * values.length) / bucketCount)
    const bucketValues = values
      .slice(start, Math.max(start + 1, end))
      .map(toYValue)
      .filter((value): value is number => Number.isFinite(value))

    if (bucketValues.length === 0) {
      continue
    }

    const averageValue = bucketValues.reduce((sum, value) => sum + value, 0) / bucketValues.length
    points.push({
      x: points.length,
      y: Math.round(averageValue),
    })
  }

  return points.length >= MIN_SERIES_POINTS ? points : null
}

function buildPaceSeriesPoints(streams: StravaActivityStreams) {
  return buildBucketedSeries(streams.velocity_smooth, (velocityMetersPerSecond) => {
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
  const points = buildBucketedSeries(heartrateValues, (heartrate) => {
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

async function syncRunDetailSeriesForActivity(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: string,
  activityId: number,
  accessToken: string,
  debugRunId?: string
): Promise<boolean> {
  const shouldDebug =
    shouldDebugRunDetailSeries({ runId, activityId }) || matchesDebugRunId(runId, debugRunId)

  try {
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
      })
    }

    const { error } = await supabase
      .from('run_detail_series')
      .upsert(
        {
          run_id: runId,
          pace_points: pacePoints,
          heartrate_points: heartratePoints,
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

async function backfillMissingRunDetailSeriesForUser(
  userId: string,
  accessToken: string,
  debugRunId?: string
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

    await syncRunDetailSeriesForActivity(supabase, targetRun.id, activityId, accessToken, debugRunId)
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
    .select('run_id')
    .in('run_id', candidateRuns.map((run) => run.id))

  if (existingSeriesError) {
    console.warn('Strava run detail series existing rows lookup failed', {
      userId,
      error: existingSeriesError.message,
    })
    return
  }

  const existingRunIds = new Set(
    (existingSeriesRows ?? [])
      .map((row) => row.run_id)
      .filter((runId): runId is string => typeof runId === 'string' && runId.length > 0)
  )

  const missingRuns = candidateRuns.filter((run) => !existingRunIds.has(run.id))

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
      fallback_reason: 'historical_missing_detail_series',
    })

    await syncRunDetailSeriesForActivity(supabase, run.id, activityId, accessToken)
  }
}

async function backfillMissingHeartratePointsForUser(userId: string, accessToken: string) {
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
    created_at: new Date(activity.start_date).toISOString(),
    external_source: STRAVA_EXTERNAL_SOURCE,
    external_id: String(activity.id),
    xp: toXp(distanceKm),
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
    .select('id, user_id, strava_athlete_id, access_token, refresh_token, expires_at, last_synced_at, status')
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
  const activityMatchesDebugRun = shouldDebugRunDetailSeries({ activityId: activity.id })

  if (!isValidStravaRun(activity)) {
    if (activityMatchesDebugRun) {
      console.warn('[run-detail-debug] target_run_skipped', {
        activityId: activity.id,
        reason: 'invalid_strava_run',
      })
    }
    return {
      status: 'skipped_invalid',
      activityId: String(activity.id),
    }
  }

  const supabase = createSupabaseAdminClient()
  const payload = buildRunInsertPayload(userId, activity)
  const { data: existingRun, error: existingRunError } = await supabase
    .from('runs')
    .select('id, user_id')
    .eq('external_source', STRAVA_EXTERNAL_SOURCE)
    .eq('external_id', payload.external_id)
    .maybeSingle()

  if (existingRunError) {
    throw new Error(existingRunError.message)
  }

  if (!existingRun) {
    console.info('[strava-webhook-debug] insert_branch', {
      userId,
      activityId: activity.id,
      externalId: payload.external_id,
    })

    const { data: insertedRun, error: insertError } = await supabase
      .from('runs')
      .insert(payload)
      .select('id')
      .single()

    if (insertError) {
      // #region agent log
      options.debugRunId
        ? fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: options.debugRunId, hypothesisId: 'H4', location: 'lib/strava/strava-sync.ts:importStravaActivityForUser:insert_error', message: 'Run insert failed', data: { userId, externalId: payload.external_id, errorCode: insertError.code ?? null, errorMessage: insertError.message }, timestamp: Date.now() }) }).catch(() => {})
        : undefined
      // #endregion
      if (isUniqueViolationError(insertError)) {
        // #region agent log
        options.debugRunId
          ? fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: options.debugRunId, hypothesisId: 'H3', location: 'lib/strava/strava-sync.ts:importStravaActivityForUser:unique_violation', message: 'Run insert hit unique constraint', data: { userId, externalId: payload.external_id, updateExisting: Boolean(options.updateExisting) }, timestamp: Date.now() }) }).catch(() => {})
          : undefined
        // #endregion
        return {
          status: options.updateExisting ? 'updated' : 'skipped_existing',
          activityId: payload.external_id,
        }
      }

      throw new Error(insertError.message)
    }

    if (insertedRun?.id && options.accessToken) {
      await syncRunDetailSeriesForActivity(
        supabase,
        insertedRun.id,
        activity.id,
        options.accessToken,
        options.debugRunId
      )
    }

    return {
      status: 'imported',
      activityId: payload.external_id,
    }
  }

  const requiresOwnerRepair = existingRun.user_id !== userId

  console.info('[strava-webhook-debug] update_branch', {
    userId,
    runId: existingRun.id,
    activityId: activity.id,
    externalId: payload.external_id,
    requiresOwnerRepair,
  })

  if (shouldDebugRunDetailSeries({ runId: existingRun.id, activityId: activity.id })) {
    console.info('[run-detail-debug] target_run_selected_for_processing', {
      runId: existingRun.id,
      activityId: activity.id,
      path: !options.updateExisting && !requiresOwnerRepair ? 'skipped_existing_branch' : 'update_existing_branch',
      accessTokenPresent: Boolean(options.accessToken),
      requiresOwnerRepair,
    })
  }

  if (!options.updateExisting && !requiresOwnerRepair) {
    if (shouldDebugRunDetailSeries({ runId: existingRun.id, activityId: activity.id })) {
      console.warn('[run-detail-debug] target_run_skipped', {
        runId: existingRun.id,
        activityId: activity.id,
        reason: 'existing_run_without_update',
      })
    }
    // #region agent log
    options.debugRunId
      ? fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: options.debugRunId, hypothesisId: 'H3', location: 'lib/strava/strava-sync.ts:importStravaActivityForUser:duplicate_skip', message: 'Skipping existing Strava run', data: { userId, externalId: payload.external_id, existingRunUserId: existingRun.user_id }, timestamp: Date.now() }) }).catch(() => {})
      : undefined
    // #endregion
    return {
      status: 'skipped_existing',
      activityId: payload.external_id,
    }
  }

  const { error: updateError } = await supabase
    .from('runs')
    .update({
      user_id: payload.user_id,
      name: payload.name,
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
      created_at: payload.created_at,
      xp: payload.xp,
    })
    .eq('id', existingRun.id)

  if (updateError) {
    throw new Error(updateError.message)
  }

  if (options.accessToken) {
    const { data: existingSeriesRow, error: existingSeriesError } = await supabase
      .from('run_detail_series')
      .select('run_id')
      .eq('run_id', existingRun.id)
      .maybeSingle()

    if (existingSeriesError) {
      console.warn('Strava run detail series existence check failed', {
        runId: existingRun.id,
        activityId: activity.id,
        error: existingSeriesError.message,
      })
    } else if (!existingSeriesRow) {
      console.info('Strava run detail series fallback sync triggered', {
        runId: existingRun.id,
        activityId: activity.id,
        fallback_reason: 'missing_detail_series',
      })
    }

    await syncRunDetailSeriesForActivity(
      supabase,
      existingRun.id,
      activity.id,
      options.accessToken,
      options.debugRunId
    )
  } else if (shouldDebugRunDetailSeries({ runId: existingRun.id, activityId: activity.id })) {
    console.warn('[run-detail-debug] target_run_skipped', {
      runId: existingRun.id,
      activityId: activity.id,
      reason: 'missing_access_token',
    })
  }

  return {
    status: 'updated',
    activityId: payload.external_id,
  }
}

export async function syncStravaRuns(
  userId: string,
  options: SyncStravaRunsOptions = {}
): Promise<StravaInitialSyncResult> {
  const targetDebugRunId = options.debugRunId?.trim() || undefined
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

  if (targetDebugRunId) {
    const supabase = createSupabaseAdminClient()

    console.info('[run-detail-debug] target_run_mode_enter', {
      userId,
      sessionDebugId,
      targetDebugRunId,
      connectionId: connection.id,
    })

    const { data: targetRun, error: targetRunError } = await supabase
      .from('runs')
      .select('id, user_id, external_source, external_id')
      .eq('id', targetDebugRunId)
      .eq('external_source', STRAVA_EXTERNAL_SOURCE)
      .maybeSingle()

    if (targetRunError) {
      throw new Error(targetRunError.message)
    }

    console.info('[run-detail-debug] target_run_found', {
      userId,
      runId: targetDebugRunId,
      found: Boolean(targetRun),
      ownerUserId: targetRun?.user_id ?? null,
      externalSource: targetRun?.external_source ?? null,
      externalId: targetRun?.external_id ?? null,
    })

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

    if (targetRun.user_id !== userId) {
      console.warn('[run-detail-debug] target_run_owner_mismatch', {
        runId: targetDebugRunId,
        currentUserId: userId,
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

    console.info('[run-detail-debug] target_run_sync_start', {
      runId: targetDebugRunId,
      activityId: targetedActivityId,
      path: 'targeted_mode',
    })

    const targetedSyncSucceeded = await syncRunDetailSeriesForActivity(
      supabase,
      targetRun.id,
      targetedActivityId,
      connection.access_token,
      targetDebugRunId
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

  const runActivities = activities.filter(
    (activity) => isValidStravaRun(activity) && isOnOrAfterInitialSyncCutoff(activity.start_date)
  )

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: sessionDebugId, hypothesisId: 'H2', location: 'lib/strava/strava-sync.ts:syncStravaRuns:activities_filtered', message: 'Filtered Strava activities to valid runs', data: { userId, connectionId: connection.id, totalActivitiesFetched: activities.length, runActivitiesCount: runActivities.length, firstFetchedActivityId: activities[0] ? String(activities[0].id) : null, firstFetchedActivityType: activities[0]?.type ?? null, targetDebugRunId: targetDebugRunId ?? null }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  let imported = 0
  let skipped = 0
  const errors: StravaSyncRowErrorDetail[] = []

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

      // #region agent log
      fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: sessionDebugId, hypothesisId: 'H3', location: 'lib/strava/strava-sync.ts:syncStravaRuns:activity_outcome', message: 'Filtered activity processed', data: { userId, connectionId: connection.id, activityId: String(activity.id), activityType: activity.type ?? null, outcome: result.status, targetDebugRunId: targetDebugRunId ?? null }, timestamp: Date.now() }) }).catch(() => {})
      // #endregion
    } catch (caughtError) {
      const errorDetail: StravaSyncRowErrorDetail = {
        activityId: String(activity.id),
        error: caughtError instanceof Error ? caughtError.message : 'Unknown row insert error',
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

  await backfillMissingRunDetailSeriesForUser(userId, connection.access_token, targetDebugRunId)
  await backfillMissingHeartratePointsForUser(userId, connection.access_token)

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: sessionDebugId, hypothesisId: 'H5', location: 'lib/strava/strava-sync.ts:syncStravaRuns:before_touch_connection', message: 'About to update last_synced_at', data: { userId, connectionId: connection.id, imported, skipped, filteredActivitiesCount: runActivities.length, importedIsZero: imported === 0, targetDebugRunId: targetDebugRunId ?? null }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  await touchStravaConnection(connection.id)

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: sessionDebugId, hypothesisId: 'H5', location: 'lib/strava/strava-sync.ts:syncStravaRuns:after_touch_connection', message: 'Updated last_synced_at', data: { userId, connectionId: connection.id, imported, skipped, filteredActivitiesCount: runActivities.length, importedIsZero: imported === 0, targetDebugRunId: targetDebugRunId ?? null }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  const failed = runActivities.length - imported - skipped
  const firstFailure = errors[0] ?? null

  // #region agent log
  fetch('http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6c9984' }, body: JSON.stringify({ sessionId: '6c9984', runId: sessionDebugId, hypothesisId: 'H4', location: 'lib/strava/strava-sync.ts:syncStravaRuns:summary', message: 'Completed Strava sync summary', data: { userId, athleteId: connection.strava_athlete_id, connectionId: connection.id, totalActivitiesFetched: activities.length, firstFetchedActivityId: activities[0] ? String(activities[0].id) : null, firstFetchedActivityType: activities[0]?.type ?? null, runActivitiesCount: runActivities.length, imported, skipped, failed, firstFailure, afterParamUsed: afterUnixSeconds, latestExistingStravaRunAt: latestImportedRun?.created_at ?? null, targetDebugRunId: targetDebugRunId ?? null }, timestamp: Date.now() }) }).catch(() => {})
  // #endregion

  return {
    ok: true,
    imported,
    skipped,
    failed,
    totalRunsFetched: runActivities.length,
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
