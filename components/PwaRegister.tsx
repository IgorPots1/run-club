'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ensurePushServiceWorkerRegistration } from '@/lib/push/subscribeToPush'

export default function PwaRegister() {
  const router = useRouter()

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    void ensurePushServiceWorkerRegistration().catch(() => {})
  }, [])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const handler = (event: MessageEvent<{ type?: string; url?: string }>) => {
      if (event.data?.type !== 'NAVIGATE' || !event.data.url) {
        return
      }

      try {
        const nextUrl = new URL(event.data.url, window.location.origin)
        const href = nextUrl.origin === window.location.origin
          ? `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
          : nextUrl.toString()

        router.push(href)
      } catch {
        router.push(event.data.url)
      }
    }

    navigator.serviceWorker.addEventListener('message', handler)

    return () => {
      navigator.serviceWorker.removeEventListener('message', handler)
    }
  }, [router])

  return null
}
