import 'server-only'

import webpush from 'web-push'

type SendWebPushInput = {
  endpoint: string
  p256dh: string
  auth: string
  payload: {
    title: string
    body: string
  }
}

export type SendWebPushResult = {
  ok: boolean
  statusCode?: number
}

let isWebPushConfigured = false

function ensureWebPushConfigured() {
  if (isWebPushConfigured) {
    return true
  }

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY?.trim()

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.error('Failed to configure web push', {
      hasVapidPublicKey: Boolean(vapidPublicKey),
      hasVapidPrivateKey: Boolean(vapidPrivateKey),
    })
    return false
  }

  webpush.setVapidDetails(
    process.env.NEXT_PUBLIC_APP_URL?.trim() || 'mailto:noreply@runclub.app',
    vapidPublicKey,
    vapidPrivateKey
  )

  isWebPushConfigured = true
  return true
}

export async function sendWebPush(input: SendWebPushInput): Promise<SendWebPushResult> {
  if (!ensureWebPushConfigured()) {
    return {
      ok: false,
    }
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: input.endpoint,
        keys: {
          p256dh: input.p256dh,
          auth: input.auth,
        },
      },
      JSON.stringify({
        title: input.payload.title,
        body: input.payload.body,
      })
    )

    return {
      ok: true,
    }
  } catch (error) {
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : undefined

    console.error('Failed to send web push', {
      endpoint: input.endpoint,
      statusCode,
      error: error instanceof Error ? error.message : 'unknown_error',
    })

    return {
      ok: false,
      statusCode,
    }
  }
}
