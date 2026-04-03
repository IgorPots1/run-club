'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ChatSection from '@/components/ChatSection'
import InnerPageHeader from '@/components/InnerPageHeader'
import { useIsolatedViewportHeight } from '@/components/useIsolatedViewportHeight'
import { getBootstrapUser } from '@/lib/auth'
import { getCommonChannelTitle, IMPORTANT_INFO_CHANNEL_KEY } from '@/lib/chat/commonChannels'
import {
  dispatchChatUnreadUpdated,
  markThreadAsRead,
} from '@/lib/chat/reads'
import { updatePrefetchedMessagesListThreadUnreadCount } from '@/lib/chat/messagesListPrefetch'
import { getChatThreadById } from '@/lib/chat/threads'
import { COACH_USER_ID } from '@/lib/constants'
import {
  loadThreadPushSettings,
  updateThreadPushSettings,
} from '@/lib/notifications/settingsClient'
import type { PushLevel } from '@/lib/notifications/push'
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
  const [isAnnouncementChannel, setIsAnnouncementChannel] = useState(false)
  const [isReadOnlyAnnouncement, setIsReadOnlyAnnouncement] = useState(false)
  const [threadPushLevel, setThreadPushLevel] = useState<PushLevel>('all')
  const [isLoadingThreadMuteState, setIsLoadingThreadMuteState] = useState(false)
  const [isUpdatingThreadMute, setIsUpdatingThreadMute] = useState(false)
  const [threadMuteError, setThreadMuteError] = useState('')
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false)
  const isThreadLayoutReady = !loading
  const readOnlyAnnouncementMessage = 'Это канал с важной информацией. Публиковать сообщения может только тренер.'
  const threadPushOptionLabels: Record<PushLevel, string> = {
    all: 'Все сообщения',
    important_only: 'Только важные',
    mute: 'Без уведомлений',
  }

  useEffect(() => {
    return () => {
      if (markReadTimeoutRef.current !== null) {
        window.clearTimeout(markReadTimeoutRef.current)
      }
    }
  }, [])

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
          setIsAnnouncementChannel(false)
          setIsReadOnlyAnnouncement(false)
          setError('Чат недоступен')
          return
        }

        if (thread.type === 'club') {
          const isImportantInfoThread = thread.channel_key === IMPORTANT_INFO_CHANNEL_KEY
          setIsAnnouncementChannel(isImportantInfoThread)
          setIsReadOnlyAnnouncement(isImportantInfoThread && user.id !== COACH_USER_ID)
          setThreadTitle(getCommonChannelTitle(thread.channel_key) ?? thread.title ?? 'Общий чат')
          setError('')
          return
        }

        setIsAnnouncementChannel(false)
        setIsReadOnlyAnnouncement(false)

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
          setIsAnnouncementChannel(false)
          setIsReadOnlyAnnouncement(false)
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
    if (!threadId || !currentUserId) {
      setThreadPushLevel('all')
      setIsLoadingThreadMuteState(false)
      setThreadMuteError('')
      return
    }

    let isMounted = true
    setIsLoadingThreadMuteState(true)
    setThreadMuteError('')

    void loadThreadPushSettings(threadId)
      .then((settings) => {
        if (!isMounted) {
          return
        }

        setThreadPushLevel(settings.push_level)
      })
      .catch(() => {
        if (!isMounted) {
          return
        }

        setThreadPushLevel('all')
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

  const handleUpdateThreadPushLevel = useCallback(async (nextPushLevel: PushLevel) => {
    if (!threadId || isUpdatingThreadMute || nextPushLevel === threadPushLevel) {
      return
    }

    const previousPushLevel = threadPushLevel
    setThreadPushLevel(nextPushLevel)
    setIsUpdatingThreadMute(true)
    setThreadMuteError('')

    try {
      const updatedSettings = await updateThreadPushSettings(threadId, nextPushLevel)
      setThreadPushLevel(updatedSettings.push_level)
      setIsHeaderMenuOpen(false)
    } catch {
      setThreadPushLevel(previousPushLevel)
      setThreadMuteError('Не удалось обновить уведомления')
    } finally {
      setIsUpdatingThreadMute(false)
    }
  }, [isUpdatingThreadMute, threadId, threadPushLevel])

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
          className="app-card absolute right-0 top-full z-40 mt-1 min-w-[240px] rounded-2xl border p-1 shadow-lg"
          role="menu"
        >
          <div className="px-3 pb-2 pt-2">
            <p className="app-text-primary text-sm font-medium">Уведомления в чате</p>
            <p className="app-text-secondary mt-1 text-xs">Сейчас: {threadPushOptionLabels[threadPushLevel]}</p>
          </div>
          {(['all', 'important_only', 'mute'] as PushLevel[]).map((pushLevelOption) => {
            const isSelected = threadPushLevel === pushLevelOption

            return (
              <button
                key={pushLevelOption}
                type="button"
                onClick={() => {
                  void handleUpdateThreadPushLevel(pushLevelOption)
                }}
                disabled={isUpdatingThreadMute}
                className={`flex min-h-11 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60 ${
                  isSelected ? 'bg-black/[0.05] dark:bg-white/[0.08]' : ''
                }`}
                role="menuitemradio"
                aria-checked={isSelected}
              >
                <span className={pushLevelOption === 'important_only' ? 'font-medium' : undefined}>
                  {threadPushOptionLabels[pushLevelOption]}
                </span>
                <span className="app-text-secondary text-xs">{isSelected ? 'Выбрано' : ''}</span>
              </button>
            )
          })}
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
            isAnnouncementChannel={isAnnouncementChannel}
            isReadOnlyAnnouncement={isReadOnlyAnnouncement}
            readOnlyAnnouncementMessage={readOnlyAnnouncementMessage}
          />
        </div>
      </div>
    </main>
  )
}
