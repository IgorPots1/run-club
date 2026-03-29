'use client'

import { useEffect } from 'react'
import { ensurePushServiceWorkerRegistration } from '@/lib/push/subscribeToPush'

export default function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    void ensurePushServiceWorkerRegistration().catch(() => {})
  }, [])

  return null
}
