import { NextRequest, NextResponse } from 'next/server'
import {
  recomputePersonalRecordForUserDistance,
  upsertPersonalRecordsForDistancesFromStravaPayload,
} from '@/lib/personal-records'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { StravaApiError } from '@/lib/strava/strava-client'
import { importHistoricalStravaActivityByIdForUser } from '@/lib/strava/strava-sync'

const RECOVERY_STRAVA_ACTIVITY_ID = 7293646236
const RECOVERY_DISTANCES = [21097, 42195] as const
const STRAVA_RECOVERY_FETCH_RETRY_DELAYS_MS = [15000, 30000, 60000]

function normalizeUserId(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function importHistoricalStravaActivityByIdForUserWithRetry(userId: string, stravaActivityId: number) {
  const totalAttempts = STRAVA_RECOVERY_FETCH_RETRY_DELAYS_MS.length + 1

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      return await importHistoricalStravaActivityByIdForUser(userId, stravaActivityId, {
        ignoreCooldown: true,
      })
    } catch (error) {
      const isRateLimitError = error instanceof StravaApiError && error.status === 429

      if (!isRateLimitError) {
        throw error
      }

      if (attempt >= totalAttempts) {
        throw new Error('Strava activity fetch rate-limited after 3 retries')
      }

      console.warn('Temporary PR recovery hit Strava rate limit; retrying', {
        userId,
        stravaActivityId,
        attempt,
        totalAttempts,
        retryDelayMs: STRAVA_RECOVERY_FETCH_RETRY_DELAYS_MS[attempt - 1],
      })

      await sleep(STRAVA_RECOVERY_FETCH_RETRY_DELAYS_MS[attempt - 1])
    }
  }

  throw new Error('Strava activity fetch rate-limited after 3 retries')
}

export async function recoverKnownHistoricalPersonalRecord(
  userId: string,
  actorUserId?: string | null
) {
  const supabaseAdmin = createSupabaseAdminClient()
  const { data: existingRunBeforeRecovery, error: existingRunBeforeRecoveryError } = await supabaseAdmin
    .from('runs')
    .select('id')
    .eq('user_id', userId)
    .eq('external_source', 'strava')
    .eq('external_id', String(RECOVERY_STRAVA_ACTIVITY_ID))
    .maybeSingle()

  if (existingRunBeforeRecoveryError) {
    throw new Error(existingRunBeforeRecoveryError.message)
  }

  const recoveredRunId = await importHistoricalStravaActivityByIdForUserWithRetry(
    userId,
    RECOVERY_STRAVA_ACTIVITY_ID
  )

  if (!recoveredRunId) {
    return {
      ok: false as const,
      status: 409,
      body: {
        ok: false,
        step: 'historical_import_unavailable',
        userId,
        stravaActivityId: RECOVERY_STRAVA_ACTIVITY_ID,
      },
    }
  }

  const { data: run, error: runError } = await supabaseAdmin
    .from('runs')
    .select('id, created_at, raw_strava_payload, external_id, distance_meters, moving_time_seconds')
    .eq('id', recoveredRunId)
    .eq('user_id', userId)
    .eq('external_source', 'strava')
    .eq('external_id', String(RECOVERY_STRAVA_ACTIVITY_ID))
    .maybeSingle()

  if (runError) {
    throw new Error(runError.message)
  }

  if (!run) {
    return {
      ok: false as const,
      status: 404,
      body: {
        ok: false,
        step: 'missing_run',
        userId,
        runId: recoveredRunId,
        stravaActivityId: RECOVERY_STRAVA_ACTIVITY_ID,
      },
    }
  }

  if (!run.raw_strava_payload || typeof run.raw_strava_payload !== 'object') {
    console.warn('Known historical PR recovery found non-object raw_strava_payload; using run-level fallback metrics', {
      userId,
      runId: run.id,
      stravaActivityId: RECOVERY_STRAVA_ACTIVITY_ID,
      payloadType: run.raw_strava_payload === null
        ? 'null'
        : Array.isArray(run.raw_strava_payload)
          ? 'array'
          : typeof run.raw_strava_payload,
    })
  }

  const importedRunId = existingRunBeforeRecovery ? null : recoveredRunId
  const existingRunId = existingRunBeforeRecovery?.id ?? null

  const upsertResult = await upsertPersonalRecordsForDistancesFromStravaPayload({
    supabase: supabaseAdmin,
    userId,
    runId: run.id,
    rawStravaPayload: run.raw_strava_payload,
    distanceMeters: [...RECOVERY_DISTANCES],
    fallbackRecordDate: run.created_at,
    fallbackStravaActivityId: RECOVERY_STRAVA_ACTIVITY_ID,
    fallbackDistanceMeters: run.distance_meters,
    fallbackMovingTimeSeconds: run.moving_time_seconds,
  })

  const recomputeResults = []

  for (const distanceMeters of RECOVERY_DISTANCES) {
    const recomputeResult = await recomputePersonalRecordForUserDistance({
      supabase: supabaseAdmin,
      userId,
      distanceMeters,
    })

    recomputeResults.push({
      distanceMeters,
      ...recomputeResult,
    })
  }

  const halfMarathonRecomputed = recomputeResults.some(
    (result) => result.distanceMeters === 21097 && result.updated
  )
  const marathonRecomputed = recomputeResults.some(
    (result) => result.distanceMeters === 42195 && result.updated
  )

  console.info('Recovered known historical personal record activity', {
    actorUserId: actorUserId ?? null,
    targetUserId: userId,
    runId: run.id,
    stravaActivityId: RECOVERY_STRAVA_ACTIVITY_ID,
    distances: RECOVERY_DISTANCES,
    checked: upsertResult.checked,
    updated: upsertResult.updated,
  })

  return {
    ok: true as const,
    status: 200,
    body: {
      ok: true,
      userId,
      runId: run.id,
      stravaActivityId: RECOVERY_STRAVA_ACTIVITY_ID,
      distances: RECOVERY_DISTANCES,
      importedRunId,
      existingRunId,
      halfMarathonRecomputed,
      marathonRecomputed,
      upsert: upsertResult,
      recompute: recomputeResults,
    },
  }
}

export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        ok: false,
        step: 'auth_required',
      },
      { status: 401 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role, app_access_status')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    return NextResponse.json(
      {
        ok: false,
        step: 'admin_profile_lookup_failed',
        error: profileError.message,
      },
      { status: 500 }
    )
  }

  if (!profile || profile.app_access_status !== 'active' || profile.role !== 'admin') {
    return NextResponse.json(
      {
        ok: false,
        step: 'admin_required',
      },
      { status: 403 }
    )
  }

  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      {
        ok: false,
        step: 'invalid_json',
      },
      { status: 400 }
    )
  }

  const userId = normalizeUserId((body as { userId?: unknown } | null)?.userId)

  if (!userId) {
    return NextResponse.json(
      {
        ok: false,
        step: 'invalid_user_id',
      },
      { status: 400 }
    )
  }

  try {
    const result = await recoverKnownHistoricalPersonalRecord(userId, user.id)
    return NextResponse.json(result.body, { status: result.status })
  } catch (recoveryError) {
    return NextResponse.json(
      {
        ok: false,
        step: 'recovery_failed',
        error: recoveryError instanceof Error ? recoveryError.message : 'unknown_error',
        userId,
        stravaActivityId: RECOVERY_STRAVA_ACTIVITY_ID,
      },
      { status: 500 }
    )
  }
}
