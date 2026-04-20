import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getProfileDisplayName } from '@/lib/profiles'
import { COMMON_CHANNEL_KEYS, isCommonChannelKey, type CommonChannelKey } from './commonChannels'
import type { UnreadCountsByThread } from './reads'
import type { ChatThreadLastMessage, ClubThread } from './threads'

type ChatThreadRow = {
  id: string
  type: 'club'
  channel_key: CommonChannelKey | null
  title: string | null
  owner_user_id: string | null
  coach_user_id: string | null
  created_at: string
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
}

type ProfileRow = {
  id: string
  name: string | null
  nickname: string | null
  avatar_url: string | null
}

type UnreadCountRpcRow = {
  thread_id: string
  unread_count: number | string | null
}

export type MessagesPageInitialSeed = {
  currentUserId: string
  commonThreads: ClubThread[]
  unreadCountsByThread: UnreadCountsByThread
  hasInitialUnreadCounts: boolean
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

async function loadProfilesByUserIds(userIds: string[]) {
  if (userIds.length === 0) {
    return {}
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const { data, error } = await supabaseAdmin
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

async function loadLastMessageByThreadId(threadIds: string[]) {
  if (threadIds.length === 0) {
    return {}
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const { data, error } = await supabaseAdmin
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
          senderDisplayName: getProfileDisplayName(profileById[row.user_id], 'Бегун'),
          previewText: getThreadMessagePreviewText(row),
        } satisfies ChatThreadLastMessage,
      ]
    })
  ) as Record<string, ChatThreadLastMessage>
}

async function loadCommonChannelsServer() {
  const supabaseAdmin = createSupabaseAdminClient()
  const { data, error } = await supabaseAdmin
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
  const lastMessageByThreadId = await loadLastMessageByThreadId(threadRows.map((thread) => thread.id))

  return threadRows
    .map((thread) => ({
      ...thread,
      lastMessage: lastMessageByThreadId[thread.id] ?? null,
    }))
    .sort(
      (left, right) =>
        COMMON_CHANNEL_KEYS.indexOf(left.channel_key) - COMMON_CHANNEL_KEYS.indexOf(right.channel_key)
    )
}

async function loadUnreadCountsByThreadServer(userId: string) {
  const supabaseAdmin = createSupabaseAdminClient()
  const { data, error } = await supabaseAdmin.rpc('get_unread_counts_by_thread', {
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
  ) as UnreadCountsByThread
}

export async function loadMessagesListFirstSectionServer(userId: string): Promise<MessagesPageInitialSeed> {
  const [commonThreadsResult, unreadCountsResult] = await Promise.allSettled([
    loadCommonChannelsServer(),
    loadUnreadCountsByThreadServer(userId),
  ])

  return {
    currentUserId: userId,
    commonThreads: commonThreadsResult.status === 'fulfilled' ? commonThreadsResult.value : [],
    unreadCountsByThread: unreadCountsResult.status === 'fulfilled' ? unreadCountsResult.value : {},
    hasInitialUnreadCounts: unreadCountsResult.status === 'fulfilled',
  }
}
