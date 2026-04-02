import { getBootstrapUser } from '@/lib/auth'
import { getUnreadCountsByThread, type UnreadCountsByThread } from '@/lib/chat/reads'
import {
  COACH_USER_ID,
} from '@/lib/constants'
import {
  type ChatThreadLastMessage,
  type ClubThread,
  type DirectCoachThreadItem,
  getClubThread,
  getCoachDirectThreads,
  getDirectCoachThread,
  getStudents,
  type CoachDirectThreadItem,
  type StudentProfile,
} from '@/lib/chat/threads'

const MESSAGES_LIST_PREFETCH_TTL_MS = 15000

export type MessagesListPrefetchData = {
  currentUserId: string
  clubThread: ClubThread | null
  coachThread: DirectCoachThreadItem | null
  directThreads: CoachDirectThreadItem[]
  students: StudentProfile[]
  unreadCountsByThread: UnreadCountsByThread
}

type MessagesListPrefetchEntry = {
  promise: Promise<MessagesListPrefetchData | null>
  data: MessagesListPrefetchData | null
  expiresAt: number
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

function updateMessagesListPrefetchEntry(
  updater: (data: MessagesListPrefetchData) => MessagesListPrefetchData
) {
  const entry = getMessagesListPrefetchEntry()

  if (!entry?.data) {
    return
  }

  entry.data = updater(entry.data)
  entry.expiresAt = Date.now() + MESSAGES_LIST_PREFETCH_TTL_MS
}

async function fetchMessagesListPrefetchData(): Promise<MessagesListPrefetchData | null> {
  const user = await getBootstrapUser()

  if (!user) {
    return null
  }

  const [clubThread, unreadCountsByThread] = await Promise.all([
    getClubThread(),
    getUnreadCountsByThread(),
  ])

  if (user.id === COACH_USER_ID) {
    const [directThreads, students] = await Promise.all([
      getCoachDirectThreads(),
      getStudents(),
    ])

    return {
      currentUserId: user.id,
      clubThread,
      coachThread: null,
      directThreads,
      students,
      unreadCountsByThread,
    }
  }

  const coachThread = await getDirectCoachThread(user.id)

  return {
    currentUserId: user.id,
    clubThread,
    coachThread,
    directThreads: [],
    students: [],
    unreadCountsByThread,
  }
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
    expiresAt: Date.now() + MESSAGES_LIST_PREFETCH_TTL_MS,
  }

  messagesListPrefetchEntry = nextEntry

  nextEntry.promise
    .then((data) => {
      if (messagesListPrefetchEntry !== nextEntry) {
        return
      }

      nextEntry.data = data
      nextEntry.expiresAt = Date.now() + MESSAGES_LIST_PREFETCH_TTL_MS
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
    clubThread:
      data.clubThread?.id === threadId
        ? {
            ...data.clubThread,
            lastMessage,
          }
        : data.clubThread,
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
