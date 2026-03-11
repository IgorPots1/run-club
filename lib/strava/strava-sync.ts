import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { fetchStravaActivities } from './strava-client'
import type { StravaActivitySummary, StravaInitialSyncResult } from './strava-types'

const STRAVA_EXTERNAL_SOURCE = 'strava'
const FALLBACK_RUN_NAME = 'Бег'
const STRAVA_SYNC_WINDOW_DAYS = 7

function toDistanceKm(distanceMeters: number) {
  return Number((distanceMeters / 1000).toFixed(2))
}

function toDurationMinutes(movingTimeSeconds: number) {
  return Math.max(1, Math.round(movingTimeSeconds / 60))
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

  const runsToInsert = runActivities
    .filter((activity) => !existingExternalIds.has(String(activity.id)))
    .map((activity) => {
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
        xp: 50 + distanceKm * 10,
      }
    })

  if (runsToInsert.length > 0) {
    const { error: insertError } = await supabase.from('runs').insert(runsToInsert)

    if (insertError) {
      throw new Error(insertError.message)
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
    imported: runsToInsert.length,
    skipped: runActivities.length - runsToInsert.length,
    totalRunsFetched: runActivities.length,
  }
}
