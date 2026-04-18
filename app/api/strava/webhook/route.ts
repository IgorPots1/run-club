import { after, NextResponse } from 'next/server'
import { fetchStravaActivityById, getStravaWebhookVerifyToken, StravaApiError } from '@/lib/strava/strava-client'
import {
  getStravaConnectionForAthlete,
  hydrateRunSupplementalStravaDataForRun,
  importStravaActivityForUser,
  recordStravaRateLimitCooldown,
  syncStravaRuns,
} from '@/lib/strava/strava-sync'
import type { StravaWebhookEvent } from '@/lib/strava/strava-types'

const STRAVA_WEBHOOK_FETCH_RETRY_DELAYS_MS = [1500, 3000]
const STRAVA_WEBHOOK_MAX_BACKGROUND_COOLDOWN_WAIT_MS = 30 * 1000

export async function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const verifyToken = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  let expectedVerifyToken: string

  try {
    expectedVerifyToken = getStravaWebhookVerifyToken()
  } catch (caughtError) {
    return NextResponse.json(
      {
        ok: false,
        step: 'missing_verify_token_config',
        error: caughtError instanceof Error ? caughtError.message : 'Missing webhook verify token',
      },
      { status: 500 }
    )
  }

  if (mode !== 'subscribe') {
    return NextResponse.json(
      {
        ok: false,
        step: 'invalid_webhook_verification',
        error: 'Expected hub.mode=subscribe',
        receivedMode: mode,
      },
      { status: 400 }
    )
  }

  if (!verifyToken || verifyToken !== expectedVerifyToken) {
    return NextResponse.json(
      {
        ok: false,
        step: 'invalid_webhook_verification',
        error: 'Invalid hub.verify_token',
        hasVerifyToken: Boolean(verifyToken),
      },
      { status: 400 }
    )
  }

  if (!challenge) {
    return NextResponse.json(
      {
        ok: false,
        step: 'invalid_webhook_verification',
        error: 'Missing hub.challenge',
      },
      { status: 400 }
    )
  }

  return NextResponse.json({
    'hub.challenge': challenge,
  })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableStravaFetchError(error: unknown): error is StravaApiError {
  return error instanceof StravaApiError && error.status >= 500
}

function scheduleIncrementalRecoverySync(input: {
  userId: string
  ownerId: number
  activityId: number
  rateLimitedUntil: string
}) {
  const cooldownRemainingMs = Math.max(new Date(input.rateLimitedUntil).getTime() - Date.now(), 0)
  const canWaitForCooldownInBackground = cooldownRemainingMs <= STRAVA_WEBHOOK_MAX_BACKGROUND_COOLDOWN_WAIT_MS

  console.info('[strava-webhook] incremental_sync_recovery_scheduled', {
    userId: input.userId,
    ownerId: input.ownerId,
    activityId: input.activityId,
    rateLimitedUntil: input.rateLimitedUntil,
    cooldownRemainingMs,
    canWaitForCooldownInBackground,
  })

  after(async () => {
    try {
      if (canWaitForCooldownInBackground && cooldownRemainingMs > 0) {
        await sleep(cooldownRemainingMs + 1000)
      } else if (!canWaitForCooldownInBackground) {
        console.info('[strava-webhook] incremental_sync_recovery_deferred_to_scheduled_sync', {
          userId: input.userId,
          ownerId: input.ownerId,
          activityId: input.activityId,
          rateLimitedUntil: input.rateLimitedUntil,
          cooldownRemainingMs,
        })
        return
      }

      const syncResult = await syncStravaRuns(input.userId, { mode: 'incremental' })

      console.info('[strava-webhook] incremental_sync_recovery_completed', {
        userId: input.userId,
        ownerId: input.ownerId,
        activityId: input.activityId,
        ok: syncResult.ok,
        step: syncResult.ok ? 'initial_sync_complete' : syncResult.step,
      })
    } catch (caughtError) {
      console.error('[strava-webhook] incremental_sync_recovery_failed', {
        userId: input.userId,
        ownerId: input.ownerId,
        activityId: input.activityId,
        error: caughtError instanceof Error ? caughtError.message : 'Unknown webhook recovery sync error',
      })
    }
  })
}

async function fetchStravaActivityByIdWithRetry(
  accessToken: string,
  activityId: number,
  ownerId: number
) {
  const totalAttempts = STRAVA_WEBHOOK_FETCH_RETRY_DELAYS_MS.length + 1
  let lastError: unknown

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      if (attempt > 1) {
        console.info('[strava-webhook-debug] fetch_activity_retry_attempt', {
          activityId,
          ownerId,
          attempt,
          totalAttempts,
        })
      }

      const activity = await fetchStravaActivityById(accessToken, activityId)

      console.info('[strava-webhook-debug] fetch_activity_retry_success', {
        activityId,
        ownerId,
        attempt,
        totalAttempts,
        retried: attempt > 1,
      })

      return activity
    } catch (caughtError) {
      lastError = caughtError

      console.warn('[strava-webhook-debug] fetch_activity_retry_failure', {
        activityId,
        ownerId,
        attempt,
        totalAttempts,
        error: caughtError instanceof Error ? caughtError.message : 'Unknown fetch activity error',
      })

      if (caughtError instanceof StravaApiError && caughtError.status === 429) {
        break
      }

      if (attempt >= totalAttempts) {
        break
      }

      await sleep(STRAVA_WEBHOOK_FETCH_RETRY_DELAYS_MS[attempt - 1])
    }
  }

  console.warn('[strava-webhook-debug] fetch_activity_retry_exhausted', {
    activityId,
    ownerId,
    totalAttempts,
    error: lastError instanceof Error ? lastError.message : 'Unknown fetch activity error',
  })

  throw lastError
}

export async function POST(request: Request) {
  let event: StravaWebhookEvent

  try {
    event = (await request.json()) as StravaWebhookEvent
  } catch {
    return NextResponse.json(
      {
        ok: false,
        step: 'invalid_json',
      },
      { status: 400 }
    )
  }

  console.info('Received Strava webhook event', {
    objectType: event.object_type ?? null,
    aspectType: event.aspect_type ?? null,
    ownerId: event.owner_id ?? null,
    objectId: event.object_id ?? null,
  })
  console.info('[strava-webhook-debug] event_received', {
    objectType: event.object_type ?? null,
    aspectType: event.aspect_type ?? null,
    ownerId: event.owner_id ?? null,
    activityId: event.object_id ?? null,
  })

  const isActivityCreateOrUpdate = (
    event.object_type === 'activity' &&
    (event.aspect_type === 'create' || event.aspect_type === 'update')
  )

  if (!isActivityCreateOrUpdate) {
    return NextResponse.json({
      ok: true,
      step: 'event_ignored',
    })
  }

  const activityId = event.object_id
  let step = 'load_connection'

  console.info('Webhook importing activity', {
    activityId,
  })

  try {
    console.info('[strava-webhook-debug] load_connection_start', {
      ownerId: event.owner_id,
      activityId,
      step,
    })
    const connection = await getStravaConnectionForAthlete(event.owner_id)

    if (!connection) {
      console.warn('[strava-webhook-debug] load_connection_missing', {
        ownerId: event.owner_id,
        activityId,
        step,
      })
      console.warn('Webhook import skipped: missing connection', {
        ownerId: event.owner_id,
        activityId,
        step,
      })

      return NextResponse.json({
        ok: true,
        step: 'event_processed',
      })
    }

    console.info('[strava-webhook-debug] load_connection_success', {
      ownerId: event.owner_id,
      activityId,
      userId: connection.user_id,
      connectionId: connection.id,
      step,
    })

    step = 'fetch_activity'
    console.info('[strava-webhook-debug] fetch_activity_start', {
      ownerId: event.owner_id,
      activityId,
      step,
    })

    let activity

    try {
      activity = await fetchStravaActivityByIdWithRetry(
        connection.access_token,
        activityId,
        event.owner_id
      )
    } catch (caughtError) {
      console.warn('[strava-webhook-debug] fetch_activity_failure', {
        activityId,
        ownerId: event.owner_id,
        step,
        error: caughtError instanceof Error ? caughtError.message : 'Unknown fetch activity error',
      })
      if (isRetryableStravaFetchError(caughtError)) {
        console.warn('[strava-webhook] deferring_processing_for_retry', {
          activityId,
          ownerId: event.owner_id,
          step,
          status: caughtError.status,
        })

        return NextResponse.json({
          ok: false,
          step: 'fetch_activity_deferred',
        }, { status: 503 })
      }

      if (caughtError instanceof StravaApiError && caughtError.status === 429) {
        const rateLimitedUntil = await recordStravaRateLimitCooldown(connection.id, 'webhook_activity_fetch', {
          activityId,
          ownerId: event.owner_id,
        })

        scheduleIncrementalRecoverySync({
          userId: connection.user_id,
          ownerId: event.owner_id,
          activityId,
          rateLimitedUntil,
        })

        console.warn('[strava-webhook] cooldown_recorded_after_rate_limit', {
          activityId,
          ownerId: event.owner_id,
          rateLimitedUntil,
        })

        return NextResponse.json({
          ok: true,
          step: 'fetch_activity_deferred_to_sync',
        })
      }

      console.info('[strava-webhook-debug] activity_not_ready_yet_will_be_picked_up_by_sync', {
        activityId,
        ownerId: event.owner_id,
        step,
      })

      return NextResponse.json({
        ok: true,
        step: 'event_processed',
      })
    }

    console.info('[strava-webhook-debug] fetch_activity_success', {
      activityId,
      activityType: activity.type ?? null,
      startDate: activity.start_date ?? null,
      step,
    })

    step = 'import_run'
    console.info('[strava-webhook-debug] import_run_start', {
      activityId,
      userId: connection.user_id,
      step,
    })
    const importResult = await importStravaActivityForUser(connection.user_id, activity, {
      updateExisting: true,
      accessToken: connection.access_token,
    })
    console.info('[strava-webhook-debug] import_run_success', {
      activityId,
      userId: connection.user_id,
      runId: importResult.runId ?? null,
      step,
    })

    if (typeof importResult.runId === 'string' && importResult.runId.length > 0) {
      after(async () => {
        try {
          await hydrateRunSupplementalStravaDataForRun({
            userId: connection.user_id,
            runId: importResult.runId,
            stravaActivityId: activityId,
          })
        } catch (error) {
          console.warn('[strava-webhook] supplemental_hydration_failed', {
            userId: connection.user_id,
            runId: importResult.runId,
            activityId,
            error: error instanceof Error ? error.message : 'Unknown supplemental hydration error',
          })
        }
      })
    }

    return NextResponse.json({
      ok: true,
      step: 'event_processed',
    })
  } catch (caughtError) {
    console.error('[strava-webhook-debug] webhook_import_failed', {
      activityId,
      step,
      error: caughtError instanceof Error ? caughtError.message : 'Unknown webhook import error',
    })
    console.error('Webhook import failed', {
      activityId,
      step,
      error: caughtError instanceof Error ? caughtError.message : 'Unknown webhook import error',
    })

    return NextResponse.json({
      ok: false,
      step: 'webhook_import_failed',
      activityId,
      error: caughtError instanceof Error ? caughtError.message : 'Unknown webhook import error',
    }, { status: 500 })
  }
}
