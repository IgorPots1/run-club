'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ChatSection from '@/components/ChatSection'
import InnerPageHeader from '@/components/InnerPageHeader'
import { useIsolatedViewportHeight } from '@/components/useIsolatedViewportHeight'
import { getBootstrapUser } from '@/lib/auth'
import { CHAT_OPEN_DEBUG, pushChatOpenDebug } from '@/lib/chatOpenDebug'
import {
  CHAT_UNREAD_UPDATED_EVENT,
  dispatchChatUnreadUpdated,
  markThreadAsRead,
} from '@/lib/chat/reads'
import { updatePrefetchedMessagesListThreadUnreadCount } from '@/lib/chat/messagesListPrefetch'
import { getChatThreadById } from '@/lib/chat/threads'
import { COACH_USER_ID } from '@/lib/constants'
import { loadThreadMuteState, toggleThreadMute } from '@/lib/notifications/toggleThreadMute'
import { getProfileDisplayName } from '@/lib/profiles'
import { supabase } from '@/lib/supabase'

type ProfileRow = {
  id: string
  name: string | null
  nickname: string | null
  email: string | null
}

const CHAT_NOTIFICATION_NAVIGATE_EVENT = 'run-club:chat-notification-navigate'

export default function MessageThreadPage() {
  const params = useParams<{ threadId: string }>()
  const router = useRouter()
  const { isKeyboardOpen, isolatedViewportStyle } = useIsolatedViewportHeight()
  const headerMenuRef = useRef<HTMLDivElement | null>(null)
  const markReadTimeoutRef = useRef<number | null>(null)
  const isMarkingThreadReadRef = useRef(false)
  const pendingMarkThreadReadRef = useRef(false)
  const threadId = typeof params?.threadId === 'string' ? params.threadId : ''
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [threadTitle, setThreadTitle] = useState('')
  const [error, setError] = useState('')
  const [threadMuted, setThreadMuted] = useState(false)
  const [isLoadingThreadMuteState, setIsLoadingThreadMuteState] = useState(false)
  const [isUpdatingThreadMute, setIsUpdatingThreadMute] = useState(false)
  const [threadMuteError, setThreadMuteError] = useState('')
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false)
  const isThreadLayoutReady = !loading && Boolean(threadTitle.trim())
  const routeDebugStateRef = useRef({
    threadId: threadId || null,
    loading,
    currentUserId,
    threadTitle,
    error,
    threadMuted,
    threadMuteError,
  })
  routeDebugStateRef.current = {
    threadId: threadId || null,
    loading,
    currentUserId,
    threadTitle,
    error,
    threadMuted,
    threadMuteError,
  }

  const logRouteDebug = useCallback((event: string, extra?: Record<string, unknown>) => {
    if (!CHAT_OPEN_DEBUG) {
      return
    }

    const snapshotState = routeDebugStateRef.current

    pushChatOpenDebug({
      now: Math.round(performance.now()),
      scope: 'thread-route',
      event,
      threadId: snapshotState.threadId,
      scrollTop: null,
      scrollHeight: null,
      clientHeight: null,
      distanceFromBottom: null,
      pendingInitialScroll: null,
      isInitialBottomLockActive: null,
      showScrollToBottomButton: null,
      messageCount: null,
      loading: snapshotState.loading,
      currentUserId: snapshotState.currentUserId,
      threadTitle: snapshotState.threadTitle,
      error: snapshotState.error,
      threadMuted: snapshotState.threadMuted,
      threadMuteError: snapshotState.threadMuteError,
      ...extra,
    })
  }, [])

  useEffect(() => {
    logRouteDebug('mount')

    return () => {
      logRouteDebug('unmount')
      if (markReadTimeoutRef.current !== null) {
        window.clearTimeout(markReadTimeoutRef.current)
      }
    }
  }, [logRouteDebug])

  useEffect(() => {
    let isMounted = true

    async function loadThreadPage() {
      try {
        const user = await getBootstrapUser()

        if (!isMounted) {
          return
        }

        if (!user) {
          router.replace('/login')
          return
        }

        setCurrentUserId(user.id)
        const thread = await getChatThreadById(threadId)

        if (!isMounted) {
          return
        }

        if (!thread) {
          setError('Чат недоступен')
          return
        }

        if (thread.type === 'club') {
          setThreadTitle('Общий чат')
          setError('')
          return
        }

        if (user.id !== COACH_USER_ID) {
          setThreadTitle('Связь с тренером')
          setError('')
          return
        }

        if (!thread.owner_user_id) {
          setThreadTitle('Личный чат')
          setError('')
          return
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, name, nickname, email')
          .eq('id', thread.owner_user_id)
          .maybeSingle()

        if (profileError) {
          throw profileError
        }

        if (!isMounted) {
          return
        }

        setThreadTitle(getProfileDisplayName((profile as ProfileRow | null) ?? null, 'Ученик'))
        setError('')
      } catch {
        if (isMounted) {
          setError('Не удалось открыть чат')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    if (!threadId) {
      setLoading(false)
      setError('Некорректный чат')
      return
    }

    void loadThreadPage()

    return () => {
      isMounted = false
    }
  }, [router, threadId])

  useEffect(() => {
    if (!currentUserId) {
      return
    }

    logRouteDebug('current-user-set')
  }, [currentUserId, logRouteDebug])

  useEffect(() => {
    if (!threadTitle) {
      return
    }

    logRouteDebug('thread-title-set')
  }, [logRouteDebug, threadTitle])

  useEffect(() => {
    if (loading) {
      return
    }

    logRouteDebug('loading-false')
  }, [loading, logRouteDebug])

  useEffect(() => {
    if (!threadId || !currentUserId) {
      setThreadMuted(false)
      setIsLoadingThreadMuteState(false)
      setThreadMuteError('')
      return
    }

    let isMounted = true
    setIsLoadingThreadMuteState(true)
    setThreadMuteError('')

    void loadThreadMuteState(threadId)
      .then((muted) => {
        if (!isMounted) {
          return
        }

        setThreadMuted(muted)
      })
      .catch(() => {
        if (!isMounted) {
          return
        }

        setThreadMuted(false)
        setThreadMuteError('Не удалось загрузить настройки уведомлений')
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingThreadMuteState(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [currentUserId, threadId])

  useEffect(() => {
    if (!isHeaderMenuOpen) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      if (!headerMenuRef.current?.contains(event.target as Node)) {
        setIsHeaderMenuOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsHeaderMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isHeaderMenuOpen])

  const handleToggleThreadMute = useCallback(async () => {
    if (!threadId || isUpdatingThreadMute) {
      return
    }

    const previousMuted = threadMuted
    const nextMuted = !threadMuted

    setThreadMuted(nextMuted)
    setIsUpdatingThreadMute(true)
    setThreadMuteError('')
    setIsHeaderMenuOpen(false)

    try {
      const confirmedMuted = await toggleThreadMute(threadId, nextMuted)
      setThreadMuted(confirmedMuted)
    } catch {
      setThreadMuted(previousMuted)
      setThreadMuteError('Не удалось обновить уведомления')
    } finally {
      setIsUpdatingThreadMute(false)
    }
  }, [isUpdatingThreadMute, threadId, threadMuted])

  useEffect(() => {
    if (loading || error || !currentUserId || !threadId) {
      return
    }

    async function runMarkThreadAsRead() {
      if (isMarkingThreadReadRef.current) {
        pendingMarkThreadReadRef.current = true
        return
      }

      isMarkingThreadReadRef.current = true

      try {
        const { clearedUnreadCount } = await markThreadAsRead(threadId)
        updatePrefetchedMessagesListThreadUnreadCount(threadId, 0)
        dispatchChatUnreadUpdated({
          delta: -clearedUnreadCount,
          threadId,
          unreadCountByThread: 0,
          refreshRequested: true,
        })
      } catch {
        // Keep read refresh non-blocking while the thread stays open.
      } finally {
        isMarkingThreadReadRef.current = false

        if (pendingMarkThreadReadRef.current) {
          pendingMarkThreadReadRef.current = false
          void runMarkThreadAsRead()
        }
      }
    }

    function scheduleMarkThreadAsRead(delayMs = 0) {
      if (markReadTimeoutRef.current !== null) {
        window.clearTimeout(markReadTimeoutRef.current)
      }

      markReadTimeoutRef.current = window.setTimeout(() => {
        markReadTimeoutRef.current = null
        void runMarkThreadAsRead()
      }, delayMs)
    }

    scheduleMarkThreadAsRead()

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        scheduleMarkThreadAsRead(150)
      }
    }

    function handleNotificationNavigation(event: Event) {
      const detail = (event as CustomEvent<{ threadId?: string | null }>).detail

      if (detail?.threadId !== threadId) {
        return
      }

      scheduleMarkThreadAsRead(50)
    }

    const channel = supabase
      .channel(`thread-read-refresh:${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const nextMessageUserId = String((payload.new as { user_id?: string } | null)?.user_id ?? '')

          if (!nextMessageUserId || nextMessageUserId === currentUserId) {
            return
          }

          scheduleMarkThreadAsRead(250)
        }
      )
      .subscribe()

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener(CHAT_NOTIFICATION_NAVIGATE_EVENT, handleNotificationNavigation as EventListener)

    return () => {
      if (markReadTimeoutRef.current !== null) {
        window.clearTimeout(markReadTimeoutRef.current)
        markReadTimeoutRef.current = null
      }

      pendingMarkThreadReadRef.current = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener(CHAT_NOTIFICATION_NAVIGATE_EVENT, handleNotificationNavigation as EventListener)
      void supabase.removeChannel(channel)
    }
  }, [currentUserId, error, loading, threadId])

  if (!loading && (error || !currentUserId || !threadId)) {
    return (
      <main
        data-chat-isolated-route="true"
        className="min-h-screen px-4 pb-4 pt-[env(safe-area-inset-top)]"
        style={isolatedViewportStyle}
      >
        <div className="mx-auto max-w-3xl">
          <InnerPageHeader title="Чат" fallbackHref="/messages" minimal />
          <section className="app-card rounded-2xl border p-4 shadow-sm">
            <p className="text-sm text-red-600">{error || 'Не удалось открыть чат'}</p>
          </section>
        </div>
      </main>
    )
  }

  const headerRightSlot = threadId ? (
    <div ref={headerMenuRef} className="relative">
      <button
        type="button"
        onClick={() => setIsHeaderMenuOpen((open) => !open)}
        disabled={isLoadingThreadMuteState || isUpdatingThreadMute}
        className="app-text-primary inline-flex h-11 w-11 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-60"
        aria-label="Действия чата"
        aria-expanded={isHeaderMenuOpen}
        aria-haspopup="menu"
      >
        <span aria-hidden="true" className="text-xl leading-none">...</span>
      </button>
      {isHeaderMenuOpen ? (
        <div
          className="app-card absolute right-0 top-full z-40 mt-1 min-w-[220px] rounded-2xl border p-1 shadow-lg"
          role="menu"
        >
          <button
            type="button"
            onClick={() => {
              void handleToggleThreadMute()
            }}
            disabled={isUpdatingThreadMute}
            className="app-text-primary flex min-h-11 w-full items-center rounded-xl px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60"
            role="menuitem"
          >
            {threadMuted ? 'Включить уведомления' : 'Выключить уведомления'}
          </button>
        </div>
      ) : null}
    </div>
  ) : null

  return (
    <main
      data-chat-isolated-route="true"
      className="flex flex-col overflow-hidden"
      style={isolatedViewportStyle}
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
        <InnerPageHeader title={threadTitle || ' '} fallbackHref="/messages" minimal rightSlot={headerRightSlot} />
        {threadMuteError ? (
          <div className="px-4 pb-2">
            <p className="text-xs text-red-600">{threadMuteError}</p>
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <ChatSection
            showTitle={false}
            threadId={threadId}
            currentUserId={currentUserId}
            isKeyboardOpen={isKeyboardOpen}
            isThreadLayoutReady={isThreadLayoutReady}
          />
        </div>
      </div>
    </main>
  )
}
