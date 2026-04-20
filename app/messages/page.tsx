import { redirect } from 'next/navigation'
import { COMMON_CHANNEL_KEYS, isCommonChannelKey, type CommonChannelKey } from '@/lib/chat/commonChannels'
import type { MessagesListPrefetchData } from '@/lib/chat/messagesListPrefetch'
import type {
  ChatThreadLastMessage,
  ClubThread,
  CoachDirectThreadItem,
  DirectCoachThreadItem,
  StudentProfile,
} from '@/lib/chat/threads'
import { COACH_USER_ID } from '@/lib/constants'
import { createSupabaseServerClient, getAuthenticatedUser } from '@/lib/supabase-server'
import MessagesPageClient from './MessagesPageClient'

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

type ChatThreadRow = {
  id: string
  type: 'club' | 'direct_coach'
  channel_key: CommonChannelKey | null
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
  text: string | null
  message_type: string | null
  image_url: string | null
  media_url: string | null
  media_duration_seconds: number | null
  created_at: string
  is_deleted?: boolean
}

type UnreadCountRpcRow = {
  thread_id: string
  unread_count: number | string | null
}

function normalizeProfileValue(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function getSeedProfileDisplayName(profile: ProfileRow | null | undefined, fallback = 'Бегун') {
  return normalizeProfileValue(profile?.nickname) ?? normalizeProfileValue(profile?.name) ?? fallback
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

function getThreadMessagePreviewText(
  message: Pick<ChatThreadLastMessageRow, 'text' | 'message_type' | 'image_url'>
) {
  const trimmedText = message.text?.trim() ?? ''

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

function getThreadActivityTimestamp(thread: { created_at: string; lastMessage: ChatThreadLastMessage | null }) {
  return new Date(thread.lastMessage?.createdAt ?? thread.created_at).getTime()
}

async function loadProfilesByUserIds(supabase: SupabaseServerClient, userIds: string[]) {
  if (userIds.length === 0) {
    return {}
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, nickname, avatar_url')
    .in('id', userIds)
    .eq('app_access_status', 'active')

  if (error) {
    throw error
  }

  return Object.fromEntries(
    ((data as ProfileRow[] | null) ?? []).map((profile) => [profile.id, profile])
  ) as Record<string, ProfileRow>
}

async function loadLastMessageByThreadId(supabase: SupabaseServerClient, threadIds: string[]) {
  if (threadIds.length === 0) {
    return {}
  }

  const { data, error } = await supabase
    .from('chat_threads')
    .select(`
      id,
      chat_messages!chat_messages_thread_id_fkey (
        id,
        thread_id,
        user_id,
        text,
        message_type,
        image_url,
        media_url,
        media_duration_seconds,
        created_at
      )
    `)
    .in('id', threadIds)
    .eq('chat_messages.is_deleted', false)
    .order('created_at', { ascending: false, foreignTable: 'chat_messages' })
    .order('id', { ascending: false, foreignTable: 'chat_messages' })
    .limit(1, { foreignTable: 'chat_messages' })

  if (error) {
    throw error
  }

  const latestMessageRowByThreadId = Object.fromEntries(
    (((data as Array<{
      id: string
      chat_messages: ChatThreadLastMessageRow[] | null
    }> | null) ?? [])
      .map((thread) => {
        const latestMessage = thread.chat_messages?.[0] ?? null

        if (!latestMessage) {
          return null
        }

        return [thread.id, latestMessage] as const
      })
      .filter((entry): entry is readonly [string, ChatThreadLastMessageRow] => entry !== null))
  ) as Record<string, ChatThreadLastMessageRow>

  const profileById = await loadProfilesByUserIds(
    supabase,
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
          text: row.text ?? '',
          messageType,
          mediaUrl: row.media_url ?? null,
          mediaDurationSeconds: row.media_duration_seconds ?? null,
          createdAt: row.created_at,
          senderDisplayName: getSeedProfileDisplayName(profileById[row.user_id], 'Бегун'),
          previewText: getThreadMessagePreviewText(row),
        } satisfies ChatThreadLastMessage,
      ]
    })
  ) as Record<string, ChatThreadLastMessage>
}

async function withLastMessages<T extends ChatThreadRow>(supabase: SupabaseServerClient, threads: T[]) {
  const lastMessageByThreadId = await loadLastMessageByThreadId(
    supabase,
    threads.map((thread) => thread.id)
  )

  return threads.map((thread) => ({
    ...thread,
    lastMessage: lastMessageByThreadId[thread.id] ?? null,
  }))
}

async function loadCommonChannelsSeed(supabase: SupabaseServerClient): Promise<ClubThread[]> {
  const { data, error } = await supabase
    .from('chat_threads')
    .select('id, type, channel_key, title, owner_user_id, coach_user_id, created_at')
    .eq('type', 'club')
    .in('channel_key', [...COMMON_CHANNEL_KEYS])

  if (error) {
    throw error
  }

  const threadRows = ((data as ChatThreadRow[] | null) ?? []).filter(
    (thread): thread is ClubThread =>
      thread.type === 'club' && isCommonChannelKey(thread.channel_key)
  )

  const threadRowsWithLastMessages = await withLastMessages(supabase, threadRows)

  return threadRowsWithLastMessages.sort(
    (left, right) =>
      COMMON_CHANNEL_KEYS.indexOf(left.channel_key) - COMMON_CHANNEL_KEYS.indexOf(right.channel_key)
  )
}

async function loadDirectCoachThreadSeed(
  supabase: SupabaseServerClient,
  ownerUserId: string
): Promise<DirectCoachThreadItem | null> {
  const { data, error } = await supabase
    .from('chat_threads')
    .select('id, type, channel_key, title, owner_user_id, coach_user_id, created_at')
    .eq('type', 'direct_coach')
    .eq('owner_user_id', ownerUserId)
    .eq('coach_user_id', COACH_USER_ID)
    .maybeSingle()

  if (error) {
    throw error
  }

  const thread = (data as ChatThreadRow | null) ?? null

  if (!thread) {
    return null
  }

  const [threadWithLastMessage] = await withLastMessages(supabase, [thread])
  return threadWithLastMessage ?? null
}

async function loadCoachDirectThreadsSeed(supabase: SupabaseServerClient): Promise<CoachDirectThreadItem[]> {
  const { data, error } = await supabase
    .from('chat_threads')
    .select('id, type, channel_key, title, owner_user_id, coach_user_id, created_at')
    .eq('type', 'direct_coach')
    .eq('coach_user_id', COACH_USER_ID)

  if (error) {
    throw error
  }

  const threadRows = (data as ChatThreadRow[] | null) ?? []
  const threadRowsWithLastMessages = await withLastMessages(supabase, threadRows)
  const studentIds = Array.from(
    new Set(
      threadRowsWithLastMessages
        .map((thread) => thread.owner_user_id)
        .filter((userId): userId is string => Boolean(userId))
    )
  )

  const profileById = await loadProfilesByUserIds(supabase, studentIds)

  return threadRowsWithLastMessages
    .map((thread) => ({
      ...thread,
      student: thread.owner_user_id ? profileById[thread.owner_user_id] ?? null : null,
    }))
    .sort((left, right) => getThreadActivityTimestamp(right) - getThreadActivityTimestamp(left))
}

async function loadStudentsSeed(supabase: SupabaseServerClient): Promise<StudentProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, nickname, avatar_url')
    .neq('id', COACH_USER_ID)
    .eq('app_access_status', 'active')
    .order('name', { ascending: true })

  if (error) {
    throw error
  }

  return (data as StudentProfile[] | null) ?? []
}

async function loadUnreadCountsByThreadSeed(
  supabase: SupabaseServerClient,
  userId: string
): Promise<MessagesListPrefetchData['unreadCountsByThread']> {
  const { data, error } = await supabase.rpc('get_unread_counts_by_thread', {
    p_user_id: userId,
  })

  if (error) {
    throw error
  }

  return Object.fromEntries(
    ((data as UnreadCountRpcRow[] | null) ?? []).map((row) => [
      row.thread_id,
      typeof row.unread_count === 'string'
        ? Number(row.unread_count)
        : Number(row.unread_count ?? 0),
    ])
  )
}

async function loadMessagesPageInitialSeed(
  supabase: SupabaseServerClient,
  userId: string
): Promise<MessagesListPrefetchData> {
  const [commonThreadsResult, unreadCountsResult] = await Promise.allSettled([
    loadCommonChannelsSeed(supabase),
    loadUnreadCountsByThreadSeed(supabase, userId),
  ])

  const commonThreads = commonThreadsResult.status === 'fulfilled' ? commonThreadsResult.value : []
  const unreadCountsByThread = unreadCountsResult.status === 'fulfilled' ? unreadCountsResult.value : {}

  if (userId === COACH_USER_ID) {
    const [directThreadsResult, studentsResult] = await Promise.allSettled([
      loadCoachDirectThreadsSeed(supabase),
      loadStudentsSeed(supabase),
    ])

    return {
      currentUserId: userId,
      commonThreads,
      coachThread: null,
      directThreads: directThreadsResult.status === 'fulfilled' ? directThreadsResult.value : [],
      students: studentsResult.status === 'fulfilled' ? studentsResult.value : [],
      unreadCountsByThread,
    }
  }

  const coachThreadResult = await Promise.allSettled([
    loadDirectCoachThreadSeed(supabase, userId),
  ])

  return {
    currentUserId: userId,
    commonThreads,
    coachThread: coachThreadResult[0].status === 'fulfilled' ? coachThreadResult[0].value : null,
    directThreads: [],
    students: [],
    unreadCountsByThread,
  }
}

export default async function MessagesPage() {
  const { user, error, supabase } = await getAuthenticatedUser()

  if (error || !user) {
    redirect('/login')
  }

  let initialSeed: MessagesListPrefetchData | null = null

  try {
    initialSeed = await loadMessagesPageInitialSeed(supabase, user.id)
  } catch {
    initialSeed = null
  }

  return <MessagesPageClient initialSeed={initialSeed} />
}
