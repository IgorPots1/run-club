import type { CommonChannelKey } from '@/lib/chat/commonChannels'
import { getCommonChannelTitle } from '@/lib/chat/commonChannels'
import type { CreateAppEventInput } from '@/lib/events/createAppEvent'
import { normalizeAppEventPriority, normalizeAppEventTargetPath, type AppEventPriority } from '@/lib/events/appEventRouting'

export type ChatEventPreview = {
  title: string
  body: string
}

export type ChatMessageCreatedAppEventPayload = {
  v: number
  threadId: string
  messageId: string
  senderName: string
  messagePreview: string
  targetPath: string
  preview: ChatEventPreview
  priority: AppEventPriority
  threadType: 'club' | 'direct_coach'
}

type ChatPreviewInput = {
  threadType: 'club' | 'direct_coach'
  threadChannelKey: CommonChannelKey | null
  senderName: string
  messagePreview: string
  priority: AppEventPriority
  senderIsCoach: boolean
}

type ChatMessageCreatedAppEventInput = ChatPreviewInput & {
  actorUserId: string
  recipientUserId: string
  messageId: string
  threadId: string
}

function getClubImportantTitle(channelKey: CommonChannelKey | null) {
  const channelTitle = getCommonChannelTitle(channelKey) ?? 'Клуб'

  return channelTitle === 'Важная информация' ? channelTitle : `Важно: ${channelTitle}`
}

export function buildChatMessageEventTargetPath(threadId: string) {
  return `/messages/${threadId}`
}

export function buildChatPushPreview(input: ChatPreviewInput): ChatEventPreview {
  const senderName = input.senderName.trim() || 'Run Club'
  const messagePreview = input.messagePreview.trim()

  if (input.threadType === 'club') {
    const channelTitle = input.priority === 'important'
      ? getClubImportantTitle(input.threadChannelKey)
      : getCommonChannelTitle(input.threadChannelKey) ?? 'Клуб'

    return {
      title: channelTitle,
      body: messagePreview
        ? `${senderName}: ${messagePreview}`
        : input.priority === 'important'
          ? 'Новое важное сообщение в клубе'
          : 'Новое сообщение в клубе',
    }
  }

  if (input.priority === 'important') {
    return {
      title: input.senderIsCoach ? 'Важное сообщение от тренера' : `Важное сообщение от ${senderName}`,
      body: messagePreview || 'Откройте чат',
    }
  }

  return {
    title: senderName,
    body: messagePreview || 'Новое сообщение',
  }
}

export function buildChatMessageCreatedAppEvent(
  input: ChatMessageCreatedAppEventInput
): CreateAppEventInput {
  const targetPath = buildChatMessageEventTargetPath(input.threadId)
  const preview = buildChatPushPreview(input)

  return {
    type: 'chat_message.created',
    actorUserId: input.actorUserId,
    targetUserId: input.recipientUserId,
    entityType: 'chat_message',
    entityId: input.messageId,
    category: 'chat',
    channel: 'push',
    priority: input.priority,
    targetPath,
    dedupeKey: `chat_message:${input.messageId}:${input.recipientUserId}`,
    payload: {
      v: 1,
      threadId: input.threadId,
      messageId: input.messageId,
      senderName: input.senderName,
      messagePreview: input.messagePreview,
      targetPath,
      preview,
      priority: input.priority,
      threadType: input.threadType,
    },
  }
}

function asRecord(value: unknown) {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

export function getChatPushEnvelopeFromAppEvent(input: {
  payload: unknown
  targetPath?: string | null
  priority?: string | null
}): {
  threadId: string
  messageId: string
  senderName: string
  messagePreview: string
  targetPath: string
  title: string
  body: string
  threadType: 'club' | 'direct_coach'
  priority: AppEventPriority
} | null {
  const payload = asRecord(input.payload)
  const preview = asRecord(payload?.preview)
  const title = typeof preview?.title === 'string' ? preview.title.trim() : ''
  const body = typeof preview?.body === 'string' ? preview.body.trim() : ''
  const threadId = typeof payload?.threadId === 'string' ? payload.threadId.trim() : ''
  const messageId = typeof payload?.messageId === 'string' ? payload.messageId.trim() : ''
  const senderName = typeof payload?.senderName === 'string' ? payload.senderName.trim() : ''
  const messagePreview = typeof payload?.messagePreview === 'string' ? payload.messagePreview.trim() : ''
  const threadType = payload?.threadType === 'club' || payload?.threadType === 'direct_coach'
    ? payload.threadType
    : null
  const targetPath = normalizeAppEventTargetPath(input.targetPath)
    ?? normalizeAppEventTargetPath(typeof payload?.targetPath === 'string' ? payload.targetPath : null)

  if (!title || !threadId || !threadType || !targetPath) {
    return null
  }

  return {
    threadId,
    messageId,
    senderName,
    messagePreview,
    targetPath,
    title,
    body,
    threadType,
    priority: normalizeAppEventPriority(
      typeof payload?.priority === 'string' ? payload.priority : input.priority
    ),
  }
}
