import { formatRunDateTimeLabel } from './format'
import { getProfileDisplayName } from './profiles'
import { supabase } from './supabase'

export const CHAT_MESSAGE_MAX_LENGTH = 500

type ChatMessageRow = {
  id: string
  user_id: string
  text: string
  created_at: string
  is_deleted: boolean
  reply_to_id: string | null
}

type ChatReadStateRow = {
  user_id: string
  last_read_at: string | null
  updated_at: string
}

type ProfileRow = {
  id: string
  name: string | null
  nickname?: string | null
  email: string | null
  avatar_url?: string | null
}

export type ChatMessageItem = {
  id: string
  userId: string
  text: string
  createdAt: string
  createdAtLabel: string
  isDeleted: boolean
  displayName: string
  avatarUrl: string | null
  replyToId: string | null
  replyTo: {
    id: string
    userId: string | null
    displayName: string
    text: string
  } | null
}

async function loadProfilesByUserIds(userIds: string[]) {
  if (userIds.length === 0) {
    return {}
  }

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name, nickname, email, avatar_url')
    .in('id', userIds)

  if (profilesError) {
    throw profilesError
  }

  return Object.fromEntries(((profiles as ProfileRow[] | null) ?? []).map((profile) => [profile.id, profile])) as Record<string, ProfileRow>
}

function toChatReplyPreview(message: ChatMessageRow | null | undefined, profile?: ProfileRow) {
  if (!message) {
    return null
  }

  if (message.is_deleted) {
    return {
      id: message.id,
      userId: message.user_id,
      displayName: getProfileDisplayName(profile, 'Ответ'),
      text: 'Сообщение недоступно',
    }
  }

  return {
    id: message.id,
    userId: message.user_id,
    displayName: getProfileDisplayName(profile, 'Бегун'),
    text: message.text,
  }
}

function toChatMessageItem(
  message: ChatMessageRow,
  profile?: ProfileRow,
  replyToMessage?: ChatMessageRow | null,
  replyToProfile?: ProfileRow
): ChatMessageItem {
  return {
    id: message.id,
    userId: message.user_id,
    text: message.text,
    createdAt: message.created_at,
    createdAtLabel: formatRunDateTimeLabel(message.created_at),
    isDeleted: message.is_deleted,
    displayName: getProfileDisplayName(profile, 'Бегун'),
    avatarUrl: profile?.avatar_url ?? null,
    replyToId: message.reply_to_id,
    replyTo: message.reply_to_id ? toChatReplyPreview(replyToMessage, replyToProfile) : null,
  }
}

async function loadChatReplyRowsByIds(replyIds: string[]) {
  if (replyIds.length === 0) {
    return {}
  }

  const { data: replyMessages, error: replyMessagesError } = await supabase
    .from('chat_messages')
    .select('id, user_id, text, created_at, is_deleted, reply_to_id')
    .in('id', replyIds)

  if (replyMessagesError) {
    throw replyMessagesError
  }

  return Object.fromEntries(((replyMessages as ChatMessageRow[] | null) ?? []).map((message) => [message.id, message])) as Record<string, ChatMessageRow>
}

export async function createChatMessage(userId: string, text: string, replyToId?: string | null) {
  const trimmedText = text.trim()

  if (!trimmedText) {
    throw new Error('empty_message')
  }

  if (trimmedText.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw new Error('message_too_long')
  }

  return supabase.from('chat_messages').insert({
    user_id: userId,
    text: trimmedText,
    reply_to_id: replyToId ?? null,
  })
}

export async function loadChatReadState(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('chat_read_states')
    .select('last_read_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return ((data as Pick<ChatReadStateRow, 'last_read_at'> | null) ?? null)?.last_read_at ?? null
}

export async function upsertChatReadState(userId: string, lastReadAt: string | null) {
  return supabase
    .from('chat_read_states')
    .upsert(
      {
        user_id: userId,
        last_read_at: lastReadAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
}

export async function softDeleteChatMessage(messageId: string, userId: string) {
  return supabase
    .from('chat_messages')
    .update({
      is_deleted: true,
    })
    .eq('id', messageId)
    .eq('user_id', userId)
}

export async function loadChatMessageItem(messageId: string): Promise<ChatMessageItem | null> {
  const { data: message, error: messageError } = await supabase
    .from('chat_messages')
    .select('id, user_id, text, created_at, is_deleted, reply_to_id')
    .eq('id', messageId)
    .maybeSingle()

  if (messageError) {
    throw messageError
  }

  const messageRow = message as ChatMessageRow | null

  if (!messageRow || messageRow.is_deleted) {
    return null
  }

  const replyById = await loadChatReplyRowsByIds(messageRow.reply_to_id ? [messageRow.reply_to_id] : [])
  const replyMessage = messageRow.reply_to_id ? replyById[messageRow.reply_to_id] ?? null : null
  const profileIds = Array.from(
    new Set([
      messageRow.user_id,
      ...(replyMessage ? [replyMessage.user_id] : []),
    ])
  )
  const profileById = await loadProfilesByUserIds(profileIds)

  return toChatMessageItem(
    messageRow,
    profileById[messageRow.user_id],
    replyMessage,
    replyMessage ? profileById[replyMessage.user_id] : undefined
  )
}

export async function loadRecentChatMessages(limit = 50): Promise<ChatMessageItem[]> {
  const { data: messages, error: messagesError } = await supabase
    .from('chat_messages')
    .select('id, user_id, text, created_at, is_deleted, reply_to_id')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (messagesError) {
    throw messagesError
  }

  const messageRows = ((messages as ChatMessageRow[] | null) ?? []).slice().reverse()
  const replyIds = Array.from(
    new Set(messageRows.map((message) => message.reply_to_id).filter((replyToId): replyToId is string => Boolean(replyToId)))
  )
  const replyById = await loadChatReplyRowsByIds(replyIds)
  const userIds = Array.from(
    new Set([
      ...messageRows.map((message) => message.user_id),
      ...Object.values(replyById).map((message) => message.user_id),
    ])
  )
  const profileById = await loadProfilesByUserIds(userIds)

  return messageRows.map((message) => {
    const replyMessage = message.reply_to_id ? replyById[message.reply_to_id] ?? null : null

    return toChatMessageItem(
      message,
      profileById[message.user_id],
      replyMessage,
      replyMessage ? profileById[replyMessage.user_id] : undefined
    )
  })
}

export async function loadOlderChatMessages(beforeCreatedAt: string, limit = 10): Promise<ChatMessageItem[]> {
  const { data: messages, error: messagesError } = await supabase
    .from('chat_messages')
    .select('id, user_id, text, created_at, is_deleted, reply_to_id')
    .eq('is_deleted', false)
    .lt('created_at', beforeCreatedAt)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (messagesError) {
    throw messagesError
  }

  const messageRows = ((messages as ChatMessageRow[] | null) ?? []).slice().reverse()
  const replyIds = Array.from(
    new Set(messageRows.map((message) => message.reply_to_id).filter((replyToId): replyToId is string => Boolean(replyToId)))
  )
  const replyById = await loadChatReplyRowsByIds(replyIds)
  const userIds = Array.from(
    new Set([
      ...messageRows.map((message) => message.user_id),
      ...Object.values(replyById).map((message) => message.user_id),
    ])
  )
  const profileById = await loadProfilesByUserIds(userIds)

  return messageRows.map((message) => {
    const replyMessage = message.reply_to_id ? replyById[message.reply_to_id] ?? null : null

    return toChatMessageItem(
      message,
      profileById[message.user_id],
      replyMessage,
      replyMessage ? profileById[replyMessage.user_id] : undefined
    )
  })
}
