import type { CommonChannelKey } from '@/lib/chat/commonChannels'
import { getCommonChannelTitle } from '@/lib/chat/commonChannels'
import type { CreateAppEventInput } from '@/lib/events/createAppEvent'
import type { AppEventPriority } from '@/lib/events/appEventRouting'

export type ChatEventPreview = {
  title: string
  body: string
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
