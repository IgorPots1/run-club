import { NextRequest, NextResponse } from 'next/server'
import {
  extractStravaPersonalRecordCandidates,
  recomputePersonalRecordForUserDistance,
  upsertPersonalRecordsForDistancesFromStravaPayload,
} from '@/lib/personal-records'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { fetchStravaActivityById, StravaApiError } from '@/lib/strava/strava-client'
import {
  getStravaConnectionForUser,
  importHistoricalStravaActivityByIdForUser,
} from '@/lib/strava/strava-sync'

const RECOVERY_DISTANCES = [21097, 42195] as const
const STRAVA_RECOVERY_FETCH_RETRY_DELAYS_MS = [15000, 30000, 60000]

function normalizeUserId(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeStravaActivityId(value: unknown) {
  const normalizedValue = Number(value)

  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return null
  }

  return Math.round(normalizedValue)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

async function importHistoricalStravaActivityByIdForUserWithRetry(userId: string, stravaActivityId: number) {
  const totalAttempts = STRAVA_RECOVERY_FETCH_RETRY_DELAYS_MS.length + 1

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      return await importHistoricalStravaActivityByIdForUser(userId, stravaActivityId, {
        ignoreCooldown: true,
        forceRefreshExistingRun: true,
      })
    } catch (error) {
      const isRateLimitError = error instanceof StravaApiError && error.status === 429

      if (!isRateLimitError) {
        throw error
      }

      if (attempt >= totalAttempts) {
        throw new Error('Strava activity fetch rate-limited after 3 retries')
      }

      console.warn('Historical activity recovery hit Strava rate limit; retrying', {
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

async function fetchHistoricalStravaActivityPayloadForUserWithRetry(
  userId: string,
  stravaActivityId: number
) {
  const totalAttempts = STRAVA_RECOVERY_FETCH_RETRY_DELAYS_MS.length + 1

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const connection = await getStravaConnectionForUser(userId)

      if (!connection) {
        return null
      }

      const activity = await fetchStravaActivityById(connection.access_token, stravaActivityId)
      const payload = toRawJsonObject(activity)

      if (!payload) {
        throw new Error('Fetched Strava activity payload is not a valid object')
      }

      return payload
    } catch (error) {
      const isRateLimitError = error instanceof StravaApiError && error.status === 429

      if (!isRateLimitError) {
        throw error
      }

      if (attempt >= totalAttempts) {
        throw new Error('Strava activity fetch rate-limited after 3 retries')
      }

      console.warn('Historical activity payload refresh hit Strava rate limit; retrying', {
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
  const stravaActivityId = normalizeStravaActivityId(
    (body as { stravaActivityId?: unknown } | null)?.stravaActivityId
  )

  if (!userId) {
    return NextResponse.json(
      {
        ok: false,
        step: 'invalid_user_id',
      },
      { status: 400 }
    )
  }

  if (!stravaActivityId) {
    return NextResponse.json(
      {
        ok: false,
        step: 'invalid_strava_activity_id',
      },
      { status: 400 }
    )
  }

  const warnings: string[] = []
  const errors: string[] = []
  let runId: string | null = null
  let stravaActivityFreshlyFetched = false
  let payloadPersisted = false
  let prRepairAttempted = false
  let recomputeAttempted = false
  let upsertChecked = 0
  let upsertUpdated = 0
  let candidateDistancesAttempted: number[] = []

  try {
    const { data: existingRunBeforeRecovery, error: existingRunBeforeRecoveryError } = await supabaseAdmin
      .from('runs')
      .select('id')
      .eq('user_id', userId)
      .eq('external_source', 'strava')
      .eq('external_id', String(stravaActivityId))
      .maybeSingle()

    if (existingRunBeforeRecoveryError) {
      throw new Error(existingRunBeforeRecoveryError.message)
    }

    const recoveredRunId = await importHistoricalStravaActivityByIdForUserWithRetry(userId, stravaActivityId)
    runId = recoveredRunId
    stravaActivityFreshlyFetched = Boolean(recoveredRunId)

    if (!runId) {
      warnings.push(
        existingRunBeforeRecovery
          ? 'Historical import did not refresh existing run from Strava'
          : 'Historical import returned no run id'
      )
      return NextResponse.json(
        {
          ok: false,
          userId,
          stravaActivityId,
          runId,
          stravaActivityFreshlyFetched,
          payloadPersisted,
          prRepairAttempted,
          recomputeAttempted,
          upsertChecked,
          upsertUpdated,
          candidateDistancesAttempted,
          warnings,
          errors,
        },
        { status: 409 }
      )
    }

    const freshStravaPayload = await fetchHistoricalStravaActivityPayloadForUserWithRetry(
      userId,
      stravaActivityId
    )

    if (!freshStravaPayload) {
      warnings.push('Missing Strava connection for payload refresh')
      return NextResponse.json(
        {
          ok: false,
          userId,
          stravaActivityId,
          runId,
          stravaActivityFreshlyFetched,
          payloadPersisted,
          prRepairAttempted,
          recomputeAttempted,
          upsertChecked,
          upsertUpdated,
          candidateDistancesAttempted,
          warnings,
          errors,
        },
        { status: 409 }
      )
    }

    const { data: persistedRun, error: persistPayloadError } = await supabaseAdmin
      .from('runs')
      .update({
        raw_strava_payload: freshStravaPayload,
        strava_synced_at: new Date().toISOString(),
      })
      .eq('id', runId)
      .eq('user_id', userId)
      .eq('external_source', 'strava')
      .eq('external_id', String(stravaActivityId))
      .select('id')
      .maybeSingle()

    if (persistPayloadError) {
      throw new Error(persistPayloadError.message)
    }

    if (!persistedRun?.id) {
      warnings.push('Recovered run payload was not persisted')
      return NextResponse.json(
        {
          ok: false,
          userId,
          stravaActivityId,
          runId,
          stravaActivityFreshlyFetched,
          payloadPersisted,
          prRepairAttempted,
          recomputeAttempted,
          upsertChecked,
          upsertUpdated,
          candidateDistancesAttempted,
          warnings,
          errors,
        },
        { status: 409 }
      )
    }

    payloadPersisted = true

    const { data: run, error: runError } = await supabaseAdmin
      .from('runs')
      .select('id, created_at, raw_strava_payload')
      .eq('id', runId)
      .eq('user_id', userId)
      .eq('external_source', 'strava')
      .eq('external_id', String(stravaActivityId))
      .maybeSingle()

    if (runError) {
      throw new Error(runError.message)
    }

    if (!run) {
      warnings.push('Recovered run was not found for this user/activity')
    } else if (!run.raw_strava_payload || typeof run.raw_strava_payload !== 'object') {
      warnings.push('Recovered run missing raw Strava payload; PR upsert skipped')
    } else {
      prRepairAttempted = true

      try {
        candidateDistancesAttempted = extractStravaPersonalRecordCandidates(
          run.raw_strava_payload as Record<string, unknown>
        )
          .map((candidate) => candidate.distance_meters)
          .filter((distanceMeters) => RECOVERY_DISTANCES.includes(distanceMeters as 21097 | 42195))

        const upsertResult = await upsertPersonalRecordsForDistancesFromStravaPayload({
          supabase: supabaseAdmin,
          userId,
          runId: run.id,
          rawStravaPayload: run.raw_strava_payload as Record<string, unknown>,
          distanceMeters: [...RECOVERY_DISTANCES],
          fallbackRecordDate: run.created_at,
          fallbackStravaActivityId: stravaActivityId,
        })
        upsertChecked = upsertResult.checked
        upsertUpdated = upsertResult.updated
      } catch (prError) {
        errors.push(
          `pr_upsert_failed:${prError instanceof Error ? prError.message : 'unknown_error'}`
        )
      }
    }

    recomputeAttempted = true

    for (const distanceMeters of RECOVERY_DISTANCES) {
      try {
        await recomputePersonalRecordForUserDistance({
          supabase: supabaseAdmin,
          userId,
          distanceMeters,
        })
      } catch (recomputeError) {
        errors.push(
          `recompute_failed_${distanceMeters}:${
            recomputeError instanceof Error ? recomputeError.message : 'unknown_error'
          }`
        )
      }
    }

    return NextResponse.json({
      ok: true,
      userId,
      stravaActivityId,
      runId,
      stravaActivityFreshlyFetched,
      payloadPersisted,
      prRepairAttempted,
      recomputeAttempted,
      upsertChecked,
      upsertUpdated,
      candidateDistancesAttempted,
      warnings,
      errors,
    })
  } catch (recoveryError) {
    return NextResponse.json(
      {
        ok: false,
        step: 'recovery_failed',
        error: recoveryError instanceof Error ? recoveryError.message : 'unknown_error',
        userId,
        stravaActivityId,
        runId,
        stravaActivityFreshlyFetched,
        payloadPersisted,
        prRepairAttempted,
        recomputeAttempted,
        upsertChecked,
        upsertUpdated,
        candidateDistancesAttempted,
        warnings,
        errors,
      },
      { status: 500 }
    )
  }
}
