import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { fetchStravaActivities } from './strava-client'
import type { StravaActivitySummary, StravaInitialSyncResult } from './strava-types'

const STRAVA_EXTERNAL_SOURCE = 'strava'
const FALLBACK_RUN_NAME = 'Бег'
const STRAVA_SYNC_WINDOW_DAYS = 7
const MAX_SYNC_ERROR_DETAILS = 10

type StravaRunInsertPayload = {
  user_id: string
  name: string
  title: string
  distance_km: number
  duration_minutes: number
  created_at: string
  external_source: string
  external_id: string
  xp: number
}

type StravaSyncRowErrorDetail = {
  activityId: string
  field?: string
  value?: number | string | null
  error: string
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
  return Number((distanceMeters / 1000).toFixed(2))
}

function toDurationMinutes(movingTimeSeconds: number) {
  return Math.max(1, normalizeIntegerField('duration_minutes', movingTimeSeconds / 60))
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

function isValidStravaRun(activity: StravaActivitySummary) {
  return (
    activity.type === 'Run' &&
    Number.isFinite(activity.distance) &&
    activity.distance > 0 &&
    Number.isFinite(activity.moving_time) &&
    activity.moving_time > 0 &&
    Boolean(activity.start_date)
  )
}

function buildRunInsertPayload(userId: string, activity: StravaActivitySummary): StravaRunInsertPayload {
  const normalizedName = activity.name.trim() || FALLBACK_RUN_NAME
  const distanceKm = toDistanceKm(activity.distance)

  return {
    user_id: userId,
    name: normalizedName,
    title: normalizedName,
    distance_km: distanceKm,
    duration_minutes: toDurationMinutes(activity.moving_time),
    created_at: new Date(activity.start_date).toISOString(),
    external_source: STRAVA_EXTERNAL_SOURCE,
    external_id: String(activity.id),
    xp: toXp(distanceKm),
  }
}

function findLikelyInvalidIntegerField(payload: StravaRunInsertPayload) {
  const integerFields: Array<keyof Pick<StravaRunInsertPayload, 'duration_minutes' | 'xp'>> = [
    'duration_minutes',
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

export async function syncStravaRuns(userId: string): Promise<StravaInitialSyncResult> {
  const supabase = createSupabaseAdminClient()

  const { data: connection, error: connectionError } = await supabase
    .from('strava_connections')
    .select('id, access_token')
    .eq('user_id', userId)
    .maybeSingle()

  if (connectionError) {
    throw new Error(connectionError.message)
  }

  if (!connection) {
    return {
      ok: false,
      step: 'missing_connection',
    }
  }

  const afterUnixSeconds = Math.floor(
    (Date.now() - STRAVA_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000) / 1000
  )
  const activities = await fetchStravaActivities(connection.access_token, afterUnixSeconds)
  const runActivities = activities.filter(isValidStravaRun)
  const externalIds = runActivities.map((activity) => String(activity.id))

  let existingExternalIds = new Set<string>()

  if (externalIds.length > 0) {
    const { data: existingRuns, error: existingRunsError } = await supabase
      .from('runs')
      .select('external_id')
      .eq('external_source', STRAVA_EXTERNAL_SOURCE)
      .in('external_id', externalIds)

    if (existingRunsError) {
      throw new Error(existingRunsError.message)
    }

    existingExternalIds = new Set(
      (existingRuns ?? [])
        .map((run) => run.external_id)
        .filter((externalId): externalId is string => Boolean(externalId))
    )
  }

  const activitiesToInsert = runActivities.filter(
    (activity) => !existingExternalIds.has(String(activity.id))
  )
  let imported = 0
  const errors: StravaSyncRowErrorDetail[] = []

  for (const activity of activitiesToInsert) {
    let payload: StravaRunInsertPayload | null = null

    try {
      payload = buildRunInsertPayload(userId, activity)
      const { error: insertError } = await supabase.from('runs').insert(payload)

      if (insertError) {
        throw new Error(insertError.message)
      }

      imported += 1
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
    }
  }

  const { error: updateConnectionError } = await supabase
    .from('strava_connections')
    .update({
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', connection.id)

  if (updateConnectionError) {
    throw new Error(updateConnectionError.message)
  }

  return {
    ok: true,
    imported,
    skipped: existingExternalIds.size,
    failed: activitiesToInsert.length - imported,
    totalRunsFetched: runActivities.length,
    errors,
  }
}
