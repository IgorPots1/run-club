import { COACH_USER_ID } from '../constants'
import { getProfileDisplayName } from '../profiles'
import { supabase } from '../supabase'

type ChatThreadRow = {
  id: string
  type: 'club' | 'direct_coach'
  title: string | null
  owner_user_id: string | null
  coach_user_id: string | null
  created_at: string
}

type ProfileRow = {
  id: string
  name: string | null
  nickname: string | null
  avatar_url: string | null
}

type ChatThreadLastMessageRow = {
  id: string
  thread_id: string
  user_id: string
  text: string
  message_type: string | null
  image_url: string | null
  media_url: string | null
  media_duration_seconds: number | null
  created_at: string
  is_deleted?: boolean
}

export type ChatThreadLastMessage = {
  id: string
  threadId: string
  userId: string
  text: string
  messageType: 'text' | 'image' | 'voice'
  mediaUrl: string | null
  mediaDurationSeconds: number | null
  createdAt: string
  senderDisplayName: string
  previewText: string
}

export type ClubThread = ChatThreadRow & {
  lastMessage: ChatThreadLastMessage | null
}

export type DirectCoachThread = ChatThreadRow

export type DirectCoachThreadItem = DirectCoachThread & {
  lastMessage: ChatThreadLastMessage | null
}

export type CoachDirectThreadItem = DirectCoachThreadItem & {
  student: ProfileRow | null
}

export type StudentProfile = ProfileRow

async function getOrCreateDirectCoachThreadViaApi(studentUserId: string): Promise<DirectCoachThread> {
  const response = await fetch('/api/chat/direct-thread', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      studentUserId,
    }),
  })

  const payload = await response.json().catch(() => null) as
    | {
        thread?: DirectCoachThread
        error?: string
      }
    | null

  if (!response.ok || !payload?.thread) {
    throw new Error(payload?.error ?? 'direct_thread_request_failed')
  }

  return payload.thread
}

async function findDirectCoachThread(ownerUserId: string) {
  const { data, error } = await supabase
    .from('chat_threads')
    .select('id, type, title, owner_user_id, coach_user_id, created_at')
    .eq('type', 'direct_coach')
    .eq('owner_user_id', ownerUserId)
    .eq('coach_user_id', COACH_USER_ID)
    .maybeSingle()

  if (error) {
    throw error
  }

  return (data as DirectCoachThread | null) ?? null
}

async function loadProfilesByUserIds(userIds: string[]) {
  if (userIds.length === 0) {
    return {}
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, nickname, avatar_url')
    .in('id', userIds)

  if (error) {
    throw error
  }

  return Object.fromEntries(
    ((data as ProfileRow[] | null) ?? []).map((profile) => [profile.id, profile])
  ) as Record<string, ProfileRow>
}

function resolveThreadMessageType(message: Pick<ChatThreadLastMessageRow, 'message_type' | 'image_url'>) {
  if (message.message_type === 'voice') {
    return 'voice' as const
  }

  if (message.message_type === 'image' || message.image_url) {
    return 'image' as const
  }

  return 'text' as const
}

function getThreadMessagePreviewText(message: Pick<ChatThreadLastMessageRow, 'text' | 'message_type' | 'image_url'>) {
  const trimmedText = message.text.trim()

  if (trimmedText) {
    return trimmedText
  }

  const messageType = resolveThreadMessageType(message)

  if (messageType === 'voice') {
    return 'Голосовое сообщение'
  }

  if (messageType === 'image') {
    return 'Фото'
  }

  return ''
}

async function loadLastMessageByThreadId(threadIds: string[]) {
  if (threadIds.length === 0) {
    return {}
  }

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, thread_id, user_id, text, message_type, image_url, media_url, media_duration_seconds, created_at')
    .eq('is_deleted', false)
    .in('thread_id', threadIds)
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  const latestMessageRowByThreadId: Record<string, ChatThreadLastMessageRow> = {}

  for (const row of (data as ChatThreadLastMessageRow[] | null) ?? []) {
    if (!latestMessageRowByThreadId[row.thread_id]) {
      latestMessageRowByThreadId[row.thread_id] = row
    }
  }

  const profileById = await loadProfilesByUserIds(
    Array.from(new Set(Object.values(latestMessageRowByThreadId).map((row) => row.user_id)))
  )

  return Object.fromEntries(
    Object.entries(latestMessageRowByThreadId).map(([threadId, row]) => {
      const messageType = resolveThreadMessageType(row)

      return [
        threadId,
        {
          id: row.id,
          threadId: row.thread_id,
          userId: row.user_id,
          text: row.text,
          messageType,
          mediaUrl: row.media_url ?? null,
          mediaDurationSeconds: row.media_duration_seconds ?? null,
          createdAt: row.created_at,
          senderDisplayName: getProfileDisplayName(profileById[row.user_id], 'Бегун'),
          previewText: getThreadMessagePreviewText(row),
        } satisfies ChatThreadLastMessage,
      ]
    })
  ) as Record<string, ChatThreadLastMessage>
}

export async function loadChatThreadLastMessage(messageId: string): Promise<ChatThreadLastMessage | null> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, thread_id, user_id, text, message_type, image_url, media_url, media_duration_seconds, created_at, is_deleted')
    .eq('id', messageId)
    .maybeSingle()

  if (error) {
    throw error
  }

  const messageRow = (data as ChatThreadLastMessageRow | null) ?? null

  if (!messageRow || messageRow.is_deleted) {
    return null
  }

  const profileById = await loadProfilesByUserIds([messageRow.user_id])
  const messageType = resolveThreadMessageType(messageRow)

  return {
    id: messageRow.id,
    threadId: messageRow.thread_id,
    userId: messageRow.user_id,
    text: messageRow.text,
    messageType,
    mediaUrl: messageRow.media_url ?? null,
    mediaDurationSeconds: messageRow.media_duration_seconds ?? null,
    createdAt: messageRow.created_at,
    senderDisplayName: getProfileDisplayName(profileById[messageRow.user_id], 'Бегун'),
    previewText: getThreadMessagePreviewText(messageRow),
  }
}

async function withLastMessages<T extends ChatThreadRow>(threads: T[]) {
  const lastMessageByThreadId = await loadLastMessageByThreadId(threads.map((thread) => thread.id))

  return threads.map((thread) => ({
    ...thread,
    lastMessage: lastMessageByThreadId[thread.id] ?? null,
  }))
}

function getThreadActivityTimestamp(thread: { created_at: string; lastMessage: ChatThreadLastMessage | null }) {
  return new Date(thread.lastMessage?.createdAt ?? thread.created_at).getTime()
}

export async function getDirectCoachThread(ownerUserId: string): Promise<DirectCoachThreadItem | null> {
  const thread = await findDirectCoachThread(ownerUserId)

  if (!thread) {
    return null
  }

  const [threadWithLastMessage] = await withLastMessages([thread])

  return threadWithLastMessage ?? null
}

export async function getClubThread(): Promise<ClubThread> {
  const { data, error } = await supabase
    .from('chat_threads')
    .select('id, type, title, owner_user_id, coach_user_id, created_at')
    .eq('type', 'club')
    .single()

  if (error) {
    throw error
  }

  const [threadWithLastMessage] = await withLastMessages([data as ChatThreadRow])

  return threadWithLastMessage as ClubThread
}

export async function getChatThreadById(threadId: string): Promise<ChatThreadRow | null> {
  console.log('[thread-open-debug] getChatThreadById:query', {
    threadId,
  })

  const { data, error } = await supabase
    .from('chat_threads')
    .select('id, type, title, owner_user_id, coach_user_id, created_at')
    .eq('id', threadId)
    .maybeSingle()

  if (error) {
    console.error('[thread-open-debug] getChatThreadById:error', {
      threadId,
      error,
    })
    throw error
  }

  console.log('[thread-open-debug] getChatThreadById:data', {
    threadId,
    isNull: data === null,
    data,
  })

  return (data as ChatThreadRow | null) ?? null
}

export async function getOrCreateDirectCoachThread(currentUserId: string): Promise<DirectCoachThread> {
  return getOrCreateDirectCoachThreadViaApi(currentUserId)
}

export async function getOrCreateCoachDirectThreadForStudent(studentUserId: string): Promise<DirectCoachThread> {
  const response = await fetch('/api/chat/direct-thread', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      studentUserId,
    }),
  })

  const payload = await response.json().catch(() => null) as
    | {
        thread?: DirectCoachThread
        error?: string
      }
    | null

  if (!response.ok || !payload?.thread) {
    throw new Error(payload?.error ?? 'direct_thread_request_failed')
  }

  return payload.thread
}

export async function getCoachDirectThreads(): Promise<CoachDirectThreadItem[]> {
  const { data: threads, error: threadsError } = await supabase
    .from('chat_threads')
    .select('id, type, title, owner_user_id, coach_user_id, created_at')
    .eq('type', 'direct_coach')
    .eq('coach_user_id', COACH_USER_ID)

  if (threadsError) {
    throw threadsError
  }

  const threadRows = (threads as DirectCoachThread[] | null) ?? []
  const threadRowsWithLastMessages = await withLastMessages(threadRows)
  const studentIds = Array.from(
    new Set(threadRowsWithLastMessages.map((thread) => thread.owner_user_id).filter((userId): userId is string => Boolean(userId)))
  )

  const profileById = await loadProfilesByUserIds(studentIds)

  return threadRowsWithLastMessages
    .map((thread) => ({
      ...thread,
      student: thread.owner_user_id ? profileById[thread.owner_user_id] ?? null : null,
    }))
    .sort((left, right) => getThreadActivityTimestamp(right) - getThreadActivityTimestamp(left))
}

export async function getStudents(): Promise<StudentProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, nickname, avatar_url')
    .neq('id', COACH_USER_ID)
    .order('name', { ascending: true })

  if (error) {
    throw error
  }

  return (data as StudentProfile[] | null) ?? []
}
