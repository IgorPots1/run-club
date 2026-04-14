import { formatRunDateTimeLabel } from './format'
import { getProfileDisplayName } from './profiles'
import { supabase } from './supabase'
import {
  createChatSendDebugError,
  logChatSendDebug,
  logChatSendDebugError,
} from './chatSendDebug'
import { markChatSendTimingPhase } from './chatSendTiming'

export const CHAT_MESSAGE_MAX_LENGTH = 1000
export const CHAT_MESSAGE_MAX_ATTACHMENTS = 8
export const CHAT_MEDIA_BUCKET = 'chat-media'

export type ChatMessageType = 'text' | 'image' | 'voice'
export type ChatMessageAttachmentType = 'image'

export type ChatMessageAttachment = {
  id: string
  type: ChatMessageAttachmentType
  storagePath: string | null
  publicUrl: string
  width: number | null
  height: number | null
  sortOrder: number
}

export type ChatMessageMentionSpan = {
  userId: string
  start: number
  length: number
}

export type ChatComposerImageUpload = {
  storagePath: string
  publicUrl: string
  width: number | null
  height: number | null
}

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
  mention_spans?: unknown
}

type ChatMessageReactionRow = {
  message_id: string
  user_id: string
  emoji: string
}

type ChatMessageAttachmentRow = {
  id: string
  message_id: string
  attachment_type: ChatMessageAttachmentType
  storage_path: string
  public_url: string
  width: number | null
  height: number | null
  sort_order: number
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
  mentionSpans: ChatMessageMentionSpan[] | null
  messageType: ChatMessageType
  imageUrl: string | null
  attachments: ChatMessageAttachment[]
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
  optimisticRenderKey?: string | null
  isOptimistic?: boolean
  optimisticStatus?: 'sending' | 'failed'
  optimisticServerMessageId?: string | null
  optimisticLocalObjectUrl?: string | null
  optimisticImageFiles?: Array<File | null> | null
  optimisticAttachmentUploadState?: 'uploading' | 'uploaded' | 'failed' | null
  optimisticAttachmentStates?: Array<'pending' | 'uploading' | 'uploaded' | 'attached' | 'failed'> | null
}

const RECENT_CHAT_MESSAGES_PREFETCH_TTL_MS = 15000
const RECENT_CHAT_MESSAGES_CACHE_TTL_MS = 30000

type RecentChatMessagesPrefetchEntry = {
  promise: Promise<ChatMessageItem[]>
  data: ChatMessageItem[] | null
  expiresAt: number
}

type RecentChatMessagesCacheEntry = {
  messages: ChatMessageItem[]
  hasMoreOlderMessages: boolean
  expiresAt: number
}

const recentChatMessagesPrefetchByKey = new Map<string, RecentChatMessagesPrefetchEntry>()
const recentChatMessagesCacheByThreadId = new Map<string, RecentChatMessagesCacheEntry>()

function getRecentChatMessagesPrefetchKey(limit: number, threadId?: string | null) {
  return `${threadId ?? 'all'}:${limit}`
}

function isRecentChatMessagesPrefetchEntryExpired(entry: RecentChatMessagesPrefetchEntry) {
  return Date.now() >= entry.expiresAt
}

function isRecentChatMessagesCacheEntryExpired(entry: RecentChatMessagesCacheEntry) {
  return Date.now() >= entry.expiresAt
}

function getRecentChatMessagesPrefetchEntry(limit: number, threadId?: string | null) {
  const key = getRecentChatMessagesPrefetchKey(limit, threadId)
  const entry = recentChatMessagesPrefetchByKey.get(key)

  if (!entry) {
    return null
  }

  if (isRecentChatMessagesPrefetchEntryExpired(entry)) {
    recentChatMessagesPrefetchByKey.delete(key)
    return null
  }

  return entry
}

export function getCachedRecentChatMessages(threadId?: string | null) {
  if (!threadId) {
    return null
  }

  const entry = recentChatMessagesCacheByThreadId.get(threadId)

  if (!entry) {
    return null
  }

  if (isRecentChatMessagesCacheEntryExpired(entry)) {
    recentChatMessagesCacheByThreadId.delete(threadId)
    return null
  }

  return entry
}

export function setCachedRecentChatMessages(
  threadId: string | null | undefined,
  messages: ChatMessageItem[],
  options?: { hasMoreOlderMessages?: boolean }
) {
  if (!threadId) {
    return
  }

  const currentEntry = getCachedRecentChatMessages(threadId)

  recentChatMessagesCacheByThreadId.set(threadId, {
    messages,
    hasMoreOlderMessages: options?.hasMoreOlderMessages ?? currentEntry?.hasMoreOlderMessages ?? true,
    expiresAt: Date.now() + RECENT_CHAT_MESSAGES_CACHE_TTL_MS,
  })
}

async function loadProfilesByUserIds(userIds: string[]) {
  if (userIds.length === 0) {
    return {}
  }

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name, nickname, email, avatar_url')
    .in('id', userIds)
    .eq('app_access_status', 'active')

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseChatMessageMentionSpan(rawValue: unknown, textLength: number): ChatMessageMentionSpan | null {
  if (!isPlainObject(rawValue)) {
    return null
  }

  const userId = typeof rawValue.userId === 'string'
    ? rawValue.userId.trim()
    : typeof rawValue.user_id === 'string'
      ? rawValue.user_id.trim()
      : ''
  const rawStart = rawValue.start
  const rawLength = rawValue.length

  if (
    !userId ||
    typeof rawStart !== 'number' ||
    typeof rawLength !== 'number' ||
    !Number.isInteger(rawStart) ||
    !Number.isInteger(rawLength) ||
    rawStart < 0 ||
    rawLength <= 0 ||
    rawStart + rawLength > textLength
  ) {
    return null
  }

  return {
    userId,
    start: rawStart,
    length: rawLength,
  }
}

function normalizeChatMessageMentionSpans(rawValue: unknown, text: string) {
  const rawMentionSpans = Array.isArray(rawValue) ? rawValue : []
  const mentionSpans: ChatMessageMentionSpan[] = []

  for (const rawMentionSpan of rawMentionSpans) {
    const mentionSpan = parseChatMessageMentionSpan(rawMentionSpan, text.length)

    if (!mentionSpan) {
      return null
    }

    mentionSpans.push(mentionSpan)
  }

  return mentionSpans.sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start
    }

    if (left.length !== right.length) {
      return left.length - right.length
    }

    return left.userId.localeCompare(right.userId)
  })
}

function toChatMessageAttachment(row: ChatMessageAttachmentRow): ChatMessageAttachment {
  return {
    id: row.id,
    type: row.attachment_type,
    storagePath: row.storage_path ?? null,
    publicUrl: row.public_url,
    width: row.width ?? null,
    height: row.height ?? null,
    sortOrder: row.sort_order,
  }
}

function normalizeChatMessageAttachments(
  message: Pick<ChatMessageRow, 'id' | 'message_type' | 'image_url' | 'media_url'>,
  attachmentRows: ChatMessageAttachmentRow[] = []
) {
  const normalizedRows = attachmentRows
    .slice()
    .sort((left, right) => {
      if (left.sort_order === right.sort_order) {
        return left.id.localeCompare(right.id)
      }

      return left.sort_order - right.sort_order
    })
    .map(toChatMessageAttachment)

  if (normalizedRows.length > 0) {
    return normalizedRows
  }

  const legacyImageUrl = resolveChatMessageImageUrl(message)

  if (!legacyImageUrl) {
    return []
  }

  return [{
    id: `legacy-${message.id}`,
    type: 'image' as const,
    storagePath: null,
    publicUrl: legacyImageUrl,
    width: null,
    height: null,
    sortOrder: 0,
  }]
}

function getPrimaryAttachmentImageUrl(attachments: ChatMessageAttachment[]) {
  return attachments[0]?.publicUrl ?? null
}

function getChatMessagePreviewText(
  message: Pick<ChatMessageRow, 'text' | 'message_type' | 'image_url' | 'media_url'>,
  attachmentCount = 0
) {
  const trimmedText = message.text?.trim() ?? ''

  if (trimmedText) {
    return trimmedText
  }

  const messageType = resolveChatMessageType(message)

  if (messageType === 'voice') {
    return 'Голосовое сообщение'
  }

  if (messageType === 'image') {
    return attachmentCount > 1 ? `${attachmentCount} фото` : 'Фото'
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
    mention_spans: message.mention_spans ?? null,
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
  profileById: Record<string, ProfileRow> = {},
  attachmentRows: ChatMessageAttachmentRow[] = []
): ChatMessageItem {
  const messageType = resolveChatMessageType(message)
  const attachments = normalizeChatMessageAttachments(message, attachmentRows)
  const mentionSpans = normalizeChatMessageMentionSpans(message.mention_spans, message.text ?? '')

  return {
    id: message.id,
    userId: message.user_id,
    text: message.text ?? '',
    mentionSpans: mentionSpans && mentionSpans.length > 0 ? mentionSpans : null,
    messageType,
    imageUrl: getPrimaryAttachmentImageUrl(attachments),
    attachments,
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
    previewText: getChatMessagePreviewText(message, attachments.length),
  }
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

async function loadChatAttachmentsByMessageIds(messageIds: string[]) {
  if (messageIds.length === 0) {
    return {}
  }

  const { data: attachments, error: attachmentsError } = await supabase
    .from('chat_message_attachments')
    .select('id, message_id, attachment_type, storage_path, public_url, width, height, sort_order')
    .in('message_id', messageIds)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (attachmentsError) {
    throw attachmentsError
  }

  const attachmentsByMessageId: Record<string, ChatMessageAttachmentRow[]> = {}

  for (const row of (attachments as ChatMessageAttachmentRow[] | null) ?? []) {
    if (!attachmentsByMessageId[row.message_id]) {
      attachmentsByMessageId[row.message_id] = []
    }

    attachmentsByMessageId[row.message_id]!.push(row)
  }

  return attachmentsByMessageId
}

async function loadChatReplyRowsByIds(replyIds: string[], threadId?: string | null) {
  if (replyIds.length === 0) {
    return {}
  }

  const replyMessagesQuery = supabase
    .from('chat_messages')
    .select('id, user_id, text, message_type, image_url, media_url, media_duration_seconds, edited_at, created_at, is_deleted, reply_to_id, thread_id, mention_spans')
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

type CreateChatMessageApiResult = {
  error: Error | null
  messageId?: string | null
}

type CreateTextChatMessageApiPayload = {
  kind?: 'text'
  text?: string
  imageUrl?: string | null
  mentionSpans?: {
    userId: string
    start: number
    length: number
  }[] | null
  pendingAttachmentCount?: number | null
  attachments?: {
    type: ChatMessageAttachmentType
    storagePath: string
    width?: number | null
    height?: number | null
  }[]
  replyToId?: string | null
  threadId?: string | null
}

type AttachChatMessageImageApiPayload = {
  type: 'image'
  threadId?: string | null
  storagePath: string
  width?: number | null
  height?: number | null
  sortOrder: number
}

type CreateVoiceChatMessageApiPayload = {
  kind: 'voice'
  mediaPath?: string
  mediaDurationSeconds?: number | null
  replyToId?: string | null
  threadId?: string | null
}

function getApiPayloadAttachmentKinds(
  payload: CreateTextChatMessageApiPayload | CreateVoiceChatMessageApiPayload
) {
  if (payload.kind === 'voice') {
    return ['voice']
  }

  return Array.isArray(payload.attachments) && payload.attachments.length > 0 ? ['image'] : []
}

function getApiPayloadAttachmentCount(
  payload: CreateTextChatMessageApiPayload | CreateVoiceChatMessageApiPayload
) {
  if (payload.kind === 'voice') {
    return 0
  }

  return Array.isArray(payload.attachments) && payload.attachments.length > 0
    ? payload.attachments.length
    : Math.max(0, Math.round(payload.pendingAttachmentCount ?? 0))
}

function getApiPayloadTextLength(
  payload: CreateTextChatMessageApiPayload | CreateVoiceChatMessageApiPayload
) {
  return payload.kind === 'voice' ? 0 : payload.text?.trim().length ?? 0
}

function parseJsonResponse<T>(rawText: string): T | null {
  if (!rawText.trim()) {
    return null
  }

  return JSON.parse(rawText) as T
}

async function createChatMessageViaApi(
  payload: CreateTextChatMessageApiPayload | CreateVoiceChatMessageApiPayload,
  optimisticMessageId?: string | null
): Promise<CreateChatMessageApiResult> {
  const requestStartedAt = Date.now()
  const requestMeta = {
    kind: payload.kind ?? 'text',
    threadId: payload.threadId ?? null,
    textLength: getApiPayloadTextLength(payload),
    attachmentCount: getApiPayloadAttachmentCount(payload),
    attachmentKinds: getApiPayloadAttachmentKinds(payload),
    pendingAttachmentCount:
      payload.kind === 'voice'
        ? 0
        : Math.max(0, Math.round(payload.pendingAttachmentCount ?? 0)),
  }

  try {
    logChatSendDebug('request_start', requestMeta)
    markChatSendTimingPhase('request_start', { optimisticMessageId: optimisticMessageId ?? undefined })

    const response = await fetch('/api/chat/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const rawText = await response.text()
    logChatSendDebug('response_status', {
      ...requestMeta,
      status: response.status,
      ok: response.ok,
      elapsedMs: Date.now() - requestStartedAt,
    })
    markChatSendTimingPhase('response_status', { optimisticMessageId: optimisticMessageId ?? undefined })

    let result:
      | {
          error?: string
          ok?: boolean
          messageId?: string
          message?: {
            id?: string
          } | null
        }
      | null = null

    try {
      result = parseJsonResponse(rawText)
    } catch (error) {
      logChatSendDebugError('response_parse_failed', {
        ...requestMeta,
        status: response.status,
        ok: response.ok,
        rawText,
        parseError: error instanceof Error ? error.message : 'invalid_json',
      })

      return {
        error: createChatSendDebugError('invalid_json', 'chat_message_invalid_json', {
          ...requestMeta,
          status: response.status,
          rawText,
        }),
        messageId: null,
      }
    }

    logChatSendDebug('parsed_response', {
      ...requestMeta,
      status: response.status,
      ok: response.ok,
      result,
    })
    markChatSendTimingPhase('parsed_response', { optimisticMessageId: optimisticMessageId ?? undefined })

    const responseMessageId = typeof result?.messageId === 'string'
      ? result.messageId
      : typeof result?.message?.id === 'string'
        ? result.message.id
        : null

    if (!response.ok) {
      logChatSendDebugError('response_error_body', {
        ...requestMeta,
        status: response.status,
        result,
        rawText,
      })

      return {
        error: createChatSendDebugError('non_200_response', result?.error ?? 'chat_message_create_failed', {
          ...requestMeta,
          status: response.status,
          result,
          rawText,
        }),
        messageId: null,
      }
    }

    if (result?.ok === false) {
      return {
        error: createChatSendDebugError('api_error', result.error ?? 'chat_message_create_failed', {
          ...requestMeta,
          status: response.status,
          result,
        }),
        messageId: responseMessageId,
      }
    }

    if (!responseMessageId) {
      return {
        error: createChatSendDebugError('api_error', 'chat_message_id_missing', {
          ...requestMeta,
          status: response.status,
          result,
        }),
        messageId: null,
      }
    }

    return {
      error: null,
      messageId: responseMessageId,
    }
  } catch (error) {
    logChatSendDebugError('request_failed', {
      ...requestMeta,
      error,
      elapsedMs: Date.now() - requestStartedAt,
    })

    return {
      error: error instanceof Error
        ? createChatSendDebugError('network_error', error.message, {
            ...requestMeta,
            originalError: error,
          })
        : createChatSendDebugError('network_error', 'chat_message_create_failed', {
            ...requestMeta,
            rawError: error,
          }),
      messageId: null,
    }
  }
}

export async function createChatMessage(
  userId: string,
  text: string,
  replyToId?: string | null,
  threadId?: string | null,
  attachments: ChatComposerImageUpload[] = [],
  imageUrl?: string | null,
  options?: {
    pendingAttachmentCount?: number | null
    optimisticMessageId?: string | null
    mentionSpans?: {
      userId: string
      start: number
      length: number
    }[] | null
  }
) {
  const trimmedText = text.trim()
  const normalizedAttachments = attachments
    .slice(0, CHAT_MESSAGE_MAX_ATTACHMENTS)
    .map((attachment) => ({
      type: 'image' as const,
      storagePath: attachment.storagePath,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
    }))
  const pendingAttachmentCount = Math.max(0, Math.round(options?.pendingAttachmentCount ?? 0))

  logChatSendDebug('validation_check', {
    hasText: Boolean(trimmedText),
    attachmentCount: normalizedAttachments.length > 0
      ? normalizedAttachments.length
      : imageUrl
        ? 1
        : pendingAttachmentCount,
  })

  if (!trimmedText && normalizedAttachments.length === 0 && !imageUrl && pendingAttachmentCount === 0) {
    throw new Error('empty_message')
  }

  if (trimmedText.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw new Error('message_too_long')
  }

  return createChatMessageViaApi(
    {
      kind: 'text',
      text: trimmedText,
      imageUrl: imageUrl ?? null,
      mentionSpans: options?.mentionSpans ?? null,
      pendingAttachmentCount: pendingAttachmentCount || null,
      attachments: normalizedAttachments,
      replyToId: replyToId ?? null,
      threadId: threadId ?? null,
    },
    options?.optimisticMessageId ?? null
  )
}

export async function attachImageToChatMessage(
  messageId: string,
  payload: AttachChatMessageImageApiPayload
): Promise<{ error: Error | null; publicUrl?: string | null }> {
  const requestStartedAt = Date.now()
  const requestMeta = {
    messageId,
    threadId: payload.threadId ?? null,
    sortOrder: payload.sortOrder,
    attachmentType: payload.type,
    storagePath: payload.storagePath,
  }

  try {
    logChatSendDebug('attachment_request_start', requestMeta)

    const response = await fetch(`/api/chat/messages/${messageId}/attachments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const rawText = await response.text()
    logChatSendDebug('attachment_response_status', {
      ...requestMeta,
      status: response.status,
      ok: response.ok,
      elapsedMs: Date.now() - requestStartedAt,
    })

    let result:
      | {
          error?: string
          ok?: boolean
          publicUrl?: string | null
        }
      | null = null

    try {
      result = parseJsonResponse(rawText)
    } catch (error) {
      logChatSendDebugError('attachment_response_parse_failed', {
        ...requestMeta,
        status: response.status,
        ok: response.ok,
        rawText,
        parseError: error instanceof Error ? error.message : 'invalid_json',
      })

      return {
        error: createChatSendDebugError('invalid_json', 'chat_message_attachment_invalid_json', {
          ...requestMeta,
          status: response.status,
          rawText,
        }),
      }
    }

    logChatSendDebug('attachment_parsed_response', {
      ...requestMeta,
      status: response.status,
      ok: response.ok,
      result,
    })

    if (!response.ok) {
      logChatSendDebugError('attachment_response_error_body', {
        ...requestMeta,
        status: response.status,
        result,
        rawText,
      })

      return {
        error: createChatSendDebugError('non_200_response', result?.error ?? 'chat_message_attachment_failed', {
          ...requestMeta,
          status: response.status,
          result,
          rawText,
        }),
      }
    }

    if (result?.ok === false) {
      return {
        error: createChatSendDebugError('api_error', result.error ?? 'chat_message_attachment_failed', {
          ...requestMeta,
          status: response.status,
          result,
        }),
      }
    }

    return {
      error: null,
      publicUrl: typeof result?.publicUrl === 'string' ? result.publicUrl : null,
    }
  } catch (error) {
    logChatSendDebugError('attachment_request_failed', {
      ...requestMeta,
      error,
      elapsedMs: Date.now() - requestStartedAt,
    })

    return {
      error: error instanceof Error
        ? createChatSendDebugError('network_error', error.message, {
            ...requestMeta,
            originalError: error,
          })
        : createChatSendDebugError('network_error', 'chat_message_attachment_failed', {
            ...requestMeta,
            rawError: error,
          }),
    }
  }
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

  return createChatMessageViaApi({
    kind: 'voice',
    mediaPath: trimmedMediaPath,
    mediaDurationSeconds: mediaDurationSeconds ?? null,
    replyToId: replyToId ?? null,
    threadId: threadId ?? null,
  })
}

export async function updateChatMessage(
  messageId: string,
  userId: string,
  text: string,
  threadId?: string | null,
  options?: {
    allowManagedThreadMessage?: boolean
  }
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

  if (threadId) {
    updateQuery.eq('thread_id', threadId)
  }

  if (!options?.allowManagedThreadMessage) {
    updateQuery.eq('user_id', userId)
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

async function getImageFileDimensions(file: File): Promise<{ width: number | null; height: number | null }> {
  const objectUrl = URL.createObjectURL(file)

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new window.Image()
      nextImage.onload = () => resolve(nextImage)
      nextImage.onerror = () => reject(new Error('chat_image_dimensions_unavailable'))
      nextImage.src = objectUrl
    })

    const width = Number.isFinite(image.naturalWidth) && image.naturalWidth > 0 ? image.naturalWidth : null
    const height = Number.isFinite(image.naturalHeight) && image.naturalHeight > 0 ? image.naturalHeight : null

    return { width, height }
  } catch {
    return { width: null, height: null }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function uploadChatImage(userId: string, file: File, threadId?: string | null) {
  const fileExtension = file.name.includes('.')
    ? file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    : 'jpg'
  const safeExtension = fileExtension.replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${userId}/${threadId ?? 'club'}/${createRandomUploadUuid()}.${safeExtension}`
  const dimensions = await getImageFileDimensions(file)
  logChatSendDebug('attachment_upload_start', {
    userId,
    threadId: threadId ?? null,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    storagePath: path,
  })
  const { error: uploadError } = await supabase.storage.from(CHAT_MEDIA_BUCKET).upload(path, file, {
    contentType: file.type || `image/${safeExtension}`,
  })

  if (uploadError) {
    logChatSendDebugError('attachment_upload_failed', {
      userId,
      threadId: threadId ?? null,
      fileName: file.name,
      storagePath: path,
      error: uploadError.message,
    })
    console.error('Failed to upload chat image', {
      message: uploadError.message,
      status: 'status' in uploadError ? uploadError.status : undefined,
      bucket: CHAT_MEDIA_BUCKET,
      path,
    })
    throw uploadError
  }

  const { data } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path)
  logChatSendDebug('attachment_upload_success', {
    userId,
    threadId: threadId ?? null,
    fileName: file.name,
    storagePath: path,
    publicUrl: data.publicUrl,
    width: dimensions.width,
    height: dimensions.height,
  })
  return {
    storagePath: path,
    publicUrl: data.publicUrl,
    width: dimensions.width,
    height: dimensions.height,
  } satisfies ChatComposerImageUpload
}

export async function deleteUploadedChatImage(storagePath: string) {
  const trimmedPath = storagePath.trim()

  if (!trimmedPath) {
    return
  }

  const { error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).remove([trimmedPath])

  if (error) {
    throw error
  }
}

export async function softDeleteChatMessage(
  messageId: string,
  userId: string,
  threadId?: string | null,
  options?: {
    allowManagedThreadMessage?: boolean
  }
) {
  const deleteQuery = supabase
    .from('chat_messages')
    .update({
      is_deleted: true,
    })
    .eq('id', messageId)

  if (threadId) {
    deleteQuery.eq('thread_id', threadId)
  }

  if (!options?.allowManagedThreadMessage) {
    deleteQuery.eq('user_id', userId)
  }

  return deleteQuery
}

export async function loadChatMessageItem(messageId: string, threadId?: string | null): Promise<ChatMessageItem | null> {
  const messageQuery = supabase
    .from('chat_messages')
    .select('id, user_id, text, message_type, image_url, media_url, media_duration_seconds, edited_at, created_at, is_deleted, reply_to_id, thread_id, mention_spans')
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
  const [reactionsByMessageId, attachmentsByMessageId] = await Promise.all([
    loadChatReactionsByMessageIds([messageRow.id]),
    loadChatAttachmentsByMessageIds([messageRow.id]),
  ])
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
    profileById,
    attachmentsByMessageId[messageRow.id] ?? []
  )
}

export async function loadChatMessageById(messageId: string, threadId?: string | null): Promise<ChatMessageItem | null> {
  return loadChatMessageItem(messageId, threadId)
}

async function fetchRecentChatMessages(limit = 50, threadId?: string | null): Promise<ChatMessageItem[]> {
  const messagesQuery = supabase
    .from('chat_messages')
    .select('id, user_id, text, message_type, image_url, media_url, media_duration_seconds, edited_at, created_at, is_deleted, reply_to_id, thread_id, mention_spans')
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
  const [replyById, reactionsByMessageId, attachmentsByMessageId] = await Promise.all([
    loadChatReplyRowsByIds(replyIds, threadId),
    loadChatReactionsByMessageIds(messageIds),
    loadChatAttachmentsByMessageIds(messageIds),
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
      profileById,
      attachmentsByMessageId[message.id] ?? []
    )
  })
}

export function getPrefetchedRecentChatMessages(limit = 50, threadId?: string | null): Promise<ChatMessageItem[]> | null {
  const entry = getRecentChatMessagesPrefetchEntry(limit, threadId)

  if (!entry) {
    return null
  }

  if (entry.data) {
    return Promise.resolve(entry.data)
  }

  return entry.promise
}

export function prefetchRecentChatMessages(limit = 50, threadId?: string | null): Promise<ChatMessageItem[]> {
  const cachedThreadMessages = getCachedRecentChatMessages(threadId)

  if (cachedThreadMessages) {
    return Promise.resolve(cachedThreadMessages.messages)
  }

  const existingEntry = getRecentChatMessagesPrefetchEntry(limit, threadId)

  if (existingEntry) {
    return existingEntry.data ? Promise.resolve(existingEntry.data) : existingEntry.promise
  }

  const key = getRecentChatMessagesPrefetchKey(limit, threadId)
  const nextEntry: RecentChatMessagesPrefetchEntry = {
    promise: fetchRecentChatMessages(limit, threadId),
    data: null,
    expiresAt: Date.now() + RECENT_CHAT_MESSAGES_PREFETCH_TTL_MS,
  }

  recentChatMessagesPrefetchByKey.set(key, nextEntry)

  nextEntry.promise
    .then((messages) => {
      const currentEntry = recentChatMessagesPrefetchByKey.get(key)

      if (currentEntry !== nextEntry) {
        return
      }

      nextEntry.data = messages
      nextEntry.expiresAt = Date.now() + RECENT_CHAT_MESSAGES_PREFETCH_TTL_MS
      setCachedRecentChatMessages(threadId, messages, {
        hasMoreOlderMessages: messages.length === limit,
      })
    })
    .catch(() => {
      if (recentChatMessagesPrefetchByKey.get(key) === nextEntry) {
        recentChatMessagesPrefetchByKey.delete(key)
      }
    })

  return nextEntry.promise
}

export async function loadRecentChatMessages(limit = 50, threadId?: string | null): Promise<ChatMessageItem[]> {
  return fetchRecentChatMessages(limit, threadId)
}

export async function loadOlderChatMessages(
  beforeCreatedAt: string,
  beforeId: string,
  limit = 10,
  threadId?: string | null
): Promise<ChatMessageItem[]> {
  const messagesQuery = supabase
    .from('chat_messages')
    .select('id, user_id, text, message_type, image_url, media_url, media_duration_seconds, edited_at, created_at, is_deleted, reply_to_id, thread_id, mention_spans')
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
  const messageIds = messageRows.map((message) => message.id)
  const [replyById, reactionsByMessageId, attachmentsByMessageId] = await Promise.all([
    loadChatReplyRowsByIds(replyIds, threadId),
    loadChatReactionsByMessageIds(messageIds),
    loadChatAttachmentsByMessageIds(messageIds),
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
      profileById,
      attachmentsByMessageId[message.id] ?? []
    )
  })
}
