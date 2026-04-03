import { getBootstrapUser } from '@/lib/auth'
import { getUnreadCountsByThread, type UnreadCountsByThread } from '@/lib/chat/reads'
import {
  COACH_USER_ID,
} from '@/lib/constants'
import {
  type ChatThreadLastMessage,
  type ClubThread,
  type DirectCoachThreadItem,
  getCommonChannels,
  getCoachDirectThreads,
  getDirectCoachThread,
  getStudents,
  type CoachDirectThreadItem,
  type StudentProfile,
} from '@/lib/chat/threads'

/** Cache entry is evicted after this; no instant hydration beyond this age. */
const MESSAGES_LIST_CACHE_MAX_AGE_MS = 5 * 60 * 1000

/**
 * After this age since last full fetch, show cached data immediately but refresh in the background.
 * Partial cache updates (unread / last message) do not reset this clock.
 */
const MESSAGES_LIST_BACKGROUND_REVALIDATE_AFTER_MS = 45 * 1000

export type MessagesListPrefetchData = {
  currentUserId: string
  commonThreads: ClubThread[]
  coachThread: DirectCoachThreadItem | null
  directThreads: CoachDirectThreadItem[]
  students: StudentProfile[]
  unreadCountsByThread: UnreadCountsByThread
}

type MessagesListPrefetchEntry = {
  promise: Promise<MessagesListPrefetchData | null>
  data: MessagesListPrefetchData | null
  expiresAt: number
  /** Set when a full list fetch completes; used for stale-while-revalidate. */
  dataFetchedAt: number
}

let messagesListPrefetchEntry: MessagesListPrefetchEntry | null = null

function isMessagesListPrefetchExpired(entry: MessagesListPrefetchEntry) {
  return Date.now() >= entry.expiresAt
}

function getMessagesListPrefetchEntry() {
  if (!messagesListPrefetchEntry) {
    return null
  }

  if (isMessagesListPrefetchExpired(messagesListPrefetchEntry)) {
    messagesListPrefetchEntry = null
    return null
  }

  return messagesListPrefetchEntry
}

function touchMessagesListCacheExpiry(entry: MessagesListPrefetchEntry) {
  entry.expiresAt = Date.now() + MESSAGES_LIST_CACHE_MAX_AGE_MS
}

function updateMessagesListPrefetchEntry(
  updater: (data: MessagesListPrefetchData) => MessagesListPrefetchData
) {
  const entry = getMessagesListPrefetchEntry()

  if (!entry?.data) {
    return
  }

  entry.data = updater(entry.data)
  touchMessagesListCacheExpiry(entry)
}

async function fetchMessagesListPrefetchData(): Promise<MessagesListPrefetchData | null> {
  const user = await getBootstrapUser()

  if (!user) {
    return null
  }

  const [commonThreads, unreadCountsByThread] = await Promise.all([
    getCommonChannels(),
    getUnreadCountsByThread(),
  ])

  if (user.id === COACH_USER_ID) {
    const [directThreads, students] = await Promise.all([
      getCoachDirectThreads(),
      getStudents(),
    ])

    return {
      currentUserId: user.id,
      commonThreads,
      coachThread: null,
      directThreads,
      students,
      unreadCountsByThread,
    }
  }

  const coachThread = await getDirectCoachThread(user.id)

  return {
    currentUserId: user.id,
    commonThreads,
    coachThread,
    directThreads: [],
    students: [],
    unreadCountsByThread,
  }
}

function applySuccessfulFetchToEntry(
  entry: MessagesListPrefetchEntry,
  data: MessagesListPrefetchData
) {
  entry.data = data
  entry.dataFetchedAt = Date.now()
  touchMessagesListCacheExpiry(entry)
}

/**
 * Synchronous read for instant hydration on client remount (e.g. router.back()).
 * Returns null if there is no valid cached payload.
 */
export function getMessagesListCacheSnapshot(): MessagesListPrefetchData | null {
  const entry = getMessagesListPrefetchEntry()

  if (!entry?.data) {
    return null
  }

  return entry.data
}

export type MessagesListCachePeek = {
  data: MessagesListPrefetchData
  needsBackgroundRevalidate: boolean
  dataFetchedAt: number
}

/**
 * Valid cache metadata for the messages list (same validity rules as snapshot).
 */
export function peekMessagesListCache(): MessagesListCachePeek | null {
  const entry = getMessagesListPrefetchEntry()

  if (!entry?.data) {
    return null
  }

  const fetchedAt = entry.dataFetchedAt
  const needsBackgroundRevalidate =
    fetchedAt > 0 && Date.now() - fetchedAt >= MESSAGES_LIST_BACKGROUND_REVALIDATE_AFTER_MS

  return {
    data: entry.data,
    needsBackgroundRevalidate,
    dataFetchedAt: fetchedAt,
  }
}

/**
 * Full refetch; updates in-place cache on success. Does not clear valid stale entries on failure.
 */
export function seedMessagesListCache(data: MessagesListPrefetchData) {
  messagesListPrefetchEntry = {
    promise: Promise.resolve(data),
    data,
    expiresAt: Date.now() + MESSAGES_LIST_CACHE_MAX_AGE_MS,
    dataFetchedAt: Date.now(),
  }
}

export async function revalidateMessagesListCache(): Promise<MessagesListPrefetchData | null> {
  const data = await fetchMessagesListPrefetchData()

  if (!data) {
    return null
  }

  const existing = getMessagesListPrefetchEntry()

  if (existing) {
    applySuccessfulFetchToEntry(existing, data)
    return data
  }

  messagesListPrefetchEntry = {
    promise: Promise.resolve(data),
    data,
    expiresAt: Date.now() + MESSAGES_LIST_CACHE_MAX_AGE_MS,
    dataFetchedAt: Date.now(),
  }

  return data
}

export function getPrefetchedMessagesListData(): Promise<MessagesListPrefetchData | null> | null {
  const entry = getMessagesListPrefetchEntry()

  if (!entry) {
    return null
  }

  if (entry.data) {
    return Promise.resolve(entry.data)
  }

  return entry.promise
}

export function prefetchMessagesListData(): Promise<MessagesListPrefetchData | null> {
  const existingEntry = getMessagesListPrefetchEntry()

  if (existingEntry) {
    return existingEntry.data ? Promise.resolve(existingEntry.data) : existingEntry.promise
  }

  const nextEntry: MessagesListPrefetchEntry = {
    promise: fetchMessagesListPrefetchData(),
    data: null,
    expiresAt: Date.now() + MESSAGES_LIST_CACHE_MAX_AGE_MS,
    dataFetchedAt: 0,
  }

  messagesListPrefetchEntry = nextEntry

  nextEntry.promise
    .then((data) => {
      if (messagesListPrefetchEntry !== nextEntry) {
        return
      }

      if (!data) {
        messagesListPrefetchEntry = null
        return
      }

      applySuccessfulFetchToEntry(nextEntry, data)
    })
    .catch(() => {
      if (messagesListPrefetchEntry === nextEntry) {
        messagesListPrefetchEntry = null
      }
    })

  return nextEntry.promise
}

export function updatePrefetchedMessagesListUnreadCounts(unreadCountsByThread: UnreadCountsByThread) {
  updateMessagesListPrefetchEntry((data) => ({
    ...data,
    unreadCountsByThread,
  }))
}

export function updatePrefetchedMessagesListThreadUnreadCount(threadId: string, unreadCount: number) {
  updateMessagesListPrefetchEntry((data) => ({
    ...data,
    unreadCountsByThread: {
      ...data.unreadCountsByThread,
      [threadId]: unreadCount,
    },
  }))
}

export function updatePrefetchedMessagesListThreadLastMessage(
  threadId: string,
  lastMessage: ChatThreadLastMessage | null
) {
  updateMessagesListPrefetchEntry((data) => ({
    ...data,
    commonThreads: data.commonThreads.map((thread) =>
      thread.id === threadId
        ? {
            ...thread,
            lastMessage,
          }
        : thread
    ),
    coachThread:
      data.coachThread?.id === threadId
        ? {
            ...data.coachThread,
            lastMessage,
          }
        : data.coachThread,
    directThreads: data.directThreads.map((thread) =>
      thread.id === threadId
        ? {
            ...thread,
            lastMessage,
          }
        : thread
    ),
  }))
}
