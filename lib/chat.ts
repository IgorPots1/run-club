import { formatRunDateTimeLabel } from './format'
import { getProfileDisplayName } from './profiles'
import { supabase } from './supabase'

export const CHAT_MESSAGE_MAX_LENGTH = 500
export const CHAT_MEDIA_BUCKET = 'chat-media'

type ChatMessageRow = {
  id: string
  user_id: string
  text: string
  image_url: string | null
  created_at: string
  is_deleted: boolean
  reply_to_id: string | null
  thread_id?: string | null
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
  imageUrl: string | null
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

function toChatUnavailableReplyPreview(replyToId: string, displayName: string) {
  return {
    id: replyToId,
    userId: null,
    displayName,
    text: '',
  }
}

function toChatReplyPreview(replyToId: string, message: ChatMessageRow | null | undefined, profile?: ProfileRow) {
  if (!message) {
    return toChatUnavailableReplyPreview(replyToId, 'Сообщение недоступно')
  }

  if (message.is_deleted) {
    return toChatUnavailableReplyPreview(replyToId, 'Сообщение удалено')
  }

  return {
    id: message.id,
    userId: message.user_id,
    displayName: getProfileDisplayName(profile, 'Бегун'),
    text: message.text.trim() || (message.image_url ? 'Фото' : ''),
  }
}

function normalizeChatMessageRow(message: ChatMessageRow): ChatMessageRow {
  return {
    ...message,
    image_url: message.image_url ?? null,
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
    imageUrl: message.image_url ?? null,
    createdAt: message.created_at,
    createdAtLabel: formatRunDateTimeLabel(message.created_at),
    isDeleted: message.is_deleted,
    displayName: getProfileDisplayName(profile, 'Бегун'),
    avatarUrl: profile?.avatar_url ?? null,
    replyToId: message.reply_to_id,
    replyTo: message.reply_to_id
      ? toChatReplyPreview(message.reply_to_id, replyToMessage, replyToProfile)
      : null,
  }
}

async function loadChatReplyRowsByIds(replyIds: string[], threadId?: string | null) {
  if (replyIds.length === 0) {
    return {}
  }

  const replyMessagesQuery = supabase
    .from('chat_messages')
    .select('id, user_id, text, image_url, created_at, is_deleted, reply_to_id, thread_id')
    .in('id', replyIds)

  if (threadId) {
    replyMessagesQuery.eq('thread_id', threadId)
  }

  const { data: replyMessages, error: replyMessagesError } = await replyMessagesQuery

  if (replyMessagesError) {
    throw replyMessagesError
  }

  return Object.fromEntries(
    ((replyMessages as ChatMessageRow[] | null) ?? []).map((message) => {
      const normalizedMessage = normalizeChatMessageRow(message)
      return [normalizedMessage.id, normalizedMessage]
    })
  ) as Record<string, ChatMessageRow>
}

export async function createChatMessage(
  userId: string,
  text: string,
  replyToId?: string | null,
  threadId?: string | null,
  imageUrl?: string | null
) {
  const trimmedText = text.trim()

  if (!trimmedText && !imageUrl) {
    throw new Error('empty_message')
  }

  if (trimmedText.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw new Error('message_too_long')
  }

  return supabase.from('chat_messages').insert({
    user_id: userId,
    text: trimmedText,
    image_url: imageUrl ?? null,
    reply_to_id: replyToId ?? null,
    thread_id: threadId ?? null,
  })
}

export async function uploadChatImage(userId: string, file: File, threadId?: string | null) {
  const fileExtension = file.name.includes('.')
    ? file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    : 'jpg'
  const safeExtension = fileExtension.replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${userId}/${threadId ?? 'club'}/chat-${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExtension}`
  const { error: uploadError } = await supabase.storage.from(CHAT_MEDIA_BUCKET).upload(path, file, {
    contentType: file.type || `image/${safeExtension}`,
  })

  if (uploadError) {
    console.error('Failed to upload chat image', {
      message: uploadError.message,
      status: 'status' in uploadError ? uploadError.status : undefined,
      bucket: CHAT_MEDIA_BUCKET,
      path,
    })
    throw uploadError
  }

  const { data } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path)
  return data.publicUrl
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

export async function softDeleteChatMessage(messageId: string, userId: string, threadId?: string | null) {
  const deleteQuery = supabase
    .from('chat_messages')
    .update({
      is_deleted: true,
    })
    .eq('id', messageId)
    .eq('user_id', userId)

  if (threadId) {
    deleteQuery.eq('thread_id', threadId)
  }

  return deleteQuery
}

export async function loadChatMessageItem(messageId: string, threadId?: string | null): Promise<ChatMessageItem | null> {
  const messageQuery = supabase
    .from('chat_messages')
    .select('id, user_id, text, image_url, created_at, is_deleted, reply_to_id, thread_id')
    .eq('id', messageId)

  if (threadId) {
    messageQuery.eq('thread_id', threadId)
  }

  const { data: message, error: messageError } = await messageQuery.maybeSingle()

  if (messageError) {
    throw messageError
  }

  const messageRow = message ? normalizeChatMessageRow(message as ChatMessageRow) : null

  if (!messageRow || messageRow.is_deleted) {
    return null
  }

  const replyById = await loadChatReplyRowsByIds(
    messageRow.reply_to_id ? [messageRow.reply_to_id] : [],
    threadId
  )
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

export async function loadChatMessageById(messageId: string, threadId?: string | null): Promise<ChatMessageItem | null> {
  return loadChatMessageItem(messageId, threadId)
}

export async function loadRecentChatMessages(limit = 50, threadId?: string | null): Promise<ChatMessageItem[]> {
  const messagesQuery = supabase
    .from('chat_messages')
    .select('id, user_id, text, image_url, created_at, is_deleted, reply_to_id, thread_id')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (threadId) {
    messagesQuery.eq('thread_id', threadId)
  }

  const { data: messages, error: messagesError } = await messagesQuery

  if (messagesError) {
    throw messagesError
  }

  const messageRows = ((messages as ChatMessageRow[] | null) ?? [])
    .map(normalizeChatMessageRow)
    .slice()
    .reverse()
  const replyIds = Array.from(
    new Set(messageRows.map((message) => message.reply_to_id).filter((replyToId): replyToId is string => Boolean(replyToId)))
  )
  const replyById = await loadChatReplyRowsByIds(replyIds, threadId)
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

export async function loadOlderChatMessages(
  beforeCreatedAt: string,
  limit = 10,
  threadId?: string | null
): Promise<ChatMessageItem[]> {
  const messagesQuery = supabase
    .from('chat_messages')
    .select('id, user_id, text, image_url, created_at, is_deleted, reply_to_id, thread_id')
    .eq('is_deleted', false)
    .lt('created_at', beforeCreatedAt)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (threadId) {
    messagesQuery.eq('thread_id', threadId)
  }

  const { data: messages, error: messagesError } = await messagesQuery

  if (messagesError) {
    throw messagesError
  }

  const messageRows = ((messages as ChatMessageRow[] | null) ?? [])
    .map(normalizeChatMessageRow)
    .slice()
    .reverse()
  const replyIds = Array.from(
    new Set(messageRows.map((message) => message.reply_to_id).filter((replyToId): replyToId is string => Boolean(replyToId)))
  )
  const replyById = await loadChatReplyRowsByIds(replyIds, threadId)
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
