import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const STRAVA_EXTERNAL_SOURCE = 'strava'
const STRAVA_RUN_DETAIL_SERIES_NO_DETAIL_SOURCE = 'strava_no_detail_available'

type ExistingStravaRunSupplementalRow = {
  id: string
  external_source: string | null
  external_id: string | null
}

type ExistingRunDetailSeriesStatusRow = {
  run_id: string
  pace_points: unknown | null
  heartrate_points: unknown | null
  cadence_points: unknown | null
  altitude_points: unknown | null
  source: string | null
}

type HydrateSummaryOnlyParams = {
  supabase: SupabaseClient
  runId: string
  activityId: number
}

function hasDetailSeriesPoints(points: unknown) {
  return Array.isArray(points) && points.length > 0
}

function hasAnyRunDetailSeriesPoints(row: ExistingRunDetailSeriesStatusRow | null) {
  if (!row) {
    return false
  }

  return (
    hasDetailSeriesPoints(row.pace_points) ||
    hasDetailSeriesPoints(row.heartrate_points) ||
    hasDetailSeriesPoints(row.cadence_points) ||
    hasDetailSeriesPoints(row.altitude_points)
  )
}

export function createScriptSafeSupabaseAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL')
  }

  if (!serviceRoleKey) {
    throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export async function hydrateSummaryOnlyStravaRun(params: HydrateSummaryOnlyParams) {
  const normalizedRunId = params.runId.trim()
  const normalizedActivityId = Math.round(Number(params.activityId))

  if (!normalizedRunId || !Number.isFinite(normalizedActivityId) || normalizedActivityId <= 0) {
    return false
  }

  const { supabase } = params
  const { data: runRowData, error: runRowError } = await supabase
    .from('runs')
    .select('id, external_source, external_id')
    .eq('id', normalizedRunId)
    .maybeSingle()

  if (runRowError) {
    console.warn('Strava summary-only hydration skipped due to run lookup failure', {
      runId: normalizedRunId,
      activityId: normalizedActivityId,
      error: runRowError.message,
    })
    return false
  }

  const runRow = (runRowData as ExistingStravaRunSupplementalRow | null) ?? null
  const normalizedExternalId = Number(runRow?.external_id)
  const validImportedStravaRun =
    runRow?.external_source === STRAVA_EXTERNAL_SOURCE &&
    Number.isFinite(normalizedExternalId) &&
    normalizedExternalId > 0 &&
    normalizedExternalId === normalizedActivityId

  if (!validImportedStravaRun) {
    console.warn('Strava summary-only hydration skipped due to invalid run identity', {
      runId: normalizedRunId,
      activityId: normalizedActivityId,
      externalSource: runRow?.external_source ?? null,
      externalId: runRow?.external_id ?? null,
    })
    return false
  }

  const { data: existingSeriesData, error: existingSeriesError } = await supabase
    .from('run_detail_series')
    .select('run_id, pace_points, heartrate_points, cadence_points, altitude_points, source')
    .eq('run_id', normalizedRunId)
    .maybeSingle()

  if (existingSeriesError) {
    console.warn('Strava summary-only hydration skipped due to existing-series lookup failure', {
      runId: normalizedRunId,
      activityId: normalizedActivityId,
      error: existingSeriesError.message,
    })
    return false
  }

  const existingSeries = (existingSeriesData as ExistingRunDetailSeriesStatusRow | null) ?? null

  if (hasAnyRunDetailSeriesPoints(existingSeries)) {
    console.info('Strava summary-only hydration skipped because detailed points exist', {
      runId: normalizedRunId,
      activityId: normalizedActivityId,
      existingSource: existingSeries?.source ?? null,
    })
    return false
  }

  if (existingSeries?.source === STRAVA_RUN_DETAIL_SERIES_NO_DETAIL_SOURCE) {
    console.info('Strava summary-only no-detail placeholder already present', {
      runId: normalizedRunId,
      activityId: normalizedActivityId,
    })
    return true
  }

  const { error: placeholderUpsertError } = await supabase
    .from('run_detail_series')
    .upsert(
      {
        run_id: normalizedRunId,
        pace_points: null,
        heartrate_points: null,
        cadence_points: null,
        altitude_points: null,
        source: STRAVA_RUN_DETAIL_SERIES_NO_DETAIL_SOURCE,
      },
      {
        onConflict: 'run_id',
      }
    )

  if (placeholderUpsertError) {
    console.warn('Strava summary-only no-detail placeholder hydration failed', {
      runId: normalizedRunId,
      activityId: normalizedActivityId,
      error: placeholderUpsertError.message,
    })
    return false
  }

  console.info('Strava summary-only hydration normalized run to no-detail placeholder', {
    runId: normalizedRunId,
    activityId: normalizedActivityId,
    placeholderSource: STRAVA_RUN_DETAIL_SERIES_NO_DETAIL_SOURCE,
  })

  return true
}
