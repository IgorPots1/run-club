'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import UnreadBadge from '@/components/chat/UnreadBadge'
import {
  CHAT_UNREAD_UPDATED_EVENT,
  dispatchChatUnreadUpdated,
  getUnreadCountsByThread,
  type UnreadCountsByThread,
} from '@/lib/chat/reads'
import {
  getMessagesListCacheSnapshot,
  peekMessagesListCache,
  revalidateMessagesListCache,
  seedMessagesListCache,
  updatePrefetchedMessagesListThreadLastMessage,
  updatePrefetchedMessagesListUnreadCounts,
} from '@/lib/chat/messagesListPrefetch'
import { COACH_USER_ID } from '@/lib/constants'
import { formatChatThreadActivityLabel } from '@/lib/format'
import { COMMON_CHANNEL_KEYS, COMMON_CHANNEL_TITLE_BY_KEY } from '@/lib/chat/commonChannels'
import {
  type ChatThreadLastMessage,
  type ClubThread,
  type DirectCoachThreadItem,
  getCoachDirectThreads,
  getDirectCoachThread,
  loadChatThreadLastMessage,
  loadLatestChatThreadMessageByThreadId,
  getOrCreateCoachDirectThreadForStudent,
  getOrCreateDirectCoachThread,
  getStudents,
  type CoachDirectThreadItem,
  type StudentProfile,
} from '@/lib/chat/threads'
import { prefetchRecentChatMessages } from '@/lib/chat'
import { getProfileDisplayName } from '@/lib/profiles'
import { supabase } from '@/lib/supabase'

const MESSAGES_LIST_UNREAD_REFRESH_GUARD_MS = 4500
const THREAD_REALTIME_UPDATE_DEBOUNCE_MS = 180
const INITIAL_CHAT_MESSAGE_LIMIT = 30

type MessagesPageInitialSeed = {
  currentUserId: string
  commonThreads: ClubThread[]
  unreadCountsByThread: UnreadCountsByThread
  hasInitialUnreadCounts: boolean
}

function logMessagesListLoad(event: string, detail?: Record<string, number | string | boolean>) {
  if (process.env.NODE_ENV === 'production') {
    return
  }

  console.debug(`[messages-list] ${event}`, detail ?? {})
}

function readInitialMessagesListState() {
  if (typeof window === 'undefined') {
    return null
  }

  return getMessagesListCacheSnapshot()
}

function isNonNull<T>(value: T | null): value is T {
  return value !== null
}

function AvatarFallback() {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 20a6 6 0 0 0-12 0" />
        <circle cx="12" cy="8" r="4" />
      </svg>
    </span>
  )
}

function StudentAvatar({
  student,
}: {
  student: Pick<StudentProfile, 'avatar_url'>
}) {
  if (student.avatar_url) {
    return (
      <Image
        src={student.avatar_url}
        alt=""
        width={44}
        height={44}
        className="h-11 w-11 shrink-0 rounded-full object-cover"
      />
    )
  }

  return <AvatarFallback />
}

function ThreadAvatar({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-base font-semibold dark:bg-white/[0.08]">
      {children}
    </div>
  )
}

type MessageThreadListItem = {
  listKey: string
  id: string
  href: string
  title: string
  preview: string
  timeLabel: string
  unreadCount: number
  lastActivityAt: number
  avatar: ReactNode
}

type PendingThreadRealtimeUpdate = {
  insertedMessageIds: string[]
  shouldRefreshLatestMessage: boolean
  shouldRefreshUnreadCounts: boolean
}

function getLastMessagePreview(
  lastMessage: ChatThreadLastMessage | null,
  fallbackText: string,
  {
    currentUserId = null,
    prefixSender = false,
  }: {
    currentUserId?: string | null
    prefixSender?: boolean
  } = {}
) {
  if (!lastMessage) {
    return fallbackText
  }

  const previewText = lastMessage.previewText || 'Новое сообщение'

  if (!prefixSender) {
    return previewText
  }

  const senderLabel =
    currentUserId && lastMessage.userId === currentUserId
      ? 'Вы'
      : lastMessage.senderDisplayName

  return `${senderLabel}: ${previewText}`
}

function ThreadListRow({
  item,
  onPrefetch,
}: {
  item: MessageThreadListItem
  onPrefetch: (threadId: string) => void
}) {
  return (
    <Link
      href={item.href}
      onPointerDown={() => onPrefetch(item.id)}
      onClick={() => onPrefetch(item.id)}
      className="app-card flex items-center gap-3 rounded-2xl border p-4 shadow-sm"
    >
      {item.avatar}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="app-text-primary truncate text-sm font-medium">{item.title}</p>
            <p
              className={`truncate text-xs ${
                item.unreadCount > 0 ? 'app-text-primary font-medium' : 'app-text-secondary'
              }`}
            >
              {item.preview}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {item.timeLabel ? (
              <span className="app-text-secondary text-[11px]">{item.timeLabel}</span>
            ) : null}
            <UnreadBadge count={item.unreadCount} />
          </div>
        </div>
      </div>
    </Link>
  )
}

function MessagesSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="px-1">
        <h2 className="app-text-primary text-base font-semibold">{title}</h2>
        {description ? (
          <p className="app-text-secondary mt-1 text-xs">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function ThreadListSkeleton({
  count = 1,
}: {
  count?: number
}) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="app-card rounded-2xl border p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-full skeleton-line" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="skeleton-line h-4 w-28" />
              <div className="skeleton-line h-4 w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function MessagesPageClient({
  initialSeed,
}: {
  initialSeed: MessagesPageInitialSeed
}) {
  const router = useRouter()
  const processedInsertedMessageIdsRef = useRef<Set<string>>(new Set())
  const currentThreadLastMessageIdByThreadIdRef = useRef<Record<string, string | null>>({})
  const pendingThreadRealtimeUpdatesRef = useRef<Record<string, PendingThreadRealtimeUpdate>>({})
  const threadRealtimeUpdateTimeoutByThreadIdRef = useRef<Record<string, number>>({})
  const threadRealtimeUpdatePromiseByThreadIdRef = useRef<Partial<Record<string, Promise<void>>>>({})
  const unreadCountsRefreshPromiseRef = useRef<Promise<UnreadCountsByThread> | null>(null)
  const unreadCountsRefreshTimeoutRef = useRef<number | null>(null)
  const initialCacheSnapshot = readInitialMessagesListState()
  const initialCurrentUserId = initialCacheSnapshot?.currentUserId ?? initialSeed.currentUserId
  const initialCommonThreads = initialCacheSnapshot?.commonThreads ?? initialSeed.commonThreads
  const initialUnreadCountsByThread = initialCacheSnapshot?.unreadCountsByThread ?? initialSeed.unreadCountsByThread
  const hasImmediateSeed = initialCacheSnapshot !== null || Boolean(initialSeed.currentUserId)
  const hasInitialUnreadCounts = initialCacheSnapshot !== null || initialSeed.hasInitialUnreadCounts
  const lastUnreadFetchAtRef = useRef(hasInitialUnreadCounts ? Date.now() : 0)
  const [loadingCommon, setLoadingCommon] = useState(() => !hasImmediateSeed)
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => initialCurrentUserId ?? null)
  const [commonThreads, setCommonThreads] = useState<ClubThread[]>(() => initialCommonThreads)
  const [coachThread, setCoachThread] = useState<DirectCoachThreadItem | null>(
    () => initialCacheSnapshot?.coachThread ?? null
  )
  const [directThreads, setDirectThreads] = useState<CoachDirectThreadItem[]>(
    () => initialCacheSnapshot?.directThreads ?? []
  )
  const [students, setStudents] = useState<StudentProfile[]>(() => initialCacheSnapshot?.students ?? [])
  const [unreadCountsByThread, setUnreadCountsByThread] = useState<UnreadCountsByThread>(
    () => initialUnreadCountsByThread
  )
  const [error, setError] = useState('')
  const [openingCoachThread, setOpeningCoachThread] = useState(false)
  const [openingStudentId, setOpeningStudentId] = useState<string | null>(null)
  const [isActiveOpen, setIsActiveOpen] = useState(false)
  const [isAllStudentsOpen, setIsAllStudentsOpen] = useState(false)
  const [shouldLoadDeferredSections, setShouldLoadDeferredSections] = useState(false)
  const [deferredSectionsReady, setDeferredSectionsReady] = useState(() => initialCacheSnapshot !== null)
  const [realtimeReady, setRealtimeReady] = useState(() => initialCacheSnapshot !== null)

  const isCoach = currentUserId === COACH_USER_ID

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    delete document.documentElement.dataset.chatIsolatedRoute
    delete document.body.dataset.chatIsolatedRoute
    document.documentElement.style.removeProperty('--chat-app-height')
  }, [])

  const applyUnreadCountsByThread = useCallback((nextUnreadCountsByThread: UnreadCountsByThread) => {
    lastUnreadFetchAtRef.current = Date.now()
    setUnreadCountsByThread(nextUnreadCountsByThread)
    updatePrefetchedMessagesListUnreadCounts(nextUnreadCountsByThread)
  }, [])

  const setThreadUnreadCount = useCallback((threadId: string, unreadCount: number) => {
    const normalizedUnreadCount = Math.max(0, unreadCount)

    setUnreadCountsByThread((currentCounts) => {
      if ((currentCounts[threadId] ?? 0) === normalizedUnreadCount) {
        return currentCounts
      }

      const nextCounts = {
        ...currentCounts,
        [threadId]: normalizedUnreadCount,
      }

      updatePrefetchedMessagesListUnreadCounts(nextCounts)
      return nextCounts
    })
  }, [])

  const applyThreadLastMessage = useCallback(
    (threadId: string, lastMessage: ChatThreadLastMessage | null) => {
      updatePrefetchedMessagesListThreadLastMessage(threadId, lastMessage)

      setCommonThreads((currentThreads) =>
        currentThreads.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                lastMessage,
              }
            : thread
        )
      )

      setCoachThread((currentThread) =>
        currentThread?.id === threadId
          ? {
              ...currentThread,
              lastMessage,
            }
          : currentThread
      )

      setDirectThreads((currentThreads) =>
        currentThreads.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                lastMessage,
              }
            : thread
        )
      )
    },
    []
  )

  const refreshUnreadCounts = useCallback(async () => {
    if (unreadCountsRefreshPromiseRef.current) {
      return unreadCountsRefreshPromiseRef.current
    }

    const refreshPromise = getUnreadCountsByThread()
      .then((nextUnreadCountsByThread) => {
        applyUnreadCountsByThread(nextUnreadCountsByThread)
        return nextUnreadCountsByThread
      })
      .finally(() => {
        if (unreadCountsRefreshPromiseRef.current === refreshPromise) {
          unreadCountsRefreshPromiseRef.current = null
        }
      })

    unreadCountsRefreshPromiseRef.current = refreshPromise
    return refreshPromise
  }, [applyUnreadCountsByThread])

  const scheduleUnreadCountsRefresh = useCallback((delayMs = 120) => {
    if (typeof window === 'undefined') {
      return
    }

    if (unreadCountsRefreshTimeoutRef.current !== null) {
      window.clearTimeout(unreadCountsRefreshTimeoutRef.current)
    }

    unreadCountsRefreshTimeoutRef.current = window.setTimeout(() => {
      unreadCountsRefreshTimeoutRef.current = null
      void refreshUnreadCounts()
    }, delayMs)
  }, [refreshUnreadCounts])

  const flushThreadRealtimeUpdate = useCallback(
    async (threadId: string) => {
      const pendingUpdate = pendingThreadRealtimeUpdatesRef.current[threadId]

      if (!pendingUpdate) {
        return
      }

      if (threadRealtimeUpdatePromiseByThreadIdRef.current[threadId]) {
        const existingTimeout = threadRealtimeUpdateTimeoutByThreadIdRef.current[threadId]
        if (existingTimeout) {
          window.clearTimeout(existingTimeout)
        }

        threadRealtimeUpdateTimeoutByThreadIdRef.current[threadId] = window.setTimeout(() => {
          delete threadRealtimeUpdateTimeoutByThreadIdRef.current[threadId]
          void flushThreadRealtimeUpdate(threadId)
        }, THREAD_REALTIME_UPDATE_DEBOUNCE_MS)
        return
      }

      delete pendingThreadRealtimeUpdatesRef.current[threadId]

      const refreshPromise = (async () => {
        try {
          const shouldLoadLatestMessage =
            pendingUpdate.shouldRefreshLatestMessage || pendingUpdate.insertedMessageIds.length !== 1

          let nextLastMessage = shouldLoadLatestMessage
            ? await loadLatestChatThreadMessageByThreadId(threadId)
            : await loadChatThreadLastMessage(pendingUpdate.insertedMessageIds[0] ?? '')

          if (!nextLastMessage && pendingUpdate.insertedMessageIds.length > 0) {
            nextLastMessage = await loadLatestChatThreadMessageByThreadId(threadId)
          }

          if (nextLastMessage || pendingUpdate.shouldRefreshLatestMessage) {
            applyThreadLastMessage(threadId, nextLastMessage)
          }

          if (pendingUpdate.shouldRefreshUnreadCounts) {
            scheduleUnreadCountsRefresh()
          }
        } catch {
          pendingUpdate.insertedMessageIds.forEach((messageId) => {
            processedInsertedMessageIdsRef.current.delete(messageId)
          })
        } finally {
          delete threadRealtimeUpdatePromiseByThreadIdRef.current[threadId]

          if (pendingThreadRealtimeUpdatesRef.current[threadId]) {
            const existingTimeout = threadRealtimeUpdateTimeoutByThreadIdRef.current[threadId]
            if (existingTimeout) {
              window.clearTimeout(existingTimeout)
            }

            threadRealtimeUpdateTimeoutByThreadIdRef.current[threadId] = window.setTimeout(() => {
              delete threadRealtimeUpdateTimeoutByThreadIdRef.current[threadId]
              void flushThreadRealtimeUpdate(threadId)
            }, THREAD_REALTIME_UPDATE_DEBOUNCE_MS)
          }
        }
      })()

      threadRealtimeUpdatePromiseByThreadIdRef.current[threadId] = refreshPromise
      await refreshPromise
    },
    [applyThreadLastMessage, scheduleUnreadCountsRefresh]
  )

  const scheduleThreadRealtimeFlush = useCallback((threadId: string, delayMs = THREAD_REALTIME_UPDATE_DEBOUNCE_MS) => {
    if (typeof window === 'undefined') {
      return
    }

    const existingTimeout = threadRealtimeUpdateTimeoutByThreadIdRef.current[threadId]
    if (existingTimeout) {
      window.clearTimeout(existingTimeout)
    }

    threadRealtimeUpdateTimeoutByThreadIdRef.current[threadId] = window.setTimeout(() => {
      delete threadRealtimeUpdateTimeoutByThreadIdRef.current[threadId]
      void flushThreadRealtimeUpdate(threadId)
    }, delayMs)
  }, [flushThreadRealtimeUpdate])

  const queueThreadRealtimeUpdate = useCallback(
    ({
      threadId,
      messageId,
      refreshLatestMessage = false,
      refreshUnreadCounts = false,
    }: {
      threadId: string
      messageId?: string
      refreshLatestMessage?: boolean
      refreshUnreadCounts?: boolean
    }) => {
      const currentPendingUpdate = pendingThreadRealtimeUpdatesRef.current[threadId] ?? {
        insertedMessageIds: [],
        shouldRefreshLatestMessage: false,
        shouldRefreshUnreadCounts: false,
      }

      if (messageId && !currentPendingUpdate.insertedMessageIds.includes(messageId)) {
        currentPendingUpdate.insertedMessageIds.push(messageId)
      }

      if (currentPendingUpdate.insertedMessageIds.length > 1) {
        currentPendingUpdate.shouldRefreshLatestMessage = true
      }

      if (refreshLatestMessage) {
        currentPendingUpdate.shouldRefreshLatestMessage = true
      }

      if (refreshUnreadCounts) {
        currentPendingUpdate.shouldRefreshUnreadCounts = true
      }

      pendingThreadRealtimeUpdatesRef.current[threadId] = currentPendingUpdate
      scheduleThreadRealtimeFlush(threadId)
    },
    [scheduleThreadRealtimeFlush]
  )

  /** Visibility/focus only: avoids duplicating unread RPC right after cache hydration or a fresh fetch. */
  const scheduleUnreadCountsRefreshFromWindowAttention = useCallback((delayMs = 120) => {
    if (typeof window === 'undefined') {
      return
    }

    if (unreadCountsRefreshTimeoutRef.current !== null) {
      window.clearTimeout(unreadCountsRefreshTimeoutRef.current)
    }

    unreadCountsRefreshTimeoutRef.current = window.setTimeout(() => {
      unreadCountsRefreshTimeoutRef.current = null
      const elapsedSinceUnreadFetch = Date.now() - lastUnreadFetchAtRef.current
      if (elapsedSinceUnreadFetch < MESSAGES_LIST_UNREAD_REFRESH_GUARD_MS) {
        logMessagesListLoad('unread_refresh_skipped_recently', {
          elapsedMs: elapsedSinceUnreadFetch,
          guardMs: MESSAGES_LIST_UNREAD_REFRESH_GUARD_MS,
        })
        return
      }
      void refreshUnreadCounts()
    }, delayMs)
  }, [refreshUnreadCounts])

  function handlePrefetchThreadMessages(threadId: string) {
    void prefetchRecentChatMessages(INITIAL_CHAT_MESSAGE_LIMIT, threadId)
  }

  const directThreadByStudentId = useMemo(
    () =>
      Object.fromEntries(
        directThreads
          .filter((thread) => Boolean(thread.owner_user_id))
          .map((thread) => [thread.owner_user_id as string, thread])
      ) as Record<string, CoachDirectThreadItem>,
    [directThreads]
  )

  const commonChatItems = useMemo(() => {
    const commonThreadByKey = Object.fromEntries(
      commonThreads.map((thread) => [thread.channel_key, thread])
    ) as Record<ClubThread['channel_key'], ClubThread>

    return COMMON_CHANNEL_KEYS
      .map((channelKey) => {
        const thread = commonThreadByKey[channelKey]

        if (!thread) {
          return null
        }

        return {
          listKey: `common:${channelKey}:${thread.id}`,
          id: thread.id,
          href: `/messages/${thread.id}`,
          title: COMMON_CHANNEL_TITLE_BY_KEY[channelKey],
          preview: getLastMessagePreview(thread.lastMessage, 'Пока нет сообщений', {
            currentUserId,
            prefixSender: true,
          }),
          timeLabel: thread.lastMessage?.createdAt
            ? formatChatThreadActivityLabel(thread.lastMessage.createdAt)
            : '',
          unreadCount: unreadCountsByThread[thread.id] ?? 0,
          lastActivityAt: new Date(thread.lastMessage?.createdAt ?? thread.created_at).getTime(),
          avatar: <ThreadAvatar>{channelKey === 'important_info' ? '!' : 'O'}</ThreadAvatar>,
        } satisfies MessageThreadListItem
      })
      .filter(isNonNull)
  }, [commonThreads, currentUserId, unreadCountsByThread])

  const coachChatItem = useMemo(() => {
    if (!coachThread) {
      return null
    }

    return {
      listKey: `coach:${coachThread.id}`,
      id: coachThread.id,
      href: `/messages/${coachThread.id}`,
      title: 'Тренер',
      preview: getLastMessagePreview(coachThread.lastMessage, 'Личный чат со своим тренером'),
      timeLabel: coachThread.lastMessage?.createdAt
        ? formatChatThreadActivityLabel(coachThread.lastMessage.createdAt)
        : '',
      unreadCount: unreadCountsByThread[coachThread.id] ?? 0,
      lastActivityAt: new Date(coachThread.lastMessage?.createdAt ?? coachThread.created_at).getTime(),
      avatar: <ThreadAvatar>C</ThreadAvatar>,
    } satisfies MessageThreadListItem
  }, [coachThread, unreadCountsByThread])

  const activeDialogItems = useMemo(() => {
    return directThreads
      .filter((thread) => Boolean(thread.lastMessage))
      .slice()
      .sort((left, right) => {
        const leftLastMessageAt = left.lastMessage?.createdAt
          ? new Date(left.lastMessage.createdAt).getTime()
          : -1
        const rightLastMessageAt = right.lastMessage?.createdAt
          ? new Date(right.lastMessage.createdAt).getTime()
          : -1

        if (leftLastMessageAt !== rightLastMessageAt) {
          return rightLastMessageAt - leftLastMessageAt
        }

        return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
      })
      .map((thread) => ({
        listKey: `direct:${thread.id}`,
        id: thread.id,
        href: `/messages/${thread.id}`,
        title: getProfileDisplayName(thread.student, 'Ученик'),
        preview: getLastMessagePreview(thread.lastMessage, 'Личный чат'),
        timeLabel: thread.lastMessage?.createdAt
          ? formatChatThreadActivityLabel(thread.lastMessage.createdAt)
          : '',
        unreadCount: unreadCountsByThread[thread.id] ?? 0,
        lastActivityAt: new Date(thread.lastMessage?.createdAt ?? thread.created_at).getTime(),
        avatar: (
          <StudentAvatar
            student={{
              avatar_url: thread.student?.avatar_url ?? null,
            }}
          />
        ),
      }))
  }, [directThreads, unreadCountsByThread])

  const initialVisibleThreadIds = useMemo(() => {
    return Array.from(
      new Set([
        ...commonChatItems.map((item) => item.id),
        ...(coachChatItem ? [coachChatItem.id] : []),
        ...activeDialogItems.map((item) => item.id),
      ])
    ).slice(0, 5)
  }, [activeDialogItems, coachChatItem, commonChatItems])

  const knownThreadIdsSignature = useMemo(
    () =>
      [
        ...commonThreads.map((thread) => thread.id),
        ...(coachThread ? [coachThread.id] : []),
        ...directThreads.map((thread) => thread.id),
      ].join(','),
    [commonThreads, coachThread, directThreads]
  )

  useEffect(() => {
    currentThreadLastMessageIdByThreadIdRef.current = {
      ...Object.fromEntries(
        commonThreads.map((thread) => [thread.id, thread.lastMessage?.id ?? null] as const)
      ),
      ...(coachThread ? { [coachThread.id]: coachThread.lastMessage?.id ?? null } : {}),
      ...Object.fromEntries(
        directThreads.map((thread) => [thread.id, thread.lastMessage?.id ?? null] as const)
      ),
    }
  }, [commonThreads, coachThread, directThreads])

  useEffect(() => {
    initialVisibleThreadIds.forEach((threadId) => {
      void prefetchRecentChatMessages(INITIAL_CHAT_MESSAGE_LIMIT, threadId)
    })
  }, [initialVisibleThreadIds])

  useEffect(() => {
    return () => {
      if (unreadCountsRefreshTimeoutRef.current !== null) {
        window.clearTimeout(unreadCountsRefreshTimeoutRef.current)
        unreadCountsRefreshTimeoutRef.current = null
      }

      Object.values(threadRealtimeUpdateTimeoutByThreadIdRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId)
      })
      threadRealtimeUpdateTimeoutByThreadIdRef.current = {}
      pendingThreadRealtimeUpdatesRef.current = {}
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    const loadStartedAt = typeof performance !== 'undefined' ? performance.now() : 0

    async function loadPage() {
      try {
        const peek = peekMessagesListCache()

        if (peek?.data) {
          const cacheAgeMs = peek.dataFetchedAt > 0 ? Date.now() - peek.dataFetchedAt : -1
          logMessagesListLoad('cache_hit', {
            cacheAgeMs,
            needsRevalidate: peek.needsBackgroundRevalidate,
          })
          logMessagesListLoad('stale_rendered_immediately', { cacheAgeMs })

          setCurrentUserId(peek.data.currentUserId)
          setCommonThreads(peek.data.commonThreads)
          setCoachThread(peek.data.coachThread)
          setDirectThreads(peek.data.directThreads)
          setStudents(peek.data.students)
          applyUnreadCountsByThread(peek.data.unreadCountsByThread)
          setLoadingCommon(false)
          setDeferredSectionsReady(true)
          setShouldLoadDeferredSections(false)
          setRealtimeReady(true)
          setError('')

          if (peek.needsBackgroundRevalidate) {
            logMessagesListLoad('background_revalidate_started', { tSinceLoadMs: performance.now() - loadStartedAt })
            const fresh = await revalidateMessagesListCache()

            if (!isMounted || !fresh) {
              return
            }

            setCurrentUserId(fresh.currentUserId)
            setCommonThreads(fresh.commonThreads)
            setCoachThread(fresh.coachThread)
            setDirectThreads(fresh.directThreads)
            setStudents(fresh.students)
            applyUnreadCountsByThread(fresh.unreadCountsByThread)
            setDeferredSectionsReady(true)
            setShouldLoadDeferredSections(false)
            setRealtimeReady(true)
            setError('')
          }

          return
        }

        logMessagesListLoad('cache_miss', {})

        setCurrentUserId(initialCurrentUserId)
        setCommonThreads(initialCommonThreads)

        if (hasInitialUnreadCounts) {
          applyUnreadCountsByThread(initialUnreadCountsByThread)
        } else {
          setUnreadCountsByThread(initialUnreadCountsByThread)
        }

        logMessagesListLoad('server_seed_used', {
          commonThreadsCount: initialCommonThreads.length,
          hasInitialUnreadCounts,
        })

        setError('')
        setShouldLoadDeferredSections(true)
      } catch {
        if (isMounted) {
          setError('Не удалось загрузить сообщения')
        }
      } finally {
        if (isMounted) {
          setLoadingCommon(false)
        }
      }
    }

    void loadPage()

    return () => {
      isMounted = false
    }
  }, [
    applyUnreadCountsByThread,
    hasInitialUnreadCounts,
    initialCommonThreads,
    initialCurrentUserId,
    initialUnreadCountsByThread,
  ])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const totalUnreadCount = Object.values(unreadCountsByThread).reduce((total, count) => total + count, 0)
    dispatchChatUnreadUpdated({
      count: totalUnreadCount,
    })
  }, [unreadCountsByThread])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleUnreadUpdated = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return
      }

      const threadId = typeof event.detail?.threadId === 'string' ? event.detail.threadId : ''

      if (threadId && typeof event.detail?.unreadCountByThread === 'number') {
        setThreadUnreadCount(threadId, event.detail.unreadCountByThread)
      }

      if (event.detail?.refreshRequested) {
        scheduleUnreadCountsRefresh()
      }
    }

    window.addEventListener(CHAT_UNREAD_UPDATED_EVENT, handleUnreadUpdated)

    return () => {
      window.removeEventListener(CHAT_UNREAD_UPDATED_EVENT, handleUnreadUpdated)
    }
  }, [scheduleUnreadCountsRefresh, setThreadUnreadCount])

  useEffect(() => {
    if (loadingCommon || !currentUserId) {
      return
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        scheduleUnreadCountsRefreshFromWindowAttention(0)
      }
    }

    function handleWindowFocus() {
      scheduleUnreadCountsRefreshFromWindowAttention(0)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [currentUserId, loadingCommon, scheduleUnreadCountsRefreshFromWindowAttention])

  useEffect(() => {
    if (!shouldLoadDeferredSections || loadingCommon || !currentUserId || deferredSectionsReady) {
      return
    }

    const guaranteedCurrentUserId = currentUserId

    let cancelled = false
    let timeoutId: number | null = null
    let idleId: number | null = null

    const win = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    }

    async function loadDeferredSections() {
      try {
        if (guaranteedCurrentUserId === COACH_USER_ID) {
          const [nextDirectThreads, nextStudents] = await Promise.all([
            getCoachDirectThreads(),
            getStudents(),
          ])

          if (cancelled) {
            return
          }

          setDirectThreads(nextDirectThreads)
          setStudents(nextStudents)
          seedMessagesListCache({
            currentUserId: guaranteedCurrentUserId,
            commonThreads,
            coachThread: null,
            directThreads: nextDirectThreads,
            students: nextStudents,
            unreadCountsByThread,
          })
        } else {
          const nextCoachThread = await getDirectCoachThread(guaranteedCurrentUserId)

          if (cancelled) {
            return
          }

          setCoachThread(nextCoachThread)
          seedMessagesListCache({
            currentUserId: guaranteedCurrentUserId,
            commonThreads,
            coachThread: nextCoachThread,
            directThreads: [],
            students: [],
            unreadCountsByThread,
          })
        }

        setError('')
      } catch {
        if (!cancelled) {
          setError('Не удалось загрузить сообщения')
        }
      } finally {
        if (!cancelled) {
          setDeferredSectionsReady(true)
          setShouldLoadDeferredSections(false)
        }
      }
    }

    const scheduleDeferredSectionsLoad = () => {
      if (typeof win.requestIdleCallback === 'function') {
        idleId = win.requestIdleCallback(() => {
          idleId = null
          void loadDeferredSections()
        }, { timeout: 700 })
        return
      }

      timeoutId = window.setTimeout(() => {
        timeoutId = null
        void loadDeferredSections()
      }, 180)
    }

    scheduleDeferredSectionsLoad()

    return () => {
      cancelled = true

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }

      if (idleId !== null && typeof win.cancelIdleCallback === 'function') {
        win.cancelIdleCallback(idleId)
      }
    }
  }, [
    commonThreads,
    currentUserId,
    deferredSectionsReady,
    loadingCommon,
    shouldLoadDeferredSections,
    unreadCountsByThread,
  ])

  useEffect(() => {
    if (loadingCommon || !currentUserId || realtimeReady) {
      return
    }

    let cancelled = false
    let timeoutId: number | null = null
    let idleId: number | null = null

    const win = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    }

    const enableRealtime = () => {
      if (!cancelled) {
        setRealtimeReady(true)
      }
    }

    if (typeof win.requestIdleCallback === 'function') {
      idleId = win.requestIdleCallback(() => {
        idleId = null
        enableRealtime()
      }, { timeout: 900 })
    } else {
      timeoutId = window.setTimeout(() => {
        timeoutId = null
        enableRealtime()
      }, 250)
    }

    return () => {
      cancelled = true

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }

      if (idleId !== null && typeof win.cancelIdleCallback === 'function') {
        win.cancelIdleCallback(idleId)
      }
    }
  }, [currentUserId, loadingCommon, realtimeReady])

  useEffect(() => {
    if (loadingCommon || !currentUserId || !realtimeReady) {
      return
    }

    const knownThreadIds = new Set(
      knownThreadIdsSignature
        .split(',')
        .map((threadId) => threadId.trim())
        .filter(Boolean)
    )

    const channel = supabase
      .channel('messages-list:chat-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
        },
        async (payload) => {
          const nextMessageId = String((payload.new as { id?: string } | null)?.id ?? '')
          const nextMessageThreadId = String((payload.new as { thread_id?: string } | null)?.thread_id ?? '')
          const nextMessageUserId = String((payload.new as { user_id?: string } | null)?.user_id ?? '')

          if (!nextMessageId || processedInsertedMessageIdsRef.current.has(nextMessageId)) {
            return
          }

          if (!nextMessageThreadId || !knownThreadIds.has(nextMessageThreadId)) {
            return
          }

          processedInsertedMessageIdsRef.current.add(nextMessageId)

          if (processedInsertedMessageIdsRef.current.size > 200) {
            const recentIds = Array.from(processedInsertedMessageIdsRef.current).slice(-100)
            processedInsertedMessageIdsRef.current = new Set(recentIds)
          }

          queueThreadRealtimeUpdate({
            threadId: nextMessageThreadId,
            messageId: nextMessageId,
            refreshUnreadCounts: Boolean(nextMessageUserId && nextMessageUserId !== currentUserId),
          })
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_messages',
        },
        async (payload) => {
          const updatedMessageId = String((payload.new as { id?: string } | null)?.id ?? '')
          const updatedMessageThreadId = String((payload.new as { thread_id?: string } | null)?.thread_id ?? '')

          if (!updatedMessageId || !updatedMessageThreadId || !knownThreadIds.has(updatedMessageThreadId)) {
            return
          }

          const currentLastMessageId =
            currentThreadLastMessageIdByThreadIdRef.current[updatedMessageThreadId] ?? null

          if (currentLastMessageId !== updatedMessageId) {
            return
          }

          queueThreadRealtimeUpdate({
            threadId: updatedMessageThreadId,
            refreshLatestMessage: true,
            refreshUnreadCounts: true,
          })
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [
    applyThreadLastMessage,
    currentUserId,
    knownThreadIdsSignature,
    loadingCommon,
    queueThreadRealtimeUpdate,
    realtimeReady,
  ])

  async function handleOpenCoachChat() {
    if (!currentUserId || openingCoachThread) {
      return
    }

    if (coachThread) {
      handlePrefetchThreadMessages(coachThread.id)
      router.push(`/messages/${coachThread.id}`)
      return
    }

    setOpeningCoachThread(true)
    setError('')

    try {
      const thread = await getOrCreateDirectCoachThread(currentUserId)
      handlePrefetchThreadMessages(thread.id)
      router.push(`/messages/${thread.id}`)
    } catch {
      setError('Не удалось открыть чат с тренером')
    } finally {
      setOpeningCoachThread(false)
    }
  }

  async function handleOpenStudentThread(studentId: string) {
    if (openingStudentId) {
      return
    }

    const existingThread = directThreadByStudentId[studentId]

    if (existingThread) {
      handlePrefetchThreadMessages(existingThread.id)
      router.push(`/messages/${existingThread.id}`)
      return
    }

    setOpeningStudentId(studentId)
    setError('')

    try {
      const thread = await getOrCreateCoachDirectThreadForStudent(studentId)

      setDirectThreads((currentThreads) => {
        if (currentThreads.some((currentThread) => currentThread.id === thread.id)) {
          return currentThreads
        }

        const student = students.find((currentStudent) => currentStudent.id === studentId) ?? null

        return [
          {
            ...thread,
            lastMessage: null,
            student,
          },
          ...currentThreads,
        ]
      })

      handlePrefetchThreadMessages(thread.id)
      router.push(`/messages/${thread.id}`)
    } catch {
      setError('Не удалось открыть личный чат')
    } finally {
      setOpeningStudentId(null)
    }
  }

  return (
    <main className="min-h-full">
      <div className="mx-auto max-w-xl px-4 pb-[calc(80px+env(safe-area-inset-bottom))] pt-4">
        <div className="mb-4 px-1 pt-1">
          <h1 className="app-text-primary text-[28px] font-semibold tracking-[-0.02em]">Сообщения</h1>
        </div>

        {error ? (
          <section className="app-card mb-4 rounded-2xl border p-4 shadow-sm">
            <p className="text-sm text-red-600">{error}</p>
          </section>
        ) : null}

        <div className="space-y-3">
          <MessagesSection
            title="Общие чаты"
            description="Отдельные общие каналы клуба для отчетов, общения и важной информации."
          >
            {loadingCommon ? (
              <ThreadListSkeleton count={3} />
            ) : commonChatItems.length > 0 ? (
              <div className="space-y-3">
                {commonChatItems.map((item) => (
                  <ThreadListRow
                    key={item.listKey}
                    item={item}
                    onPrefetch={handlePrefetchThreadMessages}
                  />
                ))}
              </div>
            ) : (
              <section className="app-card rounded-2xl border p-4 shadow-sm">
                <p className="app-text-secondary text-sm">Общие каналы пока недоступны.</p>
              </section>
            )}
          </MessagesSection>

          {currentUserId && !isCoach ? (
            <MessagesSection
              title="Тренер"
              description="Отдельный блок для личного чата с тренером."
            >
              {loadingCommon || !currentUserId || !deferredSectionsReady ? (
                <ThreadListSkeleton />
              ) : (
                <section className="app-card rounded-2xl border p-4 shadow-sm">
                  <div className="space-y-3">
                    {coachChatItem ? (
                      <ThreadListRow
                        key={coachChatItem.listKey}
                        item={coachChatItem}
                        onPrefetch={handlePrefetchThreadMessages}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          void handleOpenCoachChat()
                        }}
                        disabled={openingCoachThread}
                        className="flex w-full items-center gap-3 rounded-2xl border border-black/[0.05] p-4 text-left shadow-sm disabled:opacity-60 dark:border-white/[0.08]"
                      >
                        <ThreadAvatar>C</ThreadAvatar>
                        <div className="min-w-0 flex-1">
                          <p className="app-text-primary text-sm font-medium">Тренер</p>
                          <p className="app-text-secondary text-xs">
                            {openingCoachThread ? 'Открываем чат...' : 'Личный чат со своим тренером'}
                          </p>
                        </div>
                      </button>
                    )}
                  </div>
                </section>
              )}
            </MessagesSection>
          ) : null}

          {isCoach ? (
            <>
              <MessagesSection
                title="Активные диалоги"
                description="Существующие личные чаты с учениками."
              >
                <section className="app-card rounded-2xl border p-4 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setIsActiveOpen((current) => !current)}
                    className="-mx-1 flex w-[calc(100%+0.5rem)] cursor-pointer items-center rounded-xl px-2 py-2 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                    aria-expanded={isActiveOpen}
                  >
                    <span className="app-text-primary text-base font-semibold">Активные диалоги</span>
                  </button>

                  {isActiveOpen ? (
                    <div className="mt-4">
                      {!deferredSectionsReady ? (
                        <ThreadListSkeleton />
                      ) : activeDialogItems.length > 0 ? (
                        <div className="space-y-3">
                          {activeDialogItems.map((item) => (
                            <ThreadListRow
                              key={item.listKey}
                              item={item}
                              onPrefetch={handlePrefetchThreadMessages}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="app-text-secondary text-sm">Пока нет активных личных диалогов.</p>
                      )}
                    </div>
                  ) : null}
                </section>
              </MessagesSection>

              <MessagesSection
                title="Все ученики"
                description="Открывайте существующий чат или создавайте его только при входе."
              >
                <section className="app-card rounded-2xl border p-4 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setIsAllStudentsOpen((current) => !current)}
                    className="-mx-1 flex w-[calc(100%+0.5rem)] cursor-pointer items-center rounded-xl px-2 py-2 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                    aria-expanded={isAllStudentsOpen}
                  >
                    <span className="app-text-primary text-base font-semibold">Все ученики</span>
                  </button>

                  {isAllStudentsOpen ? (
                    <div className="mt-4">
                      {!deferredSectionsReady ? (
                        <ThreadListSkeleton />
                      ) : students.length === 0 ? (
                        <p className="app-text-secondary text-sm">Пока нет зарегистрированных учеников.</p>
                      ) : (
                        <div className="space-y-2">
                          {students.map((student) => {
                            const existingThread = directThreadByStudentId[student.id]
                            const isOpeningThisStudent = openingStudentId === student.id

                            return (
                              <button
                                key={student.id}
                                type="button"
                                onClick={() => {
                                  void handleOpenStudentThread(student.id)
                                }}
                                disabled={isOpeningThisStudent}
                                aria-label={
                                  existingThread
                                    ? `Открыть чат с ${getProfileDisplayName(student, 'Ученик')}`
                                    : `Начать чат с ${getProfileDisplayName(student, 'Ученик')}`
                                }
                                aria-busy={isOpeningThisStudent}
                                className="flex w-full items-center gap-3 rounded-2xl border border-black/[0.05] px-3 py-3 text-left transition-colors hover:bg-black/[0.03] active:bg-black/[0.05] disabled:opacity-60 dark:border-white/[0.08] dark:hover:bg-white/[0.04] dark:active:bg-white/[0.06]"
                              >
                                <StudentAvatar student={student} />
                                <div className="min-w-0 flex-1">
                                  <p className="app-text-primary truncate text-sm font-medium">
                                    {getProfileDisplayName(student, 'Ученик')}
                                  </p>
                                  <p className="app-text-secondary truncate text-xs">
                                    {isOpeningThisStudent
                                      ? 'Открываем чат...'
                                      : student.nickname?.trim() || 'Профиль участника'}
                                  </p>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}
                </section>
              </MessagesSection>
            </>
          ) : null}
        </div>
      </div>
    </main>
  )
}
