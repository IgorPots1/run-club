'use client'

type PushSubscriptionPayload = {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

function base64UrlToUint8Array(value: string) {
  const paddedValue = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`
  const base64 = paddedValue.replace(/-/g, '+').replace(/_/g, '/')
  const rawValue = window.atob(base64)

  return Uint8Array.from(rawValue, (char) => char.charCodeAt(0))
}

function getPushSubscriptionPayload(subscription: PushSubscription): PushSubscriptionPayload {
  const subscriptionJson = subscription.toJSON()
  const endpoint = subscription.endpoint
  const p256dh = subscriptionJson.keys?.p256dh ?? ''
  const auth = subscriptionJson.keys?.auth ?? ''

  if (!endpoint || !p256dh || !auth) {
    throw new Error('invalid_push_subscription')
  }

  return {
    endpoint,
    keys: {
      p256dh,
      auth,
    },
  }
}

export async function ensurePushServiceWorkerRegistration() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('service_worker_not_supported')
  }

  await navigator.serviceWorker.register('/sw.js')
  return navigator.serviceWorker.ready
}

export async function subscribeToPush() {
  if (!('Notification' in window)) {
    throw new Error('notifications_not_supported')
  }

  if (!('PushManager' in window)) {
    throw new Error('push_not_supported')
  }

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()

  if (!vapidPublicKey) {
    throw new Error('missing_vapid_public_key')
  }

  const registration = await ensurePushServiceWorkerRegistration()
  const permission = await Notification.requestPermission()

  if (permission !== 'granted') {
    throw new Error(permission === 'denied' ? 'notification_permission_denied' : 'notification_permission_not_granted')
  }

  const existingSubscription = await registration.pushManager.getSubscription()
  const subscription = existingSubscription ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
  })

  const payload = getPushSubscriptionPayload(subscription)
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  const result = await response.json().catch(() => null) as
    | {
        error?: string
      }
    | null

  if (!response.ok) {
    throw new Error(result?.error ?? 'push_subscription_save_failed')
  }

  return payload
}
