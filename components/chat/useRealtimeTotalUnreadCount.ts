'use client'

import { useEffect, useRef, useState } from 'react'
import { getBootstrapUser } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { CHAT_UNREAD_COUNT_EVENT, refreshAndDispatchChatUnreadCount } from '@/lib/chat/unread-events'

export default function useRealtimeTotalUnreadCount() {
  const [totalUnreadCount, setTotalUnreadCount] = useState(0)
  const currentUserIdRef = useRef<string | null>(null)

  const refreshTotalUnreadCount = async (isMounted = true) => {
    try {
      const nextTotalUnreadCount = await refreshAndDispatchChatUnreadCount()

      if (isMounted) {
        setTotalUnreadCount(nextTotalUnreadCount)
      }
    } catch {
      try {
        if (isMounted) {
          setTotalUnreadCount(0)
        }
      } catch {
        // Keep unread badge refresh non-blocking.
      }
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

    window.addEventListener(CHAT_UNREAD_COUNT_EVENT, handleUnreadCountEvent)

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
      window.removeEventListener(CHAT_UNREAD_COUNT_EVENT, handleUnreadCountEvent)
      void supabase.removeChannel(channel)
    }
  }, [])

  return {
    totalUnreadCount,
    refreshTotalUnreadCount,
  }
}
