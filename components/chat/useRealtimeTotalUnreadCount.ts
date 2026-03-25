'use client'

import { useEffect, useRef, useState } from 'react'
import { getBootstrapUser } from '@/lib/auth'
import { getTotalUnreadCount } from '@/lib/chat/reads'
import { supabase } from '@/lib/supabase'

const CHAT_UNREAD_UPDATED_EVENT = 'chat-unread-updated'

export function useRealtimeTotalUnreadCount() {
  const [totalUnreadCount, setTotalUnreadCount] = useState(0)
  const currentUserIdRef = useRef<string | null>(null)

  const refreshTotalUnreadCount = async (isMounted = true) => {
    try {
      const nextTotalUnreadCount = await getTotalUnreadCount()

      if (isMounted) {
        setTotalUnreadCount(nextTotalUnreadCount)
      }

      return nextTotalUnreadCount
    } catch {
      try {
        if (isMounted) {
          setTotalUnreadCount(0)
        }
      } catch {
        // Keep unread badge refresh non-blocking.
      }

      return 0
    }
  }

  useEffect(() => {
    let isMounted = true

    function handleUnreadCountEvent(event: Event) {
      if (!(event instanceof CustomEvent) || typeof event.detail?.count !== 'number') {
        return
      }

      setTotalUnreadCount(event.detail.count)
    }

    window.addEventListener(CHAT_UNREAD_UPDATED_EVENT, handleUnreadCountEvent)

    void getBootstrapUser().then((user) => {
      currentUserIdRef.current = user?.id ?? null
      void refreshTotalUnreadCount(isMounted)
    })

    const channel = supabase
      .channel('global-chat-unread-count')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
        },
        async (payload) => {
          const nextMessageUserId = String((payload.new as { user_id?: string } | null)?.user_id ?? '')

          if (currentUserIdRef.current && nextMessageUserId === currentUserIdRef.current) {
            return
          }

          await refreshTotalUnreadCount(isMounted)
        }
      )
      .subscribe()

    return () => {
      isMounted = false
      window.removeEventListener(CHAT_UNREAD_UPDATED_EVENT, handleUnreadCountEvent)
      void supabase.removeChannel(channel)
    }
  }, [])

  return {
    totalUnreadCount,
    refreshTotalUnreadCount,
  }
}

export default useRealtimeTotalUnreadCount
