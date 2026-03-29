'use client'

import { useEffect } from 'react'
import useRealtimeTotalUnreadCount from '@/components/chat/useRealtimeTotalUnreadCount'
import { clearAppBadge, setAppBadgeCount } from '@/lib/notifications/appBadge'

export default function UnreadBadgeSync() {
  const { totalUnreadCount } = useRealtimeTotalUnreadCount()

  useEffect(() => {
    if (totalUnreadCount > 0) {
      void setAppBadgeCount(totalUnreadCount)
      return
    }

    void clearAppBadge()
  }, [totalUnreadCount])

  return null
}
