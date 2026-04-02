'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ensurePushServiceWorkerRegistration } from '@/lib/push/subscribeToPush'

const CHAT_NOTIFICATION_NAVIGATE_EVENT = 'run-club:chat-notification-navigate'

function normalizeNavigationHref(url: string) {
  const nextUrl = new URL(url, window.location.origin)
  return nextUrl.origin === window.location.origin
    ? `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
    : nextUrl.toString()
}

export default function PwaRegister() {
  const router = useRouter()
  const pathname = usePathname()
  const lastHandledNavigationKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    void ensurePushServiceWorkerRegistration().catch(() => {})
  }, [])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const handler = (event: MessageEvent<{
      type?: string
      url?: string
      threadId?: string
      threadType?: string
      navigationKey?: string
      source?: string
    }>) => {
      if (event.data?.type !== 'NAVIGATE' || !event.data.url) {
        return
      }

      try {
        const href = normalizeNavigationHref(event.data.url)
        const navigationKey = event.data.navigationKey?.trim() || href

        if (lastHandledNavigationKeyRef.current === navigationKey) {
          return
        }

        lastHandledNavigationKeyRef.current = navigationKey

        window.dispatchEvent(
          new CustomEvent(CHAT_NOTIFICATION_NAVIGATE_EVENT, {
            detail: {
              href,
              threadId: event.data.threadId ?? null,
              threadType: event.data.threadType ?? null,
              source: event.data.source ?? 'service-worker',
            },
          })
        )

        if (href !== pathname) {
          router.push(href)
        }
      } catch {
        router.push(event.data.url)
      }
    }

    navigator.serviceWorker.addEventListener('message', handler)

    return () => {
      navigator.serviceWorker.removeEventListener('message', handler)
    }
  }, [pathname, router])

  return null
}
