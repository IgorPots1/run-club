import { formatRunDateTimeLabel } from './format'
import { getProfileDisplayName } from './profiles'
import { supabase } from './supabase'

export const CHAT_MESSAGE_MAX_LENGTH = 500
export const CHAT_MEDIA_BUCKET = 'chat-media'

export type ChatMessageType = 'text' | 'image' | 'voice'

type ChatMessageRow = {
  id: string
  user_id: string
  text: string | null
  message_type: string | null
  image_url: string | null
  media_url: string | null
  media_duration_seconds: number | null
  edited_at: string | null
  created_at: string
  is_deleted: boolean
  reply_to_id: string | null
  thread_id?: string | null
}

type ChatMessageReactionRow = {
  message_id: string
  user_id: string
  emoji: string
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
  messageType: ChatMessageType
  imageUrl: string | null
  mediaUrl: string | null
  mediaDurationSeconds: number | null
  editedAt: string | null
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
  reactions: {
    emoji: string
    count: number
    userIds: string[]
    reactors: {
      userId: string
      displayName: string
      avatarUrl: string | null
    }[]
  }[]
  previewText: string
  isOptimistic?: boolean
  optimisticLocalObjectUrl?: string | null
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
    text: getChatMessagePreviewText(message),
  }
}

function resolveChatMessageType(message: Pick<ChatMessageRow, 'message_type' | 'image_url'>): ChatMessageType {
  if (message.message_type === 'voice') {
    return 'voice'
  }

  if (message.message_type === 'image' || message.image_url) {
    return 'image'
  }

  return 'text'
}

function resolveChatMessageImageUrl(message: Pick<ChatMessageRow, 'message_type' | 'image_url' | 'media_url'>) {
  if (message.image_url) {
    return message.image_url
  }

  return resolveChatMessageType(message) === 'image' ? message.media_url ?? null : null
}

function getChatMessagePreviewText(message: Pick<ChatMessageRow, 'text' | 'message_type' | 'image_url' | 'media_url'>) {
  const trimmedText = message.text?.trim() ?? ''

  if (trimmedText) {
    return trimmedText
  }

  const messageType = resolveChatMessageType(message)

  if (messageType === 'voice') {
    return 'Голосовое сообщение'
  }

  if (messageType === 'image') {
    return 'Фото'
  }

  return ''
}

function normalizeChatMessageRow(message: ChatMessageRow): ChatMessageRow {
  return {
    ...message,
    text: message.text ?? null,
    message_type: message.message_type ?? null,
    image_url: message.image_url ?? null,
    media_url: message.media_url ?? null,
    media_duration_seconds: message.media_duration_seconds ?? null,
    edited_at: message.edited_at ?? null,
  }
}

function sortChatReactions(reactions: { emoji: string; count: number; userIds: string[] }[]) {
  const emojiOrder = ['👍', '❤️', '🔥', '😂', '👏', '😢', '😮']

  return reactions.slice().sort((left, right) => {
    const leftOrder = emojiOrder.indexOf(left.emoji)
    const rightOrder = emojiOrder.indexOf(right.emoji)

    if (leftOrder !== -1 || rightOrder !== -1) {
      if (leftOrder === -1) return 1
      if (rightOrder === -1) return -1
      return leftOrder - rightOrder
    }

    return left.emoji.localeCompare(right.emoji)
  })
}

function buildReactionsByMessageId(rows: ChatMessageReactionRow[]) {
  const reactionsByMessageId: Record<string, Record<string, Set<string>>> = {}

  rows.forEach((row) => {
    if (!reactionsByMessageId[row.message_id]) {
      reactionsByMessageId[row.message_id] = {}
    }

    if (!reactionsByMessageId[row.message_id]?.[row.emoji]) {
      reactionsByMessageId[row.message_id]![row.emoji] = new Set()
    }

    reactionsByMessageId[row.message_id]![row.emoji]!.add(row.user_id)
  })

  return Object.fromEntries(
    Object.entries(reactionsByMessageId).map(([messageId, emojiMap]) => [
      messageId,
      sortChatReactions(
        Object.entries(emojiMap).map(([emoji, userIds]) => ({
          emoji,
          count: userIds.size,
          userIds: Array.from(userIds),
        }))
      ),
    ])
  ) as Record<string, { emoji: string; count: number; userIds: string[] }[]>
}

function toChatMessageItem(
  message: ChatMessageRow,
  profile?: ProfileRow,
  replyToMessage?: ChatMessageRow | null,
  replyToProfile?: ProfileRow,
  reactions: { emoji: string; count: number; userIds: string[] }[] = [],
  profileById: Record<string, ProfileRow> = {}
): ChatMessageItem {
  const messageType = resolveChatMessageType(message)

  return {
    id: message.id,
    userId: message.user_id,
    text: message.text ?? '',
    messageType,
    imageUrl: resolveChatMessageImageUrl(message),
    mediaUrl: message.media_url ?? null,
    mediaDurationSeconds: message.media_duration_seconds ?? null,
    editedAt: message.edited_at ?? null,
    createdAt: message.created_at,
    createdAtLabel: formatRunDateTimeLabel(message.created_at),
    isDeleted: message.is_deleted,
    displayName: getProfileDisplayName(profile, 'Бегун'),
    avatarUrl: profile?.avatar_url ?? null,
    replyToId: message.reply_to_id,
    replyTo: message.reply_to_id
      ? toChatReplyPreview(message.reply_to_id, replyToMessage, replyToProfile)
      : null,
    reactions: reactions.map((reaction) => ({
      ...reaction,
      reactors: reaction.userIds.map((userId) => {
        const reactorProfile = profileById[userId]

        return {
          userId,
          displayName: getProfileDisplayName(reactorProfile, 'Бегун'),
          avatarUrl: reactorProfile?.avatar_url ?? null,
        }
      }),
    })),
    previewText: getChatMessagePreviewText(message),
  }
}

async function resolveSafeReplyToId(replyToId?: string | null, threadId?: string | null) {
  if (!replyToId) {
    return null
  }

  const { data: originalReplyMessage, error: originalReplyMessageError } = await supabase
    .from('chat_messages')
    .select('id, thread_id')
    .eq('id', replyToId)
    .maybeSingle()

  if (originalReplyMessageError) {
    throw originalReplyMessageError
  }

  const originalThreadId = ((originalReplyMessage as Pick<ChatMessageRow, 'id' | 'thread_id'> | null) ?? null)?.thread_id ?? null
  const currentThreadId = threadId ?? null

  if (originalThreadId === currentThreadId) {
    return replyToId
  }

  return null
}

async function loadChatReactionsByMessageIds(messageIds: string[]) {
  if (messageIds.length === 0) {
    return {}
  }

  const { data: reactions, error: reactionsError } = await supabase
    .from('chat_message_reactions')
    .select('message_id, user_id, emoji')
    .in('message_id', messageIds)

  if (reactionsError) {
    throw reactionsError
  }

  return buildReactionsByMessageId((reactions as ChatMessageReactionRow[] | null) ?? [])
}

async function loadChatReplyRowsByIds(replyIds: string[], threadId?: string | null) {
  if (replyIds.length === 0) {
    return {}
  }

  const replyMessagesQuery = supabase
    .from('chat_messages')
    .select('id, user_id, text, message_type, image_url, media_url, media_duration_seconds, edited_at, created_at, is_deleted, reply_to_id, thread_id')
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

  const safeReplyToId = await resolveSafeReplyToId(replyToId, threadId)

  return supabase.from('chat_messages').insert({
    user_id: userId,
    text: trimmedText,
    image_url: imageUrl ?? null,
    reply_to_id: safeReplyToId,
    thread_id: threadId ?? null,
  })
}

export async function createVoiceChatMessage(
  userId: string,
  mediaPath: string,
  mediaDurationSeconds?: number | null,
  replyToId?: string | null,
  threadId?: string | null
) {
  const trimmedMediaPath = mediaPath.trim()

  if (!trimmedMediaPath) {
    throw new Error('empty_voice_message')
  }

  const safeReplyToId = await resolveSafeReplyToId(replyToId, threadId)

  return supabase.from('chat_messages').insert({
    user_id: userId,
    text: '',
    message_type: 'voice',
    media_url: trimmedMediaPath,
    media_duration_seconds: mediaDurationSeconds ?? null,
    image_url: null,
    reply_to_id: safeReplyToId,
    thread_id: threadId ?? null,
  })
}

export async function updateChatMessage(
  messageId: string,
  userId: string,
  text: string,
  threadId?: string | null
) {
  const trimmedText = text.trim()

  if (trimmedText.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw new Error('message_too_long')
  }

  const updateQuery = supabase
    .from('chat_messages')
    .update({
      text: trimmedText,
      edited_at: new Date().toISOString(),
    })
    .eq('id', messageId)
    .eq('user_id', userId)

  if (threadId) {
    updateQuery.eq('thread_id', threadId)
  }

  return updateQuery
}

export async function toggleChatMessageReaction(messageId: string, userId: string, emoji: string) {
  const { data: existingReaction, error: existingReactionError } = await supabase
    .from('chat_message_reactions')
    .select('message_id')
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .eq('emoji', emoji)
    .maybeSingle()

  if (existingReactionError) {
    throw existingReactionError
  }

  if (existingReaction) {
    const { error: deleteError } = await supabase
      .from('chat_message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('emoji', emoji)

    if (deleteError) {
      throw deleteError
    }

    return { active: false }
  }

  const { error: insertError } = await supabase.from('chat_message_reactions').insert({
    message_id: messageId,
    user_id: userId,
    emoji,
  })

  if (insertError) {
    throw insertError
  }

  return { active: true }
}

function createRandomUploadUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-')
  }

  throw new Error('secure_random_uuid_unavailable')
}

export async function uploadChatImage(userId: string, file: File, threadId?: string | null) {
  const fileExtension = file.name.includes('.')
    ? file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    : 'jpg'
  const safeExtension = fileExtension.replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${userId}/${threadId ?? 'club'}/${createRandomUploadUuid()}.${safeExtension}`
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
    .select('id, user_id, text, message_type, image_url, media_url, media_duration_seconds, edited_at, created_at, is_deleted, reply_to_id, thread_id')
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
  const reactionsByMessageId = await loadChatReactionsByMessageIds([messageRow.id])
  const profileIds = Array.from(
    new Set([
      messageRow.user_id,
      ...(replyMessage ? [replyMessage.user_id] : []),
      ...(reactionsByMessageId[messageRow.id] ?? []).flatMap((reaction) => reaction.userIds),
    ])
  )
  const profileById = await loadProfilesByUserIds(profileIds)

  return toChatMessageItem(
    messageRow,
    profileById[messageRow.user_id],
    replyMessage,
    replyMessage ? profileById[replyMessage.user_id] : undefined,
    reactionsByMessageId[messageRow.id] ?? [],
    profileById
  )
}

export async function loadChatMessageById(messageId: string, threadId?: string | null): Promise<ChatMessageItem | null> {
  return loadChatMessageItem(messageId, threadId)
}

export async function loadRecentChatMessages(limit = 50, threadId?: string | null): Promise<ChatMessageItem[]> {
  const messagesQuery = supabase
    .from('chat_messages')
    .select('id, user_id, text, message_type, image_url, media_url, media_duration_seconds, edited_at, created_at, is_deleted, reply_to_id, thread_id')
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
  const messageIds = messageRows.map((message) => message.id)
  const [replyById, reactionsByMessageId] = await Promise.all([
    loadChatReplyRowsByIds(replyIds, threadId),
    loadChatReactionsByMessageIds(messageIds),
  ])
  const userIds = Array.from(
    new Set([
      ...messageRows.map((message) => message.user_id),
      ...Object.values(replyById).map((message) => message.user_id),
      ...Object.values(reactionsByMessageId).flatMap((reactions) => reactions.flatMap((reaction) => reaction.userIds)),
    ])
  )
  const profileById = await loadProfilesByUserIds(userIds)

  return messageRows.map((message) => {
    const replyMessage = message.reply_to_id ? replyById[message.reply_to_id] ?? null : null

    return toChatMessageItem(
      message,
      profileById[message.user_id],
      replyMessage,
      replyMessage ? profileById[replyMessage.user_id] : undefined,
      reactionsByMessageId[message.id] ?? [],
      profileById
    )
  })
}

export async function loadOlderChatMessages(
  beforeCreatedAt: string,
  beforeId: string,
  limit = 10,
  threadId?: string | null
): Promise<ChatMessageItem[]> {
  const messagesQuery = supabase
    .from('chat_messages')
    .select('id, user_id, text, message_type, image_url, media_url, media_duration_seconds, edited_at, created_at, is_deleted, reply_to_id, thread_id')
    .eq('is_deleted', false)
    .or(`created_at.lt.${beforeCreatedAt},and(created_at.eq.${beforeCreatedAt},id.lt.${beforeId})`)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
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
  const reactionsByMessageId = await loadChatReactionsByMessageIds(messageRows.map((message) => message.id))
  const userIds = Array.from(
    new Set([
      ...messageRows.map((message) => message.user_id),
      ...Object.values(replyById).map((message) => message.user_id),
      ...Object.values(reactionsByMessageId).flatMap((reactions) => reactions.flatMap((reaction) => reaction.userIds)),
    ])
  )
  const profileById = await loadProfilesByUserIds(userIds)

  return messageRows.map((message) => {
    const replyMessage = message.reply_to_id ? replyById[message.reply_to_id] ?? null : null

    return toChatMessageItem(
      message,
      profileById[message.user_id],
      replyMessage,
      replyMessage ? profileById[replyMessage.user_id] : undefined,
      reactionsByMessageId[message.id] ?? [],
      profileById
    )
  })
}
