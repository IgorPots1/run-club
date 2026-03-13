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
      try {
        const connection = await getStravaConnectionForAthlete(event.owner_id)

        if (!connection) {
          console.warn('Webhook import skipped: missing connection', {
            ownerId: event.owner_id,
            activityId,
          })
          return
        }

        const activity = await fetchStravaActivityById(connection.access_token, activityId)

        await importStravaActivityForUser(connection.user_id, activity, {
          updateExisting: true,
        })
      } catch (caughtError) {
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
