'use client'

import { useEffect, useState } from 'react'
import { getBootstrapUser } from '@/lib/auth'
import { getTotalUnreadCount } from '@/lib/chat/reads'
import { supabase } from '@/lib/supabase'

const CHAT_UNREAD_UPDATED_EVENT = 'chat-unread-updated'

type UnreadCountListener = (count: number) => void

const unreadCountListeners = new Set<UnreadCountListener>()

let sharedTotalUnreadCount = 0
let sharedCurrentUserId: string | null = null
let sharedUnreadChannel: ReturnType<typeof supabase.channel> | null = null
let sharedRefreshPromise: Promise<number> | null = null
let sharedInitPromise: Promise<void> | null = null
let sharedRefreshTimeoutId: number | null = null
let hasAttachedUnreadEventListener = false

function emitUnreadCount(nextCount: number) {
  sharedTotalUnreadCount = nextCount

  unreadCountListeners.forEach((listener) => {
    listener(nextCount)
  })
}

function handleUnreadCountEvent(event: Event) {
  if (!(event instanceof CustomEvent)) {
    return
  }

  if (typeof event.detail?.count === 'number') {
    emitUnreadCount(event.detail.count)
    return
  }

  if (typeof event.detail?.delta === 'number') {
    emitUnreadCount(Math.max(0, sharedTotalUnreadCount + event.detail.delta))
  }
}

function attachUnreadCountEventListener() {
  if (typeof window === 'undefined' || hasAttachedUnreadEventListener) {
    return
  }

  window.addEventListener(CHAT_UNREAD_UPDATED_EVENT, handleUnreadCountEvent)
  hasAttachedUnreadEventListener = true
}

function detachUnreadCountEventListener() {
  if (typeof window === 'undefined' || !hasAttachedUnreadEventListener) {
    return
  }

  window.removeEventListener(CHAT_UNREAD_UPDATED_EVENT, handleUnreadCountEvent)
  hasAttachedUnreadEventListener = false
}

async function refreshSharedTotalUnreadCount() {
  if (sharedRefreshPromise) {
    return sharedRefreshPromise
  }

  const refreshPromise = (async () => {
    try {
      const nextTotalUnreadCount = await getTotalUnreadCount()
      emitUnreadCount(nextTotalUnreadCount)
      return nextTotalUnreadCount
    } catch {
      emitUnreadCount(0)
      return 0
    }
  })()

  sharedRefreshPromise = refreshPromise

  try {
    return await refreshPromise
  } finally {
    if (sharedRefreshPromise === refreshPromise) {
      sharedRefreshPromise = null
    }
  }
}

function scheduleSharedTotalUnreadCountRefresh(delayMs = 120) {
  if (typeof window === 'undefined') {
    return
  }

  if (sharedRefreshTimeoutId !== null) {
    window.clearTimeout(sharedRefreshTimeoutId)
  }

  sharedRefreshTimeoutId = window.setTimeout(() => {
    sharedRefreshTimeoutId = null
    void refreshSharedTotalUnreadCount()
  }, delayMs)
}

async function ensureUnreadStoreInitialized() {
  if (typeof window === 'undefined') {
    return
  }

  attachUnreadCountEventListener()

  if (sharedUnreadChannel) {
    return
  }

  if (sharedInitPromise) {
    return sharedInitPromise
  }

  const initPromise = (async () => {
    try {
      const user = await getBootstrapUser()
      sharedCurrentUserId = user?.id ?? null
    } catch {
      sharedCurrentUserId = null
    }

    await refreshSharedTotalUnreadCount()

    if (unreadCountListeners.size === 0 || sharedUnreadChannel) {
      return
    }

    sharedUnreadChannel = supabase
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

          if (sharedCurrentUserId && nextMessageUserId === sharedCurrentUserId) {
            return
          }

          scheduleSharedTotalUnreadCountRefresh()
        }
      )
      .subscribe()
  })()

  sharedInitPromise = initPromise

  try {
    await initPromise
  } finally {
    if (sharedInitPromise === initPromise) {
      sharedInitPromise = null
    }
  }
}

function cleanupUnreadStoreIfUnused() {
  if (unreadCountListeners.size > 0) {
    return
  }

  detachUnreadCountEventListener()
  sharedCurrentUserId = null

  if (sharedUnreadChannel) {
    void supabase.removeChannel(sharedUnreadChannel)
    sharedUnreadChannel = null
  }

  if (sharedRefreshTimeoutId !== null) {
    window.clearTimeout(sharedRefreshTimeoutId)
    sharedRefreshTimeoutId = null
  }
}

export function useRealtimeTotalUnreadCount({ enabled = true }: { enabled?: boolean } = {}) {
  const [totalUnreadCount, setTotalUnreadCount] = useState(sharedTotalUnreadCount)

  useEffect(() => {
    function handleUnreadCountChange(nextCount: number) {
      setTotalUnreadCount(nextCount)
    }

    unreadCountListeners.add(handleUnreadCountChange)
    setTotalUnreadCount(sharedTotalUnreadCount)

    return () => {
      unreadCountListeners.delete(handleUnreadCountChange)
      cleanupUnreadStoreIfUnused()
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      return
    }

    void ensureUnreadStoreInitialized()
  }, [enabled])

  return {
    totalUnreadCount,
    refreshTotalUnreadCount: refreshSharedTotalUnreadCount,
  }
}

export async function initializeRealtimeTotalUnreadCount() {
  await ensureUnreadStoreInitialized()
}

export default useRealtimeTotalUnreadCount
