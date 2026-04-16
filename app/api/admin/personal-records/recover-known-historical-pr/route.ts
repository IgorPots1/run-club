import { NextRequest, NextResponse } from 'next/server'
import {
  recomputePersonalRecordForUserDistance,
  upsertPersonalRecordsForDistancesFromStravaPayload,
} from '@/lib/personal-records'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { importHistoricalStravaActivityByIdForUser } from '@/lib/strava/strava-sync'

const RECOVERY_STRAVA_ACTIVITY_ID = 7293646236
const RECOVERY_DISTANCES = [21097, 42195] as const

function normalizeUserId(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function recoverKnownHistoricalPersonalRecord(
  userId: string,
  actorUserId?: string | null
) {
  const supabaseAdmin = createSupabaseAdminClient()
  const importedRunId = await importHistoricalStravaActivityByIdForUser(
    userId,
    RECOVERY_STRAVA_ACTIVITY_ID
  )

  if (!importedRunId) {
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
    .select('id, created_at, raw_strava_payload, external_id')
    .eq('id', importedRunId)
    .eq('user_id', userId)
    .eq('external_source', 'strava')
    .eq('external_id', String(RECOVERY_STRAVA_ACTIVITY_ID))
    .maybeSingle()

  if (runError) {
    throw new Error(runError.message)
  }

  if (!run?.raw_strava_payload || typeof run.raw_strava_payload !== 'object') {
    return {
      ok: false as const,
      status: 404,
      body: {
        ok: false,
        step: 'missing_strava_payload',
        userId,
        runId: importedRunId,
        stravaActivityId: RECOVERY_STRAVA_ACTIVITY_ID,
      },
    }
  }

  const upsertResult = await upsertPersonalRecordsForDistancesFromStravaPayload({
    supabase: supabaseAdmin,
    userId,
    runId: run.id,
    rawStravaPayload: run.raw_strava_payload as Record<string, unknown>,
    distanceMeters: [...RECOVERY_DISTANCES],
    fallbackRecordDate: run.created_at,
    fallbackStravaActivityId: RECOVERY_STRAVA_ACTIVITY_ID,
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
      import: {
        runId: importedRunId,
      },
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
