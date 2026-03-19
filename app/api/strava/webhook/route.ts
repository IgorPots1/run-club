import { NextResponse } from 'next/server'
import { fetchStravaActivityById, getStravaWebhookVerifyToken } from '@/lib/strava/strava-client'
import { getStravaConnectionForAthlete, importStravaActivityForUser } from '@/lib/strava/strava-sync'
import type { StravaWebhookEvent } from '@/lib/strava/strava-types'

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

  if (isActivityCreateOrUpdate) {
    const activityId = event.object_id

    console.info('Webhook importing activity', {
      activityId,
    })

    void (async () => {
      let step = 'load_connection'

      try {
        console.info('[strava-webhook-debug] load_connection_start', {
          ownerId: event.owner_id,
          activityId,
        })
        const connection = await getStravaConnectionForAthlete(event.owner_id)

        if (!connection) {
          console.warn('[strava-webhook-debug] load_connection_missing', {
            ownerId: event.owner_id,
            activityId,
          })
          console.warn('Webhook import skipped: missing connection', {
            ownerId: event.owner_id,
            activityId,
          })
          return
        }

        console.info('[strava-webhook-debug] load_connection_success', {
          ownerId: event.owner_id,
          activityId,
          userId: connection.user_id,
          connectionId: connection.id,
        })

        step = 'fetch_activity'
        console.info('[strava-webhook-debug] fetch_activity_start', {
          ownerId: event.owner_id,
          activityId,
        })
        const activity = await fetchStravaActivityById(connection.access_token, activityId)
        console.info('[strava-webhook-debug] fetch_activity_success', {
          activityId,
          activityType: activity.type ?? null,
          startDate: activity.start_date ?? null,
        })

        step = 'import_run'
        console.info('[strava-webhook-debug] import_run_start', {
          activityId,
          userId: connection.user_id,
        })
        await importStravaActivityForUser(connection.user_id, activity, {
          updateExisting: true,
          accessToken: connection.access_token,
        })
        console.info('[strava-webhook-debug] import_run_success', {
          activityId,
          userId: connection.user_id,
        })
      } catch (caughtError) {
        console.error('[strava-webhook-debug] webhook_import_failed', {
          activityId,
          step,
          error: caughtError instanceof Error ? caughtError.message : 'Unknown webhook import error',
        })
        console.error('Webhook import failed', {
          activityId,
          error: caughtError instanceof Error ? caughtError.message : 'Unknown webhook import error',
        })
      }
    })()
  }

  return NextResponse.json({
    ok: true,
    step: isActivityCreateOrUpdate ? 'event_scheduled' : 'event_ignored',
  })
}
