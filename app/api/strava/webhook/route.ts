import { NextResponse } from 'next/server'
import { fetchStravaActivityById, getStravaWebhookVerifyToken } from '@/lib/strava/strava-client'
import {
  getStravaConnectionForAthlete,
  importStravaActivityForUser,
  isValidStravaRun,
  touchStravaConnection,
} from '@/lib/strava/strava-sync'
import type { StravaWebhookEvent } from '@/lib/strava/strava-types'

function isRelevantWebhookEvent(event: StravaWebhookEvent) {
  return (
    event.object_type === 'activity' &&
    (event.aspect_type === 'create' || event.aspect_type === 'update') &&
    Number.isFinite(event.object_id) &&
    Number.isFinite(event.owner_id)
  )
}

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

  if (!isRelevantWebhookEvent(event)) {
    console.info('Ignoring Strava webhook event', {
      objectType: event.object_type ?? null,
      aspectType: event.aspect_type ?? null,
      ownerId: event.owner_id ?? null,
      objectId: event.object_id ?? null,
    })

    return NextResponse.json({
      ok: true,
      step: 'ignored_event',
    })
  }

  try {
    const connection = await getStravaConnectionForAthlete(event.owner_id)

    if (!connection) {
      console.warn('Strava webhook connection missing', {
        ownerId: event.owner_id,
        activityId: event.object_id,
      })

      return NextResponse.json({
        ok: true,
        step: 'missing_connection',
      })
    }

    const activity = await fetchStravaActivityById(connection.access_token, event.object_id)

    if (!isValidStravaRun(activity)) {
      console.info('Ignoring non-run Strava webhook activity', {
        ownerId: event.owner_id,
        activityId: event.object_id,
        type: activity.type ?? null,
        aspectType: event.aspect_type,
      })

      return NextResponse.json({
        ok: true,
        step: 'ignored_non_run',
      })
    }

    const result = await importStravaActivityForUser(connection.user_id, activity, {
      updateExisting: true,
    })

    await touchStravaConnection(connection.id)

    console.info('Processed Strava webhook activity', {
      ownerId: event.owner_id,
      userId: connection.user_id,
      activityId: event.object_id,
      aspectType: event.aspect_type,
      result: result.status,
    })

    return NextResponse.json({
      ok: true,
      step: 'activity_processed',
      result: result.status,
    })
  } catch (caughtError) {
    console.error('Strava webhook processing failed', {
      error: caughtError instanceof Error ? caughtError.message : 'Unknown webhook error',
      ownerId: event.owner_id,
      activityId: event.object_id,
      aspectType: event.aspect_type,
    })

    return NextResponse.json(
      {
        ok: false,
        step: 'webhook_processing_failed',
        error: caughtError instanceof Error ? caughtError.message : 'Unknown webhook error',
      },
      { status: 500 }
    )
  }
}
