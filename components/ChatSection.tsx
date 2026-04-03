'use client'

import Image from 'next/image'
import Link from 'next/link'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react'
import ConfirmActionSheet from '@/components/ConfirmActionSheet'
import ChatMessageActions from '@/components/chat/ChatMessageActions'
import { updatePrefetchedMessagesListThreadLastMessage } from '@/lib/chat/messagesListPrefetch'
import {
  CHAT_SEND_DEBUG,
  type ChatSendDebugEvent,
  getChatSendDebugErrorCategory,
  getChatSendDebugErrorDetails,
  getRecentChatSendDebugEvents,
  logChatSendDebug,
  logChatSendDebugError,
  subscribeChatSendDebugEvents,
} from '@/lib/chatSendDebug'
import {
  markChatSendTimingImageRenderable,
  markChatSendTimingOptimisticInsert,
  markChatSendTimingPhase,
  markChatSendTimingReconciliationSuccess,
  markChatSendTimingRequestSuccess,
  registerChatSendTimingTap,
  scanChatSendTimingVisualComplete,
} from '@/lib/chatSendTiming'
import type { ChatThreadLastMessage } from '@/lib/chat/threads'
import {
  CHAT_MESSAGE_MAX_ATTACHMENTS,
  CHAT_MESSAGE_MAX_LENGTH,
  createChatMessage,
  createVoiceChatMessage,
  deleteUploadedChatImage,
  getCachedRecentChatMessages,
  getPrefetchedRecentChatMessages,
  loadChatMessageById,
  loadChatMessageItem,
  loadOlderChatMessages,
  loadRecentChatMessages,
  setCachedRecentChatMessages,
  softDeleteChatMessage,
  toggleChatMessageReaction,
  type ChatMessageAttachment,
  type ChatMessageItem,
  updateChatMessage,
} from '@/lib/chat'
import {
  getPendingChatMediaTask,
  hasPendingChatMediaTask,
  queuePendingChatMediaTask,
  retryPendingChatMediaTask,
  subscribePendingChatMediaTasks,
} from '@/lib/chat/pendingMediaUploads'
import { uploadVoiceMessage } from '@/lib/storage/uploadVoiceMessage'
import { supabase } from '@/lib/supabase'
import { getVoiceStream, scheduleVoiceStreamStop } from '@/lib/voice/voiceStream'

type ChatSectionProps = {
  showTitle?: boolean
  threadId?: string | null
  currentUserId?: string | null
  isKeyboardOpen?: boolean
  isThreadLayoutReady?: boolean
  title?: string
  description?: string
}

type PendingComposerImage = {
  id: string
  file: File
  previewUrl: string
  width: number | null
  height: number | null
}

type ChatSendErrorGuardState = {
  hasRequestSuccess: boolean
  hasResponseOk: boolean
  hasReconciliationSuccess: boolean
}

function getChatSendContentKind(options: {
  textLength: number
  imageCount: number
  voiceCount?: number
}) {
  if ((options.voiceCount ?? 0) > 0) {
    return 'voice'
  }

  if (options.imageCount > 0 && options.textLength > 0) {
    return 'mixed'
  }

  if (options.imageCount > 0) {
    return 'image'
  }

  return 'text-only'
}

function getComposerAttachmentDebugCounts(images: PendingComposerImage[]) {
  return {
    image: images.length,
    voice: 0,
  }
}

type ThreadOpenDebugSource =
  | 'initial_load'
  | 'realtime_insert'
  | 'realtime_update'
  | 'refresh'
  | 'fallback'
  | 'unknown'

const THREAD_OPEN_DEBUG_WINDOW_MS = 10000
const CHAT_REMOTE_IMAGE_LOAD_ROOT_MARGIN_PX = 320
const CHAT_IMAGE_ATTACHMENT_FALLBACK_ASPECT_RATIO = '1 / 1'

const CHAT_SEND_DEBUG_VISIBLE_PHASES = new Set([
  'panel_mounted',
  'send_start',
  'request_start',
  'response_status',
  'parsed_response',
  'request_success',
  'text_pending_label_cleared',
  'attachment_task_queued',
  'attachment_upload_start',
  'attachment_upload_success',
  'attachment_upload_failed',
  'attachment_attach_success',
  'attachment_attach_failed',
  'reconciliation_waiting_realtime',
  'reconciliation_success',
  'reconciliation_failure',
  'ui_error_path_trigger',
  'attachment_render_mount',
  'attachment_render_unmount',
  'attachment_cached_load_reused',
  'attachment_source_changed',
  'attachment_key_changed',
  'attachment_visual_state_changed',
  'attachment_img_load_start',
  'attachment_img_load_success',
  'attachment_img_load_error',
  'attachment_layout_shift',
  'thread_open_image_load_anchor_skipped',
  'thread_open_start',
  'thread_open_initial_messages_loaded',
  'thread_open_messages_set',
  'thread_open_messages_replaced',
  'thread_open_messages_replace_skipped',
  'thread_open_messages_merged',
  'thread_open_realtime_subscription_ready',
  'thread_open_realtime_insert_received',
  'thread_open_realtime_update_received',
  'thread_open_post_mount_refresh_start',
  'thread_open_post_mount_refresh_success',
  'thread_open_image_message_rehydrated',
  'visual_complete',
  'send_timing_summary',
  'attachment_timing_summary',
])
const CHAT_SEND_DEBUG_VISIBLE_EVENT_LIMIT = 100

function summarizeThreadOpenMessages(messages: ChatMessageItem[]) {
  return {
    messageCount: messages.length,
    imageMessageCount: messages.filter((message) => message.messageType === 'image').length,
    attachmentCount: messages.reduce((total, message) => total + message.attachments.length, 0),
  }
}

function buildThreadOpenMessageChangeStats(previousMessages: ChatMessageItem[], nextMessages: ChatMessageItem[]) {
  const previousIds = new Set(previousMessages.map((message) => message.id))
  const nextIds = new Set(nextMessages.map((message) => message.id))
  const sameIdsCount = [...previousIds].filter((id) => nextIds.has(id)).length
  const changedIdsCount = [...new Set([...previousIds, ...nextIds])].length - sameIdsCount

  return {
    previousCount: previousMessages.length,
    nextCount: nextMessages.length,
    sameIdsCount,
    changedIdsCount,
    idsChangedSignificantly: changedIdsCount > sameIdsCount,
  }
}

function hasRemoteImageUrls(message: ChatMessageItem) {
  return message.attachments.some(
    (attachment) =>
      Boolean(attachment.publicUrl?.trim()) && !isLocalOrTransientImageUrl(attachment.publicUrl)
  )
}

function getAttachmentMaterialSignature(message: ChatMessageItem) {
  return message.attachments
    .map((attachment) => `${attachment.id}:${attachment.sortOrder}:${attachment.publicUrl ?? ''}`)
    .join('|')
}

function getThreadOpenMessageEquivalenceSignature(message: ChatMessageItem) {
  return [
    message.id,
    message.messageType,
    message.createdAt,
    message.editedAt ?? '',
    message.isDeleted ? 'deleted' : 'active',
    message.imageUrl ?? '',
    message.mediaUrl ?? '',
    message.replyToId ?? '',
    getAttachmentMaterialSignature(message),
    message.reactions
      .map((reaction) => `${reaction.emoji}:${reaction.count}:${reaction.userIds.join(',')}`)
      .join('|'),
  ].join('::')
}

function areThreadOpenMessageListsEquivalent(
  currentMessages: ChatMessageItem[],
  nextMessages: ChatMessageItem[]
) {
  if (currentMessages.length !== nextMessages.length) {
    return false
  }

  return currentMessages.every((message, index) => (
    getThreadOpenMessageEquivalenceSignature(message) ===
      getThreadOpenMessageEquivalenceSignature(nextMessages[index]!)
  ))
}

function formatChatSendDebugValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value === 'string') {
    return value.length > 48 ? `${value.slice(0, 45)}...` : value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((item) => formatChatSendDebugValue(item)).filter(Boolean).join(', ') : null
  }

  try {
    const serialized = JSON.stringify(value)
    return serialized.length > 64 ? `${serialized.slice(0, 61)}...` : serialized
  } catch {
    return String(value)
  }
}

function summarizeChatSendDebugPayload(payload: Record<string, unknown>) {
  const summaryKeys = [
    'category',
    'status',
    'messageId',
    'serverMessageId',
    'optimisticMessageId',
    'threadId',
    'contentKind',
    'textLength',
    'attachmentCount',
    'attachmentKinds',
    'attachmentStates',
    'source',
    'reason',
    'error',
    'result',
  ] as const

  const summary = summaryKeys
    .map((key) => {
      const formattedValue = formatChatSendDebugValue(payload[key])
      return formattedValue ? `${key}=${formattedValue}` : null
    })
    .filter((item): item is string => Boolean(item))
    .join(' | ')

  return summary || 'no-payload'
}

function formatChatSendDebugTimestamp(timestamp: string) {
  try {
    return new Date(timestamp).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return timestamp
  }
}

function ChatSendDebugPanel({
  events,
  expanded,
  copyStatus,
  debugEnabled,
  mounted,
  threadId,
  onToggle,
  onCopy,
}: {
  events: ChatSendDebugEvent[]
  expanded: boolean
  copyStatus: string
  debugEnabled: boolean
  mounted: boolean
  threadId: string | null
  onToggle: () => void
  onCopy: () => void
}) {
  const latestEvent = events[0] ?? null

  return (
    <div className="pointer-events-none fixed left-3 right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[120] md:left-auto md:right-4 md:top-4 md:w-[26rem]">
      <div className="pointer-events-auto overflow-hidden rounded-2xl border-2 border-amber-400 bg-black/92 text-white shadow-2xl backdrop-blur-md">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <button
            type="button"
            onClick={onToggle}
            className="min-w-0 flex-1 text-left"
          >
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-black">
                CHAT SEND DEBUG
              </span>
              <span className="text-[11px] text-white/65">
                {events.length} events
              </span>
            </div>
            <p className="mt-1 truncate text-[11px] text-white/80">
              {latestEvent
                ? `${formatChatSendDebugTimestamp(latestEvent.timestamp)} ${latestEvent.phase}`
                : 'No events yet'}
            </p>
          </button>
          <button
            type="button"
            onClick={onCopy}
            className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-white/90"
          >
            Copy debug
          </button>
        </div>
        <div className="border-t border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] leading-4 text-white/80">
          <p>{`enabled: ${debugEnabled ? 'yes' : 'no'} | mounted: ${mounted ? 'yes' : 'no'} | event_count: ${events.length}`}</p>
          <p className="mt-1">{`thread: ${threadId ?? 'club/all'}`}</p>
        </div>
        {copyStatus ? (
          <div className="border-t border-white/10 px-3 py-1.5 text-[10px] text-emerald-200">
            {copyStatus}
          </div>
        ) : null}
        {expanded ? (
          <div className="max-h-[min(42svh,320px)] overflow-y-auto border-t border-white/10 px-2 py-2">
            {events.length > 0 ? events.map((event) => (
              <div
                key={event.id}
                className="mb-2 rounded-xl border border-white/8 bg-white/[0.04] px-2.5 py-2 last:mb-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[11px] font-semibold text-white">
                    {event.phase}
                  </p>
                  <span className={`shrink-0 text-[10px] ${event.level === 'error' ? 'text-red-200' : 'text-white/55'}`}>
                    {formatChatSendDebugTimestamp(event.timestamp)}
                  </span>
                </div>
                <p className="mt-1 break-words text-[11px] leading-4 text-white/75">
                  {summarizeChatSendDebugPayload(event.payload)}
                </p>
              </div>
            )) : (
              <p className="px-1 py-2 text-[11px] text-white/65">
                No send debug events yet
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

const LONG_PRESS_MS = 450
const INITIAL_CHAT_MESSAGE_LIMIT = 10
const OLDER_CHAT_BATCH_LIMIT = 10
const AUTO_FILL_OLDER_MESSAGES_MAX_BATCHES = 12
const MAX_RENDERED_CHAT_MESSAGES = 60
const CHAT_COMPOSER_TEXTAREA_MAX_HEIGHT = 120
const SWIPE_REPLY_TRIGGER_PX = 80
const SWIPE_REPLY_MAX_OFFSET_PX = 96
const SWIPE_REPLY_VERTICAL_LOCK_PX = 12
const SWIPE_REPLY_HORIZONTAL_DOMINANCE_RATIO = 1.5
const REACTION_ANIMATION_DURATION_MS = 200
const OPTIMISTIC_MESSAGE_MATCH_WINDOW_MS = 2 * 60 * 1000
const CHAT_VOICE_BUCKET = 'chat-voice'
const CHAT_VOICE_SIGNED_URL_TTL_SECONDS = 60 * 60
const VOICE_PLAYBACK_SPEEDS = [1, 1.5, 2] as const
const REPLY_TARGET_HIGHLIGHT_CLASSES = [
  'bg-yellow-100',
  'dark:bg-yellow-500/20',
  'ring-2',
  'ring-yellow-300',
  'dark:ring-yellow-400/40',
]

let activeVoiceMessageAudio: HTMLAudioElement | null = null

function revokeObjectUrlIfNeeded(url: string | null | undefined) {
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url)
  }
}

function toThreadLastMessage(message: ChatMessageItem, threadId: string): ChatThreadLastMessage {
  return {
    id: message.id,
    threadId,
    userId: message.userId,
    text: message.text,
    messageType: message.messageType,
    mediaUrl: message.mediaUrl,
    mediaDurationSeconds: message.mediaDurationSeconds,
    createdAt: message.createdAt,
    senderDisplayName: message.displayName,
    previewText: message.previewText || 'Новое сообщение',
  }
}

function AvatarFallback({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700 ${className}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 20a6 6 0 0 0-12 0" />
        <circle cx="12" cy="8" r="4" />
      </svg>
    </span>
  )
}

function TinyUserAvatar({
  avatarUrl,
  displayName,
  className = 'h-4.5 w-4.5',
}: {
  avatarUrl: string | null
  displayName: string
  className?: string
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={displayName}
        className={`${className} shrink-0 rounded-full object-cover ring-1 ring-white/80 dark:ring-black/30`}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`${className} flex shrink-0 items-center justify-center rounded-full bg-gray-200 text-[9px] font-semibold text-gray-600 ring-1 ring-white/80 dark:bg-gray-700 dark:text-gray-200 dark:ring-black/30`}
    >
      {(displayName.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}

function insertMessageChronologically(messages: ChatMessageItem[], nextMessage: ChatMessageItem) {
  if (messages.some((message) => message.id === nextMessage.id)) {
    return messages
  }

  return [...messages, nextMessage].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime()
    const rightTime = new Date(right.createdAt).getTime()

    if (leftTime === rightTime) {
      return left.id.localeCompare(right.id)
    }

    return leftTime - rightTime
  })
}

function upsertMessageById(messages: ChatMessageItem[], nextMessage: ChatMessageItem) {
  const existingIndex = messages.findIndex((message) => message.id === nextMessage.id)

  if (existingIndex === -1) {
    return insertMessageChronologically(messages, nextMessage)
  }

  const nextMessages = [...messages]
  nextMessages[existingIndex] = nextMessage

  return nextMessages.sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime()
    const rightTime = new Date(right.createdAt).getTime()

    if (leftTime === rightTime) {
      return left.id.localeCompare(right.id)
    }

    return leftTime - rightTime
  })
}

function removeMessageById(messages: ChatMessageItem[], messageId: string) {
  return messages.filter((message) => message.id !== messageId)
}

function replaceMessageById(
  messages: ChatMessageItem[],
  messageId: string,
  nextMessage: ChatMessageItem
) {
  const existingIndex = messages.findIndex((message) => message.id === messageId)

  if (existingIndex === -1) {
    return messages
  }

  const nextMessages = [...messages]
  nextMessages[existingIndex] = nextMessage
  return nextMessages
}

function getMessageStableRenderKey(message: ChatMessageItem) {
  return message.optimisticRenderKey ?? message.id
}

function getOptimisticMessageReplyPreview(message: ChatMessageItem | null) {
  if (!message) {
    return null
  }

  return {
    id: message.id,
    userId: message.userId,
    displayName: message.displayName,
    text: message.previewText || message.text,
  }
}

type RealtimeChatMessageRow = {
  id: string
  user_id: string
  text: string | null
  message_type: string | null
  image_url: string | null
  media_url: string | null
  media_duration_seconds: number | null
  edited_at: string | null
  created_at: string
  reply_to_id: string | null
}

function toRealtimeChatMessageRow(value: unknown): RealtimeChatMessageRow | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id : ''
  const userId = typeof row.user_id === 'string' ? row.user_id : ''
  const createdAt = typeof row.created_at === 'string' ? row.created_at : ''

  if (!id || !userId || !createdAt) {
    return null
  }

  return {
    id,
    user_id: userId,
    text: typeof row.text === 'string' ? row.text : null,
    message_type: typeof row.message_type === 'string' ? row.message_type : null,
    image_url: typeof row.image_url === 'string' ? row.image_url : null,
    media_url: typeof row.media_url === 'string' ? row.media_url : null,
    media_duration_seconds: typeof row.media_duration_seconds === 'number' ? row.media_duration_seconds : null,
    edited_at: typeof row.edited_at === 'string' ? row.edited_at : null,
    created_at: createdAt,
    reply_to_id: typeof row.reply_to_id === 'string' ? row.reply_to_id : null,
  }
}

function resolveRealtimeMessageType(row: RealtimeChatMessageRow): ChatMessageItem['messageType'] {
  if (row.message_type === 'voice') {
    return 'voice'
  }

  if (row.message_type === 'image' || row.image_url) {
    return 'image'
  }

  return 'text'
}

function getRealtimePreviewText(row: RealtimeChatMessageRow, optimisticMessage: ChatMessageItem) {
  const trimmedText = row.text?.trim() ?? ''

  if (trimmedText) {
    return trimmedText
  }

  const messageType = resolveRealtimeMessageType(row)

  if (messageType === 'voice') {
    return 'Голосовое сообщение'
  }

  if (messageType === 'image') {
    return optimisticMessage.attachments.length > 1 ? `${optimisticMessage.attachments.length} фото` : 'Фото'
  }

  return ''
}

function getOptimisticAttachmentStates(
  message: Pick<ChatMessageItem, 'attachments' | 'optimisticAttachmentStates'>
) {
  if (message.optimisticAttachmentStates && message.optimisticAttachmentStates.length > 0) {
    return [...message.optimisticAttachmentStates]
  }

  return message.attachments.map(() => 'attached' as const)
}

function deriveOptimisticAttachmentUploadState(
  states: ChatMessageItem['optimisticAttachmentStates']
): ChatMessageItem['optimisticAttachmentUploadState'] {
  if (!states || states.length === 0) {
    return null
  }

  if (states.some((state) => state === 'uploading' || state === 'uploaded')) {
    return 'uploading'
  }

  if (states.some((state) => state === 'pending')) {
    return 'uploading'
  }

  if (states.some((state) => state === 'failed')) {
    return 'failed'
  }

  return null
}

function getOptimisticAttachmentProgress(
  message: Pick<ChatMessageItem, 'attachments' | 'optimisticAttachmentStates'>
) {
  const states = getOptimisticAttachmentStates(message)

  return {
    total: states.length,
    attachedCount: states.filter((state) => state === 'attached').length,
    availableCount: states.filter((state) => state === 'attached' || state === 'uploaded').length,
    uploadingCount: states.filter((state) => state === 'pending' || state === 'uploading' || state === 'uploaded').length,
    failedCount: states.filter((state) => state === 'failed').length,
  }
}

function getImageAttachmentCardStyle(
  attachment: Pick<ChatMessageAttachment, 'width' | 'height'>,
  _compactPreview: boolean
) {
  if (attachment.width && attachment.height) {
    return {
      aspectRatio: `${attachment.width} / ${attachment.height}`,
    }
  }

  return {
    aspectRatio: CHAT_IMAGE_ATTACHMENT_FALLBACK_ASPECT_RATIO,
  }
}

function hasPendingOptimisticImageAttachments(message: ChatMessageItem) {
  return Boolean(
    message.isOptimistic &&
    message.messageType === 'image' &&
    getOptimisticAttachmentStates(message).some((state) => state !== 'attached')
  )
}

function isLocalOrTransientImageUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false
  }

  const trimmedUrl = url.trim()

  return trimmedUrl.startsWith('blob:') || trimmedUrl.startsWith('data:')
}

type AttachmentDebugSourceType = 'local_preview' | 'remote_public_url' | 'placeholder' | 'unknown'
type AttachmentDebugVisualState = 'preview' | 'pending' | 'loading_remote' | 'final' | 'error' | 'blank'
type AttachmentDebugAttachmentState = NonNullable<ChatMessageItem['optimisticAttachmentStates']>[number]

function getAttachmentDebugSourceType(url: string | null | undefined): AttachmentDebugSourceType {
  if (!url?.trim()) {
    return 'placeholder'
  }

  if (isLocalOrTransientImageUrl(url)) {
    return 'local_preview'
  }

  return 'remote_public_url'
}

function getAttachmentDebugVisualState({
  sourceType,
  attachmentState,
  previewFailedToLoad,
  hasLoadedCurrentSource,
}: {
  sourceType: AttachmentDebugSourceType
  attachmentState: AttachmentDebugAttachmentState
  previewFailedToLoad: boolean
  hasLoadedCurrentSource: boolean
}): AttachmentDebugVisualState {
  if (previewFailedToLoad || attachmentState === 'failed') {
    return 'error'
  }

  if (sourceType === 'local_preview') {
    return 'preview'
  }

  if (sourceType === 'placeholder') {
    return 'blank'
  }

  if (sourceType === 'remote_public_url') {
    if (!hasLoadedCurrentSource) {
      return 'loading_remote'
    }

    if (attachmentState === 'pending' || attachmentState === 'uploading' || attachmentState === 'uploaded') {
      return 'pending'
    }

    return 'final'
  }

  return 'blank'
}

function getAttachmentDebugIds(message: ChatMessageItem) {
  return {
    optimisticMessageId: message.id.startsWith('temp-') ? message.id : null,
    serverMessageId: message.optimisticServerMessageId ?? (!message.id.startsWith('temp-') ? message.id : null),
  }
}

const loadedRemoteAttachmentSourcesByKey = new Set<string>()

function normalizeRemoteAttachmentSourceIdentity(sourceUrl: string | null) {
  if (!sourceUrl) {
    return null
  }

  const trimmedSourceUrl = sourceUrl.trim()

  if (!trimmedSourceUrl) {
    return null
  }

  try {
    const normalizedUrl = new URL(trimmedSourceUrl)
    normalizedUrl.hash = ''

    const sortedSearchParams = [...normalizedUrl.searchParams.entries()]
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        if (leftKey === rightKey) {
          return leftValue.localeCompare(rightValue)
        }

        return leftKey.localeCompare(rightKey)
      })

    normalizedUrl.search = ''

    sortedSearchParams.forEach(([key, value]) => {
      normalizedUrl.searchParams.append(key, value)
    })

    return normalizedUrl.toString()
  } catch {
    return trimmedSourceUrl
  }
}

function getRemoteAttachmentLoadedCacheKey(
  message: ChatMessageItem,
  attachment: ChatMessageAttachment,
  sourceUrl: string | null
) {
  const normalizedSourceIdentity = normalizeRemoteAttachmentSourceIdentity(sourceUrl)

  if (!normalizedSourceIdentity) {
    return null
  }

  if (attachment.id) {
    return `attachment:${attachment.id}:${normalizedSourceIdentity}`
  }

  const { serverMessageId } = getAttachmentDebugIds(message)
  return `message:${serverMessageId ?? message.id}:${attachment.sortOrder}:${normalizedSourceIdentity}`
}

function hasLoadedRemoteAttachmentSourceInSession(
  message: ChatMessageItem,
  attachment: ChatMessageAttachment,
  sourceUrl: string | null
) {
  const cacheKey = getRemoteAttachmentLoadedCacheKey(message, attachment, sourceUrl)
  return Boolean(cacheKey && loadedRemoteAttachmentSourcesByKey.has(cacheKey))
}

function markRemoteAttachmentSourceLoadedInSession(
  message: ChatMessageItem,
  attachment: ChatMessageAttachment,
  sourceUrl: string | null
) {
  const cacheKey = getRemoteAttachmentLoadedCacheKey(message, attachment, sourceUrl)

  if (!cacheKey || !sourceUrl) {
    return
  }

  loadedRemoteAttachmentSourcesByKey.add(cacheKey)
}

function buildAttachmentDebugPayload({
  message,
  attachment,
  tileIndex,
  renderKey,
  sourceType,
  sourceUrlChanged = false,
  visualState,
}: {
  message: ChatMessageItem
  attachment: ChatMessageAttachment
  tileIndex: number
  renderKey: string
  sourceType: AttachmentDebugSourceType
  sourceUrlChanged?: boolean
  visualState: AttachmentDebugVisualState
}) {
  return {
    ...getAttachmentDebugIds(message),
    attachmentId: attachment.id ?? null,
    tileIndex,
    sortOrder: attachment.sortOrder,
    renderKey,
    sourceType,
    sourceUrlChanged,
    visualState,
    width: attachment.width ?? null,
    height: attachment.height ?? null,
  }
}

function getAttachmentStableRenderKey(
  attachment: Pick<ChatMessageAttachment, 'sortOrder'>,
  tileIndex: number
) {
  return `attachment-tile-${attachment.sortOrder ?? tileIndex}`
}

function ChatImageAttachmentTile({
  message,
  attachment,
  attachmentState,
  tileIndex,
  className,
  style,
  previewFailedToLoad,
  onPreviewError,
  onImageClick,
  onImageLoad,
  attachments,
}: {
  message: ChatMessageItem
  attachment: ChatMessageAttachment
  attachmentState: AttachmentDebugAttachmentState
  tileIndex: number
  className: string
  style?: {
    aspectRatio?: string
    minHeight?: string
  }
  previewFailedToLoad: boolean
  onPreviewError: (attachmentId: string) => void
  onImageClick?: (attachments: ChatMessageAttachment[], index: number) => void
  onImageLoad?: (message: ChatMessageItem, sortOrder: number, publicUrl: string) => void
  attachments: ChatMessageAttachment[]
}) {
  const tileRef = useRef<HTMLButtonElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const previousHeightRef = useRef<number | null>(null)
  const latestPayloadRef = useRef<ReturnType<typeof buildAttachmentDebugPayload> | null>(null)
  const previousSourceUrlRef = useRef<string | null>(null)
  const previousVisualStateRef = useRef<AttachmentDebugVisualState | null>(null)
  const loadStartedSourceUrlRef = useRef<string | null>(null)
  const loadSucceededSourceUrlRef = useRef<string | null>(null)
  const notifiedImageLoadSourceUrlRef = useRef<string | null>(null)
  const loggedCachedLoadReuseKeyRef = useRef<string | null>(null)
  const preservedPreviewUrlRef = useRef<string | null>(null)
  const backgroundRemoteLoadUrlRef = useRef<string | null>(null)
  const incomingSourceUrl = attachment.publicUrl?.trim() ? attachment.publicUrl : null
  const incomingSourceType = getAttachmentDebugSourceType(incomingSourceUrl)
  const remoteAttachmentLoadedCacheKey =
    incomingSourceType === 'remote_public_url'
      ? getRemoteAttachmentLoadedCacheKey(message, attachment, incomingSourceUrl)
      : null
  const isRemoteAttachmentAlreadyLoadedInSession =
    Boolean(remoteAttachmentLoadedCacheKey) &&
    hasLoadedRemoteAttachmentSourceInSession(message, attachment, incomingSourceUrl)
  const renderKey = getAttachmentStableRenderKey(attachment, tileIndex)
  const [displayedSourceUrl, setDisplayedSourceUrl] = useState<string | null>(incomingSourceUrl)
  const [displayedSourceType, setDisplayedSourceType] = useState<AttachmentDebugSourceType>(incomingSourceType)
  const [loadedDisplayedSourceUrl, setLoadedDisplayedSourceUrl] = useState<string | null>(
    incomingSourceType === 'local_preview' || isRemoteAttachmentAlreadyLoadedInSession
      ? incomingSourceUrl
      : null
  )
  const [softPreviewLoadErrorSourceUrl, setSoftPreviewLoadErrorSourceUrl] = useState<string | null>(null)
  const supportsViewportDeferredRemoteImages =
    typeof window !== 'undefined' &&
    typeof IntersectionObserver !== 'undefined'
  const shouldGateRemoteImageLoad = Boolean(
    incomingSourceType === 'remote_public_url' &&
    attachmentState === 'attached' &&
    !message.isOptimistic &&
    supportsViewportDeferredRemoteImages
  )
  const [isRemoteImageLoadAllowed, setIsRemoteImageLoadAllowed] = useState(() => !shouldGateRemoteImageLoad)
  const hasSoftPreviewLoadError = Boolean(
    displayedSourceType === 'local_preview' &&
    displayedSourceUrl &&
    softPreviewLoadErrorSourceUrl === displayedSourceUrl
  )
  const effectiveSourceType = hasSoftPreviewLoadError ? 'placeholder' : displayedSourceType
  const canShowImage = Boolean(displayedSourceUrl) && !previewFailedToLoad && !hasSoftPreviewLoadError
  const isFailedAttachment = attachmentState === 'failed'
  const canOpenAttachment = Boolean(onImageClick && canShowImage && !isFailedAttachment)
  const shouldKeepPreviewVisibleWhileRemoteLoads = Boolean(
    incomingSourceType === 'remote_public_url' &&
    incomingSourceUrl &&
    displayedSourceType === 'local_preview' &&
    displayedSourceUrl &&
    displayedSourceUrl !== incomingSourceUrl
  )
  const isRemoteAttachmentCachedReady = Boolean(
    isRemoteAttachmentAlreadyLoadedInSession &&
    displayedSourceType === 'remote_public_url' &&
    displayedSourceUrl &&
    displayedSourceUrl === incomingSourceUrl
  )
  const hasLoadedCurrentSource = Boolean(
    displayedSourceUrl &&
    (
      loadedDisplayedSourceUrl === displayedSourceUrl ||
      isRemoteAttachmentCachedReady
    )
  )
  const visualState = getAttachmentDebugVisualState({
    sourceType: effectiveSourceType,
    attachmentState,
    previewFailedToLoad,
    hasLoadedCurrentSource,
  })
  const canBeginCurrentImageLoad = Boolean(
    displayedSourceUrl &&
    canShowImage &&
    (!shouldGateRemoteImageLoad || isRemoteImageLoadAllowed || hasLoadedCurrentSource || shouldKeepPreviewVisibleWhileRemoteLoads)
  )
  const shouldShowRemoteLoadingPlaceholder = Boolean(
    effectiveSourceType === 'remote_public_url' &&
    displayedSourceUrl &&
    !hasLoadedCurrentSource &&
    !isFailedAttachment
  )
  const debugPayload = buildAttachmentDebugPayload({
    message,
    attachment,
    tileIndex,
    renderKey,
    sourceType: effectiveSourceType,
    sourceUrlChanged: false,
    visualState,
  })

  useEffect(() => {
    if (
      !shouldGateRemoteImageLoad ||
      hasLoadedCurrentSource ||
      isRemoteImageLoadAllowed ||
      shouldKeepPreviewVisibleWhileRemoteLoads
    ) {
      return
    }

    const node = tileRef.current

    if (!node) {
      return
    }

    const scrollRoot = node.closest('[data-chat-scroll-container="true"]')
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsRemoteImageLoadAllowed(true)
          observer.disconnect()
        }
      },
      {
        root: scrollRoot instanceof Element ? scrollRoot : null,
        rootMargin: `${CHAT_REMOTE_IMAGE_LOAD_ROOT_MARGIN_PX}px 0px ${CHAT_REMOTE_IMAGE_LOAD_ROOT_MARGIN_PX}px 0px`,
        threshold: 0.01,
      }
    )

    observer.observe(node)

    return () => {
      observer.disconnect()
    }
  }, [isRemoteImageLoadAllowed, shouldGateRemoteImageLoad, shouldKeepPreviewVisibleWhileRemoteLoads])

  useEffect(() => {
    if (incomingSourceType === 'local_preview' && incomingSourceUrl) {
      preservedPreviewUrlRef.current = incomingSourceUrl
      backgroundRemoteLoadUrlRef.current = null
      notifiedImageLoadSourceUrlRef.current = null
      setSoftPreviewLoadErrorSourceUrl(null)

      if (displayedSourceUrl !== incomingSourceUrl || displayedSourceType !== 'local_preview') {
        setDisplayedSourceUrl(incomingSourceUrl)
        setDisplayedSourceType('local_preview')
        setLoadedDisplayedSourceUrl(null)
      }
    }
  }, [displayedSourceType, displayedSourceUrl, incomingSourceType, incomingSourceUrl])

  useEffect(() => {
    if (incomingSourceType !== 'remote_public_url' || !incomingSourceUrl) {
      return
    }

    if (shouldKeepPreviewVisibleWhileRemoteLoads) {
      return
    }

    if (
      isRemoteAttachmentAlreadyLoadedInSession &&
      loggedCachedLoadReuseKeyRef.current !== remoteAttachmentLoadedCacheKey
    ) {
      loggedCachedLoadReuseKeyRef.current = remoteAttachmentLoadedCacheKey
      logChatSendDebug('attachment_cached_load_reused', {
        ...debugPayload,
        sourceType: 'remote_public_url',
        visualState: 'final',
      })
    }

    if (displayedSourceUrl !== incomingSourceUrl || displayedSourceType !== 'remote_public_url') {
      setDisplayedSourceUrl(incomingSourceUrl)
      setDisplayedSourceType('remote_public_url')
      setLoadedDisplayedSourceUrl(isRemoteAttachmentAlreadyLoadedInSession ? incomingSourceUrl : null)
      notifiedImageLoadSourceUrlRef.current = null
      setSoftPreviewLoadErrorSourceUrl(null)
    }
  }, [
    displayedSourceType,
    displayedSourceUrl,
    incomingSourceType,
    incomingSourceUrl,
    remoteAttachmentLoadedCacheKey,
    isRemoteAttachmentAlreadyLoadedInSession,
    shouldKeepPreviewVisibleWhileRemoteLoads,
    debugPayload,
  ])

  useEffect(() => {
    logChatSendDebug('attachment_render_mount', debugPayload)

    return () => {
      if (latestPayloadRef.current) {
        logChatSendDebug('attachment_render_unmount', latestPayloadRef.current)
      }
    }
  }, [])

  useEffect(() => {
    previousSourceUrlRef.current = displayedSourceUrl
  }, [displayedSourceUrl])

  useEffect(() => {
    latestPayloadRef.current = debugPayload
  }, [debugPayload])

  useEffect(() => {
    if (previousVisualStateRef.current !== null && previousVisualStateRef.current !== visualState) {
      logChatSendDebug('attachment_visual_state_changed', debugPayload)
    }

    previousVisualStateRef.current = visualState
  }, [debugPayload, visualState])

  useEffect(() => {
    if (!displayedSourceUrl || !canShowImage) {
      loadStartedSourceUrlRef.current = null
      loadSucceededSourceUrlRef.current = null
      setLoadedDisplayedSourceUrl(null)
      return
    }

    if (hasLoadedCurrentSource) {
      return
    }

    if (!canBeginCurrentImageLoad) {
      return
    }

    if (isRemoteAttachmentCachedReady) {
      return
    }

    if (displayedSourceType === 'remote_public_url' && shouldKeepPreviewVisibleWhileRemoteLoads) {
      return
    }

    if (loadStartedSourceUrlRef.current === displayedSourceUrl) {
      return
    }

    loadStartedSourceUrlRef.current = displayedSourceUrl
    loadSucceededSourceUrlRef.current = null
    setLoadedDisplayedSourceUrl(null)
    logChatSendDebug('attachment_img_load_start', latestPayloadRef.current ?? debugPayload)

    if (
      imgRef.current?.complete &&
      imgRef.current.naturalWidth > 0 &&
      loadSucceededSourceUrlRef.current !== displayedSourceUrl
    ) {
      loadSucceededSourceUrlRef.current = displayedSourceUrl
      markRemoteAttachmentSourceLoadedInSession(message, attachment, displayedSourceUrl)
      setLoadedDisplayedSourceUrl(displayedSourceUrl)
      logChatSendDebug('attachment_img_load_success', {
        ...(latestPayloadRef.current ?? debugPayload),
        visualState: getAttachmentDebugVisualState({
          sourceType: displayedSourceType,
          attachmentState,
          previewFailedToLoad,
          hasLoadedCurrentSource: true,
        }),
      })

      if (
        displayedSourceType === 'remote_public_url' &&
        notifiedImageLoadSourceUrlRef.current !== displayedSourceUrl
      ) {
        notifiedImageLoadSourceUrlRef.current = displayedSourceUrl
        onImageLoad?.(message, attachment.sortOrder, displayedSourceUrl)
      }
    }
  }, [
    attachment,
    attachmentState,
    canBeginCurrentImageLoad,
    canShowImage,
    debugPayload,
    displayedSourceType,
    displayedSourceUrl,
    hasLoadedCurrentSource,
    isRemoteAttachmentCachedReady,
    message,
    onImageLoad,
    previewFailedToLoad,
    shouldKeepPreviewVisibleWhileRemoteLoads,
  ])

  useEffect(() => {
    if (
      incomingSourceType !== 'remote_public_url' ||
      !incomingSourceUrl ||
      !shouldKeepPreviewVisibleWhileRemoteLoads ||
      typeof window === 'undefined'
    ) {
      return
    }

    if (backgroundRemoteLoadUrlRef.current === incomingSourceUrl) {
      return
    }

    backgroundRemoteLoadUrlRef.current = incomingSourceUrl
    loadStartedSourceUrlRef.current = incomingSourceUrl
    logChatSendDebug('attachment_img_load_start', {
      ...debugPayload,
      sourceType: 'remote_public_url',
      visualState: 'loading_remote',
    })

    let isCancelled = false
    const preloadImage = new window.Image()

    preloadImage.onload = () => {
      if (isCancelled) {
        return
      }

      loadSucceededSourceUrlRef.current = incomingSourceUrl
      markRemoteAttachmentSourceLoadedInSession(message, attachment, incomingSourceUrl)
      backgroundRemoteLoadUrlRef.current = null
      notifiedImageLoadSourceUrlRef.current = incomingSourceUrl
      setDisplayedSourceUrl(incomingSourceUrl)
      setDisplayedSourceType('remote_public_url')
      setLoadedDisplayedSourceUrl(incomingSourceUrl)
      setSoftPreviewLoadErrorSourceUrl(null)
      logChatSendDebug('attachment_img_load_success', {
        ...buildAttachmentDebugPayload({
          message,
          attachment,
          tileIndex,
          renderKey,
          sourceType: 'remote_public_url',
          visualState: getAttachmentDebugVisualState({
            sourceType: 'remote_public_url',
            attachmentState,
            previewFailedToLoad,
            hasLoadedCurrentSource: true,
          }),
        }),
        sourceUrlChanged: true,
      })
      onImageLoad?.(message, attachment.sortOrder, incomingSourceUrl)
    }

    preloadImage.onerror = () => {
      if (isCancelled) {
        return
      }

      backgroundRemoteLoadUrlRef.current = null
      logChatSendDebug('attachment_img_load_error', {
        ...buildAttachmentDebugPayload({
          message,
          attachment,
          tileIndex,
          renderKey,
          sourceType: 'remote_public_url',
          visualState: 'error',
        }),
        sourceUrlChanged: true,
      })
    }

    preloadImage.src = incomingSourceUrl

    return () => {
      isCancelled = true
    }
  }, [
    attachment,
    attachmentState,
    debugPayload,
    incomingSourceType,
    incomingSourceUrl,
    message,
    onImageLoad,
    previewFailedToLoad,
    renderKey,
    shouldKeepPreviewVisibleWhileRemoteLoads,
    tileIndex,
  ])

  useEffect(() => {
    const node = tileRef.current

    if (!node || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const nextHeight = Math.round(entries[0]?.contentRect.height ?? node.getBoundingClientRect().height)
      const previousHeight = previousHeightRef.current

      if (previousHeight !== null && previousHeight !== nextHeight) {
        logChatSendDebug('attachment_layout_shift', {
          ...(latestPayloadRef.current ?? debugPayload),
          previousHeight,
          nextHeight,
          sourceType: effectiveSourceType,
          visualState,
        })
      }

      previousHeightRef.current = nextHeight
    })

    observer.observe(node)

    return () => {
      observer.disconnect()
    }
  }, [debugPayload, effectiveSourceType, visualState])

  return (
    <button
      ref={tileRef}
      type="button"
      onClick={canOpenAttachment ? () => onImageClick?.(attachments, tileIndex) : undefined}
      disabled={!canOpenAttachment}
      className={className}
      style={style}
      aria-label={
        isFailedAttachment
          ? `Не удалось загрузить изображение ${tileIndex + 1}`
          : `Открыть изображение ${tileIndex + 1}`
      }
    >
      {canShowImage && canBeginCurrentImageLoad ? (
        <img
          ref={imgRef}
          src={displayedSourceUrl ?? undefined}
          alt={`Вложение ${tileIndex + 1}`}
          loading={shouldGateRemoteImageLoad ? 'lazy' : 'eager'}
          decoding="async"
          onLoad={() => {
            if (!displayedSourceUrl) {
              return
            }

            if (loadSucceededSourceUrlRef.current !== displayedSourceUrl) {
              loadSucceededSourceUrlRef.current = displayedSourceUrl
              markRemoteAttachmentSourceLoadedInSession(message, attachment, displayedSourceUrl)
              logChatSendDebug('attachment_img_load_success', {
                ...(latestPayloadRef.current ?? debugPayload),
                visualState: getAttachmentDebugVisualState({
                  sourceType: displayedSourceType,
                  attachmentState,
                  previewFailedToLoad,
                  hasLoadedCurrentSource: true,
                }),
              })
            }

            setLoadedDisplayedSourceUrl(displayedSourceUrl)

            if (
              displayedSourceType === 'remote_public_url' &&
              notifiedImageLoadSourceUrlRef.current !== displayedSourceUrl
            ) {
              notifiedImageLoadSourceUrlRef.current = displayedSourceUrl
              onImageLoad?.(message, attachment.sortOrder, displayedSourceUrl)
            }
          }}
          onError={() => {
            const isSoftLocalPreviewError = Boolean(
              displayedSourceType === 'local_preview' &&
              displayedSourceUrl &&
              attachmentState !== 'failed' &&
              (incomingSourceType === 'remote_public_url' || attachmentState !== 'attached')
            )

            logChatSendDebug('attachment_img_load_error', {
              ...(latestPayloadRef.current ?? debugPayload),
              visualState: isSoftLocalPreviewError
                ? (incomingSourceType === 'remote_public_url' ? 'loading_remote' : 'blank')
                : 'error',
            })

            if (isSoftLocalPreviewError && displayedSourceUrl) {
              setSoftPreviewLoadErrorSourceUrl(displayedSourceUrl)
              return
            }

            if (
              displayedSourceType === 'remote_public_url' &&
              preservedPreviewUrlRef.current &&
              preservedPreviewUrlRef.current !== displayedSourceUrl
            ) {
              if (softPreviewLoadErrorSourceUrl === preservedPreviewUrlRef.current) {
                onPreviewError(attachment.id)
                return
              }

              setDisplayedSourceUrl(preservedPreviewUrlRef.current)
              setDisplayedSourceType('local_preview')
              setLoadedDisplayedSourceUrl(preservedPreviewUrlRef.current)
              return
            }

            onPreviewError(attachment.id)
          }}
          className={`h-full w-full object-cover transition duration-300 ${
            shouldShowRemoteLoadingPlaceholder
              ? 'opacity-0'
              : attachmentState === 'uploading' || attachmentState === 'uploaded'
                ? 'scale-[1.01] opacity-85 blur-[1px]'
                : 'opacity-100'
          }`}
        />
      ) : null}

      {shouldShowRemoteLoadingPlaceholder ? (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 block bg-slate-200/85 dark:bg-slate-800/85"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 block bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_55%)] dark:bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_55%)]"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 block animate-pulse bg-gradient-to-r from-white/0 via-white/35 to-white/0 dark:via-white/10"
          />
        </>
      ) : null}

      {!canShowImage ? (
        <span
          aria-hidden="true"
          className={`absolute inset-0 block ${
            isFailedAttachment
              ? 'bg-red-100/90 dark:bg-red-950/50'
              : 'bg-black/[0.04] dark:bg-white/[0.07]'
          }`}
        />
      ) : null}

      {attachmentState === 'uploading' || attachmentState === 'uploaded' ? (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/0 via-white/25 to-white/0 opacity-80 animate-pulse dark:via-white/15"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-black/10 dark:bg-black/20"
          />
          <span className="pointer-events-none absolute inset-x-0 bottom-0 top-auto h-12 bg-gradient-to-t from-black/30 to-transparent" />
          <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/38 px-2 py-1 text-[10px] font-medium leading-none text-white backdrop-blur-[2px]">
            <span className="h-1.5 w-1.5 rounded-full bg-white/90 animate-pulse" />
            {attachmentState === 'uploaded' ? 'Обработка' : 'Загрузка'}
          </span>
        </>
      ) : null}

      {isFailedAttachment ? (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-red-950/12 dark:bg-red-950/35"
          />
          <span className="pointer-events-none absolute inset-x-2 bottom-2 rounded-xl bg-red-600/90 px-2 py-1 text-center text-[10px] font-medium leading-tight text-white shadow-sm dark:bg-red-500/90">
            Не удалось загрузить
          </span>
        </>
      ) : null}
    </button>
  )
}

function serverImageMessageMissingReliableAttachmentUrls(serverMessage: ChatMessageItem): boolean {
  if (serverMessage.messageType !== 'image') {
    return false
  }

  if (serverMessage.attachments.length === 0) {
    return true
  }

  return !serverMessage.attachments.some(
    (attachment) =>
      Boolean(attachment.publicUrl?.trim()) && !isLocalOrTransientImageUrl(attachment.publicUrl)
  )
}

function hasBlobOrDataPreviewAttachments(message: ChatMessageItem): boolean {
  return message.attachments.some((attachment) => isLocalOrTransientImageUrl(attachment.publicUrl))
}

function shouldMergeIncompleteSenderImageHydration(
  prevMessage: ChatMessageItem,
  serverMessage: ChatMessageItem,
  currentUserId: string | null
): boolean {
  if (!currentUserId || serverMessage.userId !== currentUserId || prevMessage.userId !== currentUserId) {
    return false
  }

  if (serverMessage.messageType !== 'image' || prevMessage.messageType !== 'image') {
    return false
  }

  if (!serverImageMessageMissingReliableAttachmentUrls(serverMessage)) {
    return false
  }

  if (hasPendingOptimisticImageAttachments(prevMessage)) {
    return true
  }

  const taskMessageId = prevMessage.optimisticServerMessageId ?? prevMessage.id

  if (taskMessageId && hasPendingChatMediaTask(taskMessageId)) {
    return true
  }

  return hasBlobOrDataPreviewAttachments(prevMessage)
}

function getAttachmentStatesForImageMerge(
  optimisticMessage: ChatMessageItem,
  serverMessage: ChatMessageItem,
  currentUserId: string | null
): Array<'pending' | 'uploading' | 'uploaded' | 'attached' | 'failed'> | null {
  if (hasPendingOptimisticImageAttachments(optimisticMessage)) {
    return getOptimisticAttachmentStates(optimisticMessage)
  }

  if (
    shouldMergeIncompleteSenderImageHydration(optimisticMessage, serverMessage, currentUserId) &&
    optimisticMessage.attachments.length > 0
  ) {
    return optimisticMessage.attachments.map(() => 'uploaded' as const)
  }

  return null
}

function mergeServerMessageWithOptimisticImageState(
  optimisticMessage: ChatMessageItem,
  serverMessage: ChatMessageItem,
  currentUserId: string | null
): ChatMessageItem {
  if (optimisticMessage.id !== serverMessage.id) {
    return {
      ...serverMessage,
      optimisticRenderKey: optimisticMessage.optimisticRenderKey ?? optimisticMessage.id,
    }
  }

  const nextStates = getAttachmentStatesForImageMerge(optimisticMessage, serverMessage, currentUserId)

  if (!nextStates) {
    return {
      ...serverMessage,
      optimisticRenderKey: optimisticMessage.optimisticRenderKey ?? optimisticMessage.id,
    }
  }

  const optimisticAttachmentsBySortOrder = new Map(
    optimisticMessage.attachments.map((attachment) => [attachment.sortOrder, attachment])
  )
  const serverAttachmentsBySortOrder = new Map(
    serverMessage.attachments.map((attachment) => [attachment.sortOrder, attachment])
  )
  const maxAttachmentCount = Math.max(
    optimisticMessage.attachments.length,
    serverMessage.attachments.length,
    nextStates.length
  )
  const mergedAttachments: ChatMessageAttachment[] = []

  for (let sortOrder = 0; sortOrder < maxAttachmentCount; sortOrder += 1) {
    const serverAttachment = serverAttachmentsBySortOrder.get(sortOrder) ?? null
    const optimisticAttachment = optimisticAttachmentsBySortOrder.get(sortOrder) ?? null
    const serverHasReliablePublicUrl =
      Boolean(serverAttachment?.publicUrl?.trim()) &&
      !isLocalOrTransientImageUrl(serverAttachment?.publicUrl)

    if (serverAttachment && serverHasReliablePublicUrl) {
      mergedAttachments.push(serverAttachment)
      nextStates[sortOrder] = 'attached'
      continue
    }

    if (optimisticAttachment && nextStates[sortOrder] && nextStates[sortOrder] !== 'attached') {
      mergedAttachments.push(optimisticAttachment)
    }
  }

  const hasPendingAttachments = nextStates.some((state) => state !== 'attached')

  if (!hasPendingAttachments) {
    return {
      ...serverMessage,
      optimisticRenderKey: optimisticMessage.optimisticRenderKey ?? optimisticMessage.id,
    }
  }

  const overallAttachmentUploadState = deriveOptimisticAttachmentUploadState(nextStates)

  return {
    ...serverMessage,
    attachments: mergedAttachments,
    imageUrl: mergedAttachments[0]?.publicUrl ?? serverMessage.imageUrl,
    optimisticRenderKey: optimisticMessage.optimisticRenderKey ?? optimisticMessage.id,
    isOptimistic: true,
    optimisticStatus: undefined,
    optimisticServerMessageId: optimisticMessage.optimisticServerMessageId ?? serverMessage.id,
    optimisticLocalObjectUrl: null,
    optimisticImageFiles: optimisticMessage.optimisticImageFiles ?? null,
    optimisticAttachmentUploadState: overallAttachmentUploadState,
    optimisticAttachmentStates: nextStates,
  }
}

function mergeMessageWithPendingMediaTaskState(message: ChatMessageItem): ChatMessageItem {
  if (message.messageType !== 'image') {
    return message
  }

  const taskMessageId = message.optimisticServerMessageId ?? message.id
  const pendingTask = taskMessageId ? getPendingChatMediaTask(taskMessageId) : null

  if (!pendingTask || pendingTask.attachments.length === 0) {
    return message
  }

  const serverAttachmentsBySortOrder = new Map(
    message.attachments.map((attachment) => [attachment.sortOrder, attachment])
  )
  const nextAttachments: ChatMessageAttachment[] = []
  const nextAttachmentStates: NonNullable<ChatMessageItem['optimisticAttachmentStates']> = []
  const maxAttachmentCount = Math.max(message.attachments.length, pendingTask.attachments.length)

  for (let sortOrder = 0; sortOrder < maxAttachmentCount; sortOrder += 1) {
    const serverAttachment = serverAttachmentsBySortOrder.get(sortOrder) ?? null
    const taskAttachment = pendingTask.attachments.find((attachment) => attachment.sortOrder === sortOrder) ?? null

    if (serverAttachment) {
      nextAttachments.push(serverAttachment)
      nextAttachmentStates[sortOrder] = 'attached'
      continue
    }

    if (!taskAttachment) {
      continue
    }

    nextAttachmentStates[sortOrder] = taskAttachment.state

    const nextPublicUrl = taskAttachment.publicUrl ?? taskAttachment.previewUrl

    if (!nextPublicUrl) {
      continue
    }

    nextAttachments.push({
      id: taskAttachment.id,
      type: 'image',
      storagePath: taskAttachment.storagePath,
      publicUrl: nextPublicUrl,
      width: taskAttachment.width,
      height: taskAttachment.height,
      sortOrder: taskAttachment.sortOrder,
    })
  }

  if (nextAttachmentStates.length === 0) {
    return message
  }

  const overallAttachmentUploadState = deriveOptimisticAttachmentUploadState(nextAttachmentStates)

  return {
    ...message,
    attachments: nextAttachments.length > 0 ? nextAttachments : message.attachments,
    imageUrl: nextAttachments[0]?.publicUrl ?? message.imageUrl,
    isOptimistic: message.id.startsWith('temp-'),
    optimisticStatus: pendingTask.messageId && taskMessageId === pendingTask.messageId
      ? (message.id.startsWith('temp-') && !message.optimisticServerMessageId ? message.optimisticStatus : undefined)
      : message.optimisticStatus,
    optimisticServerMessageId: message.optimisticServerMessageId ?? (taskMessageId !== message.id ? taskMessageId : null),
    optimisticAttachmentUploadState: overallAttachmentUploadState,
    optimisticAttachmentStates: nextAttachmentStates,
  }
}

function finalizeOptimisticMessageFromRealtimeRow(
  optimisticMessage: ChatMessageItem,
  realtimeRow: RealtimeChatMessageRow
): ChatMessageItem {
  const messageType = resolveRealtimeMessageType(realtimeRow)
  const attachments = messageType === 'image'
    ? (
        optimisticMessage.attachments.length > 0
          ? optimisticMessage.attachments
          : realtimeRow.image_url
            ? [{
                id: `legacy-${realtimeRow.id}`,
                type: 'image' as const,
                storagePath: null,
                publicUrl: realtimeRow.image_url,
                width: null,
                height: null,
                sortOrder: 0,
              }]
            : []
      )
    : []
  const imageUrl = attachments[0]?.publicUrl ?? realtimeRow.image_url ?? null

  return {
    ...optimisticMessage,
    id: realtimeRow.id,
    userId: realtimeRow.user_id,
    text: realtimeRow.text ?? '',
    messageType,
    imageUrl,
    attachments,
    mediaUrl: realtimeRow.media_url ?? null,
    mediaDurationSeconds: realtimeRow.media_duration_seconds ?? optimisticMessage.mediaDurationSeconds,
    editedAt: realtimeRow.edited_at ?? null,
    createdAt: realtimeRow.created_at,
    createdAtLabel: 'Сейчас',
    replyToId: realtimeRow.reply_to_id,
    previewText: getRealtimePreviewText(realtimeRow, optimisticMessage),
    optimisticRenderKey: optimisticMessage.optimisticRenderKey ?? optimisticMessage.id,
    isOptimistic: false,
    optimisticStatus: undefined,
    optimisticServerMessageId: null,
    optimisticLocalObjectUrl: null,
    optimisticImageFiles: null,
    optimisticAttachmentUploadState: null,
  }
}

function findMatchingOptimisticTextOrImageMessageForRealtime(
  messages: ChatMessageItem[],
  realtimeRow: RealtimeChatMessageRow
) {
  if (resolveRealtimeMessageType(realtimeRow) === 'voice') {
    return null
  }

  const nextMessageCreatedAtMs = new Date(realtimeRow.created_at).getTime()
  const nextMessageType = resolveRealtimeMessageType(realtimeRow)

  const matchingOptimisticMessages = messages.filter((message) => {
    if (!message.isOptimistic || message.messageType === 'voice') {
      return false
    }

    const messageCreatedAtMs = new Date(message.createdAt).getTime()

    return (
      message.userId === realtimeRow.user_id &&
      message.text === (realtimeRow.text ?? '') &&
      message.messageType === nextMessageType &&
      (realtimeRow.image_url ? message.imageUrl === realtimeRow.image_url : true) &&
      message.replyToId === realtimeRow.reply_to_id &&
      Math.abs(messageCreatedAtMs - nextMessageCreatedAtMs) <= OPTIMISTIC_MESSAGE_MATCH_WINDOW_MS
    )
  })

  if (matchingOptimisticMessages.length === 0) {
    return null
  }

  return matchingOptimisticMessages
    .slice()
    .sort((left, right) => {
      const leftCreatedAtMs = Math.abs(new Date(left.createdAt).getTime() - nextMessageCreatedAtMs)
      const rightCreatedAtMs = Math.abs(new Date(right.createdAt).getTime() - nextMessageCreatedAtMs)
      return leftCreatedAtMs - rightCreatedAtMs
    })[0] ?? null
}

function createOptimisticMessageId(prefix: 'text' | 'image') {
  return `temp-${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function toggleReactionOnMessage(
  message: ChatMessageItem,
  userId: string,
  emoji: string,
  reactorProfile: {
    displayName: string
    avatarUrl: string | null
  },
  shouldActivate?: boolean
) {
  const existingReaction = message.reactions.find((reaction) => reaction.emoji === emoji) ?? null
  const hasReacted = existingReaction?.userIds.includes(userId) ?? false
  const nextIsActive = shouldActivate ?? !hasReacted

  if (nextIsActive === hasReacted) {
    return message
  }

  let nextReactions = message.reactions.map((reaction) => ({
    ...reaction,
    userIds: [...reaction.userIds],
    reactors: [...reaction.reactors],
  }))

  if (nextIsActive) {
    if (existingReaction) {
      nextReactions = nextReactions.map((reaction) =>
        reaction.emoji === emoji
          ? {
              ...reaction,
              count: reaction.count + 1,
              userIds: reaction.userIds.includes(userId) ? reaction.userIds : [...reaction.userIds, userId],
              reactors: reaction.reactors.some((reactor) => reactor.userId === userId)
                ? reaction.reactors
                : [
                    ...reaction.reactors,
                    {
                      userId,
                      displayName: reactorProfile.displayName,
                      avatarUrl: reactorProfile.avatarUrl,
                    },
                  ],
            }
          : reaction
      )
    } else {
      nextReactions = [
        ...nextReactions,
        {
          emoji,
          count: 1,
          userIds: [userId],
          reactors: [
            {
              userId,
              displayName: reactorProfile.displayName,
              avatarUrl: reactorProfile.avatarUrl,
            },
          ],
        },
      ]
    }
  } else {
    nextReactions = nextReactions
      .map((reaction) =>
        reaction.emoji === emoji
          ? {
              ...reaction,
              count: Math.max(0, reaction.count - 1),
              userIds: reaction.userIds.filter((currentUserId) => currentUserId !== userId),
              reactors: reaction.reactors.filter((reactor) => reactor.userId !== userId),
            }
          : reaction
      )
      .filter((reaction) => reaction.count > 0)
  }

  const emojiOrder = ['👍', '❤️', '🔥', '😂', '👏', '😢', '😮']
  nextReactions.sort((left, right) => {
    const leftOrder = emojiOrder.indexOf(left.emoji)
    const rightOrder = emojiOrder.indexOf(right.emoji)

    if (leftOrder !== -1 || rightOrder !== -1) {
      if (leftOrder === -1) return 1
      if (rightOrder === -1) return -1
      return leftOrder - rightOrder
    }

    return left.emoji.localeCompare(right.emoji)
  })

  return {
    ...message,
    reactions: nextReactions,
  }
}

function updateMessageReaction(
  messages: ChatMessageItem[],
  messageId: string,
  userId: string,
  emoji: string,
  reactorProfile: {
    displayName: string
    avatarUrl: string | null
  },
  shouldActivate?: boolean
) {
  return messages.map((message) =>
    message.id === messageId ? toggleReactionOnMessage(message, userId, emoji, reactorProfile, shouldActivate) : message
  )
}

function ReactionChip({
  reactionKey,
  emoji,
  count,
  reactors,
  isSelected,
  disabled,
  shouldBurst,
  onToggle,
  onOpenDetails,
  compact = false,
}: {
  reactionKey: string
  emoji: string
  count: number
  reactors: { userId: string; displayName: string; avatarUrl: string | null }[]
  isSelected: boolean
  disabled: boolean
  shouldBurst: boolean
  onToggle: (event: React.MouseEvent<HTMLButtonElement>) => void
  onOpenDetails?: (event: React.MouseEvent<HTMLButtonElement>) => void
  compact?: boolean
}) {
  const [burstPhase, setBurstPhase] = useState<'idle' | 'start' | 'end'>('idle')

  useEffect(() => {
    if (!shouldBurst) {
      return
    }

    let startFrameId: number | null = null
    let endFrameId: number | null = null
    const timeoutId = window.setTimeout(() => {
      setBurstPhase('idle')
    }, REACTION_ANIMATION_DURATION_MS + 30)

    startFrameId = window.requestAnimationFrame(() => {
      setBurstPhase('start')
      endFrameId = window.requestAnimationFrame(() => {
        setBurstPhase('end')
      })
    })

    return () => {
      if (startFrameId !== null) {
        window.cancelAnimationFrame(startFrameId)
      }

      if (endFrameId !== null) {
        window.cancelAnimationFrame(endFrameId)
      }

      window.clearTimeout(timeoutId)
    }
  }, [reactionKey, shouldBurst])

  const isBursting = burstPhase !== 'idle'
  const shouldOpenDetails = count > 1 && Boolean(onOpenDetails)
  const visibleReactors = compact ? [] : reactors.slice(0, Math.min(2, reactors.length))
  const singleReactor = !compact && count === 1 ? reactors[0] ?? null : null

  return (
    <button
      type="button"
      onClick={(event) => {
        if (shouldOpenDetails) {
          onOpenDetails?.(event)
          return
        }

        onToggle(event)
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      disabled={disabled}
      className={`relative inline-flex items-center overflow-visible rounded-full font-medium transition-transform duration-200 ease-out ${
        compact ? 'gap-0.5 px-1.5 py-[2px] text-[10px]' : 'min-h-[22px] gap-0.5 px-2 py-[2px] text-[10px]'
      } ${
        isSelected
          ? 'bg-black/[0.08] text-black dark:bg-white/[0.16] dark:text-white'
          : 'bg-black/[0.04] text-black/75 dark:bg-white/[0.08] dark:text-white/75'
      } ${
        disabled
          ? 'cursor-default'
          : 'hover:scale-[1.03] active:scale-95 active:bg-black/[0.1] dark:active:bg-white/[0.18]'
      } ${isBursting ? 'scale-[1.06]' : ''}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-1/2 top-1/2 z-[1] -translate-x-1/2 transition-all duration-200 ease-out ${
          compact ? 'text-[10px]' : 'text-[12px]'
        } ${
          burstPhase === 'start'
            ? '-translate-y-1 scale-95 opacity-90'
            : burstPhase === 'end'
              ? '-translate-y-5 scale-125 opacity-0'
              : 'translate-y-0 scale-75 opacity-0'
        }`}
      >
        {emoji}
      </span>
      {singleReactor ? (
        <TinyUserAvatar
          avatarUrl={singleReactor.avatarUrl}
          displayName={singleReactor.displayName}
          className="h-4 w-4"
        />
      ) : visibleReactors.length > 0 ? (
        <span className="relative mr-0.5 flex h-4 w-5.5 shrink-0 items-center">
          {visibleReactors.map((reactor, index) => (
            <span
              key={`${reactionKey}:${reactor.userId}`}
              className="absolute top-1/2 -translate-y-1/2"
              style={{ left: `${index * 7}px` }}
            >
              <TinyUserAvatar
                avatarUrl={reactor.avatarUrl}
                displayName={reactor.displayName}
                className="h-4 w-4"
              />
            </span>
          ))}
        </span>
      ) : null}
      <span className="relative z-[2]">{emoji}</span>
      <span className="relative z-[2]">{count}</span>
    </button>
  )
}

function formatVoiceMessageLabel(durationSeconds: number | null) {
  if (typeof durationSeconds !== 'number' || durationSeconds <= 0) {
    return 'Голосовое сообщение'
  }

  return `Голосовое сообщение • ${durationSeconds} сек`
}

function formatVoiceMessageDuration(durationSeconds: number | null) {
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return '--:--'
  }

  const totalSeconds = Math.max(0, Math.round(durationSeconds))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatRecordingTime(durationSeconds: number) {
  const totalSeconds = Math.max(0, Math.round(durationSeconds))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function buildVoiceWaveformBars(seed: string, count = 24) {
  const safeSeed = seed || 'voice'

  return Array.from({ length: count }, (_, index) => {
    const seedCharacterCode = safeSeed.charCodeAt(index % safeSeed.length) || 37
    return 20 + ((seedCharacterCode * (index + 3)) % 65)
  })
}

function PlayIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M8 6.5v11l9-5.5-9-5.5Z" />
    </svg>
  )
}

function PauseIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M7 6h4v12H7zM13 6h4v12h-4z" />
    </svg>
  )
}

function MicIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
    </svg>
  )
}

function CloseIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6 18 18" />
      <path d="M18 6 6 18" />
    </svg>
  )
}

function CheckIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  )
}

type TouchPointLike = {
  clientX: number
  clientY: number
}

function FullscreenImageViewer({
  images,
  initialIndex,
  onClose,
}: {
  images: ChatMessageAttachment[]
  initialIndex: number
  onClose: () => void
}) {
  const [isVisible, setIsVisible] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(() => {
    if (images.length === 0) {
      return 0
    }

    return Math.min(Math.max(initialIndex, 0), images.length - 1)
  })
  const [scale, setScale] = useState(1)
  const [translateX, setTranslateX] = useState(0)
  const [translateY, setTranslateY] = useState(0)
  const [dismissTranslateY, setDismissTranslateY] = useState(0)
  const [isGesturing, setIsGesturing] = useState(false)
  const gestureStateRef = useRef<{
    mode: 'idle' | 'pan' | 'pinch' | 'dismiss'
    startScale: number
    startTranslateX: number
    startTranslateY: number
    startDismissTranslateY: number
    startTouchX: number
    startTouchY: number
    startDistance: number
    hasMoved: boolean
    lastDeltaX: number
    lastDeltaY: number
  }>({
    mode: 'idle',
    startScale: 1,
    startTranslateX: 0,
    startTranslateY: 0,
    startDismissTranslateY: 0,
    startTouchX: 0,
    startTouchY: 0,
    startDistance: 0,
    hasMoved: false,
    lastDeltaX: 0,
    lastDeltaY: 0,
  })
  const lastTapRef = useRef<{ time: number }>({ time: 0 })
  const currentImage = images[currentIndex] ?? images[0] ?? null
  const hasMultipleImages = images.length > 1

  function clampValue(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max)
  }

  function clampZoom(nextScale: number) {
    return clampValue(nextScale, 1, 4)
  }

  function clampTranslation(nextScale: number, nextTranslateX: number, nextTranslateY: number) {
    const maxOffsetX = Math.max(0, ((typeof window !== 'undefined' ? window.innerWidth : 390) * (nextScale - 1)) / 2)
    const maxOffsetY = Math.max(0, ((typeof window !== 'undefined' ? window.innerHeight : 844) * (nextScale - 1)) / 2)

    return {
      translateX: clampValue(nextTranslateX, -maxOffsetX, maxOffsetX),
      translateY: clampValue(nextTranslateY, -maxOffsetY, maxOffsetY),
    }
  }

  function resetViewerTransform() {
    setScale(1)
    setTranslateX(0)
    setTranslateY(0)
    setDismissTranslateY(0)
  }

  function getTouchDistance(touchA: TouchPointLike, touchB: TouchPointLike) {
    return Math.hypot(touchA.clientX - touchB.clientX, touchA.clientY - touchB.clientY)
  }

  function showPreviousImage() {
    if (!hasMultipleImages) {
      return
    }

    resetViewerTransform()
    setCurrentIndex((current) => (current - 1 + images.length) % images.length)
  }

  function showNextImage() {
    if (!hasMultipleImages) {
      return
    }

    resetViewerTransform()
    setCurrentIndex((current) => (current + 1) % images.length)
  }

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow
    const previousDocumentOverflow = document.documentElement.style.overflow

    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    const animationFrameId = window.requestAnimationFrame(() => {
      setIsVisible(true)
    })

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousDocumentOverflow
    }
  }, [onClose])

  function handleImageTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    if (event.touches.length === 2) {
      const [firstTouch, secondTouch] = [event.touches[0], event.touches[1]]

      if (!firstTouch || !secondTouch) {
        return
      }

      gestureStateRef.current = {
        mode: 'pinch',
        startScale: scale,
        startTranslateX: translateX,
        startTranslateY: translateY,
        startDismissTranslateY: dismissTranslateY,
        startTouchX: 0,
        startTouchY: 0,
        startDistance: getTouchDistance(firstTouch, secondTouch),
        hasMoved: false,
        lastDeltaX: 0,
        lastDeltaY: 0,
      }
      setIsGesturing(true)
      return
    }

    const firstTouch = event.touches[0]

    if (!firstTouch) {
      return
    }

    gestureStateRef.current = {
      mode: scale > 1 ? 'pan' : 'dismiss',
      startScale: scale,
      startTranslateX: translateX,
      startTranslateY: translateY,
      startDismissTranslateY: dismissTranslateY,
      startTouchX: firstTouch.clientX,
      startTouchY: firstTouch.clientY,
      startDistance: 0,
      hasMoved: false,
      lastDeltaX: 0,
      lastDeltaY: 0,
    }
    setIsGesturing(true)
  }

  function handleImageTouchMove(event: ReactTouchEvent<HTMLDivElement>) {
    const gestureState = gestureStateRef.current

    if (gestureState.mode === 'pinch' && event.touches.length === 2) {
      const [firstTouch, secondTouch] = [event.touches[0], event.touches[1]]

      if (!firstTouch || !secondTouch || gestureState.startDistance <= 0) {
        return
      }

      const nextScale = clampZoom(gestureState.startScale * (getTouchDistance(firstTouch, secondTouch) / gestureState.startDistance))
      gestureState.hasMoved = true
      const clampedTranslation = clampTranslation(nextScale, translateX, translateY)
      setScale(nextScale)
      setTranslateX(clampedTranslation.translateX)
      setTranslateY(clampedTranslation.translateY)
      return
    }

    const firstTouch = event.touches[0]

    if (!firstTouch) {
      return
    }

    const deltaX = firstTouch.clientX - gestureState.startTouchX
    const deltaY = firstTouch.clientY - gestureState.startTouchY
    gestureState.lastDeltaX = deltaX
    gestureState.lastDeltaY = deltaY
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
      gestureState.hasMoved = true
    }

    if (gestureState.mode === 'pan' && gestureState.startScale > 1) {
      const clampedTranslation = clampTranslation(
        gestureState.startScale,
        gestureState.startTranslateX + deltaX,
        gestureState.startTranslateY + deltaY
      )
      setTranslateX(clampedTranslation.translateX)
      setTranslateY(clampedTranslation.translateY)
      return
    }

    if (gestureState.mode === 'dismiss' && gestureState.startScale === 1) {
      if (Math.abs(deltaX) > Math.abs(deltaY) + 10) {
        setDismissTranslateY(0)
        return
      }

      setDismissTranslateY(Math.max(0, gestureState.startDismissTranslateY + deltaY))
    }
  }

  function handleImageTouchEnd() {
    const gestureState = gestureStateRef.current
    const dismissThreshold = 120

    if (gestureState.mode === 'dismiss') {
      if (
        hasMultipleImages &&
        Math.abs(gestureState.lastDeltaX) > 56 &&
        Math.abs(gestureState.lastDeltaX) > Math.abs(gestureState.lastDeltaY) + 12
      ) {
        if (gestureState.lastDeltaX < 0) {
          showNextImage()
        } else {
          showPreviousImage()
        }

        setDismissTranslateY(0)
        gestureStateRef.current.mode = 'idle'
        setIsGesturing(false)
        return
      }

      if (dismissTranslateY > dismissThreshold) {
        onClose()
        return
      }

      setDismissTranslateY(0)
    }

    if (scale <= 1) {
      setScale(1)
      setTranslateX(0)
      setTranslateY(0)
    } else {
      const clampedTranslation = clampTranslation(scale, translateX, translateY)
      setTranslateX(clampedTranslation.translateX)
      setTranslateY(clampedTranslation.translateY)
    }

    gestureStateRef.current.mode = 'idle'
    setIsGesturing(false)
  }

  function handleImageDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    event.stopPropagation()

    if (scale > 1) {
      resetViewerTransform()
      return
    }

    setScale(2)
    setTranslateX(0)
    setTranslateY(0)
    setDismissTranslateY(0)
  }

  function handleImageClick(event: React.MouseEvent<HTMLDivElement>) {
    event.stopPropagation()
  }

  function handleImageTouchTap(event: ReactTouchEvent<HTMLDivElement>) {
    if (event.touches.length > 0 || gestureStateRef.current.hasMoved) {
      return
    }

    const now = Date.now()

    if (now - lastTapRef.current.time < 280) {
      if (scale > 1) {
        resetViewerTransform()
      } else {
        setScale(2)
        setTranslateX(0)
        setTranslateY(0)
        setDismissTranslateY(0)
      }
      lastTapRef.current.time = 0
      return
    }

    lastTapRef.current.time = now
  }

  const overlayOpacity = clampValue(1 - dismissTranslateY / 220, 0.45, 1)
  const imageTransform = `translate3d(${translateX}px, ${translateY + dismissTranslateY}px, 0) scale(${scale})`

  if (!currentImage) {
    return null
  }

  return (
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center p-3 transition-opacity duration-150 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ backgroundColor: `rgba(0, 0, 0, ${0.95 * overlayOpacity})` }}
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Закрыть изображение"
        className="absolute right-4 top-4 z-[81] flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-transform duration-150 active:scale-95"
        onClick={onClose}
      >
        <CloseIcon className="h-5 w-5" />
      </button>
      {hasMultipleImages ? (
        <>
          <div className="absolute left-1/2 top-4 z-[81] -translate-x-1/2 rounded-full bg-black/35 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
            {currentIndex + 1} / {images.length}
          </div>
          <button
            type="button"
            aria-label="Предыдущее изображение"
            className="absolute left-3 top-1/2 z-[81] hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-transform duration-150 active:scale-95 md:flex"
            onClick={(event) => {
              event.stopPropagation()
              showPreviousImage()
            }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Следующее изображение"
            className="absolute right-3 top-1/2 z-[81] hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-transform duration-150 active:scale-95 md:flex"
            onClick={(event) => {
              event.stopPropagation()
              showNextImage()
            }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </>
      ) : null}
      <div
        className={`flex max-h-full max-w-full items-center justify-center ${
          isGesturing ? '' : 'transition-transform duration-200'
        } ${
          isVisible ? 'scale-100' : 'scale-[0.985]'
        }`}
        style={{
          transform: `${isVisible ? '' : 'scale(0.985) '}${imageTransform}`.trim(),
          touchAction: 'none',
        }}
        onClick={handleImageClick}
        onDoubleClick={handleImageDoubleClick}
        onTouchStart={handleImageTouchStart}
        onTouchMove={handleImageTouchMove}
        onTouchEnd={(event) => {
          handleImageTouchEnd()
          handleImageTouchTap(event)
        }}
        onTouchCancel={handleImageTouchEnd}
      >
        <img
          src={currentImage.publicUrl}
          alt="Полноразмерное изображение"
          className="max-h-[calc(100svh-1.5rem)] max-w-[calc(100vw-1.5rem)] object-contain"
        />
      </div>
    </div>
  )
}

function VoiceMessageAudio({
  storagePath,
  durationSeconds,
  isOwnMessage,
}: {
  storagePath: string
  durationSeconds: number | null
  isOwnMessage: boolean
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [resolvedDurationSeconds, setResolvedDurationSeconds] = useState<number | null>(durationSeconds)
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0)
  const [displayedCurrentTimeSeconds, setDisplayedCurrentTimeSeconds] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState<(typeof VOICE_PLAYBACK_SPEEDS)[number]>(1)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playbackAnimationFrameRef = useRef<number | null>(null)
  const waveformBars = useMemo(() => buildVoiceWaveformBars(storagePath), [storagePath])
  const effectiveDurationSeconds =
    typeof resolvedDurationSeconds === 'number' && Number.isFinite(resolvedDurationSeconds) && resolvedDurationSeconds > 0
      ? resolvedDurationSeconds
      : durationSeconds
  const hasPlaybackProgress = displayedCurrentTimeSeconds > 0.05
  const playbackProgress = effectiveDurationSeconds && effectiveDurationSeconds > 0
    ? Math.min(1, displayedCurrentTimeSeconds / effectiveDurationSeconds)
    : 0
  const currentTimeLabel = formatVoiceMessageDuration(displayedCurrentTimeSeconds)
  const durationLabel = formatVoiceMessageDuration(effectiveDurationSeconds)
  const durationDisplayLabel = hasPlaybackProgress
    ? `${currentTimeLabel} / ${durationLabel}`
    : durationLabel
  const waveformOverlayWidthPercent = hasPlaybackProgress
    ? Math.max(playbackProgress * 100, isPlaying ? 2 : 0)
    : 0

  function syncPlaybackPosition(audio: HTMLAudioElement) {
    const nextTimeSeconds = audio.currentTime
    const nextDurationSeconds = audio.duration

    setCurrentTimeSeconds(nextTimeSeconds)
    setDisplayedCurrentTimeSeconds(nextTimeSeconds)

    if (Number.isFinite(nextDurationSeconds) && nextDurationSeconds > 0) {
      setResolvedDurationSeconds(nextDurationSeconds)
    }
  }

  useEffect(() => {
    let isMounted = true

    async function loadSignedUrl() {
      try {
        setLoadError(false)
        setSignedUrl(null)

        const { data, error } = await supabase.storage
          .from(CHAT_VOICE_BUCKET)
          .createSignedUrl(storagePath, CHAT_VOICE_SIGNED_URL_TTL_SECONDS)

        if (error) {
          throw error
        }

        if (isMounted) {
          setSignedUrl(data.signedUrl)
        }
      } catch (error) {
        console.error('Failed to create signed voice message URL', {
          storagePath,
          error,
        })

        if (isMounted) {
          setLoadError(true)
        }
      }
    }

    void loadSignedUrl()

    return () => {
      isMounted = false
    }
  }, [storagePath])

  useEffect(() => {
    setResolvedDurationSeconds(durationSeconds)
  }, [durationSeconds])

  useEffect(() => {
    if (!isPlaying) {
      setDisplayedCurrentTimeSeconds(currentTimeSeconds)
      if (playbackAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(playbackAnimationFrameRef.current)
        playbackAnimationFrameRef.current = null
      }
      return
    }

    function updateDisplayedPlaybackTime() {
      const audio = audioRef.current

      if (!audio) {
        playbackAnimationFrameRef.current = null
        return
      }

      setDisplayedCurrentTimeSeconds(audio.currentTime)
      playbackAnimationFrameRef.current = window.requestAnimationFrame(updateDisplayedPlaybackTime)
    }

    updateDisplayedPlaybackTime()

    return () => {
      if (playbackAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(playbackAnimationFrameRef.current)
        playbackAnimationFrameRef.current = null
      }
    }
  }, [isPlaying])

  useEffect(() => {
    return () => {
      if (playbackAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(playbackAnimationFrameRef.current)
      }
      if (activeVoiceMessageAudio === audioRef.current) {
        activeVoiceMessageAudio = null
      }
      audioRef.current?.pause()
    }
  }, [])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate
    }
  }, [playbackRate])

  async function handleTogglePlayback() {
    const audio = audioRef.current

    if (!audio || !signedUrl) {
      return
    }

    try {
      if (audio.src !== signedUrl) {
        audio.src = signedUrl
      }

      if (audio.paused) {
        if (activeVoiceMessageAudio && activeVoiceMessageAudio !== audio) {
          activeVoiceMessageAudio.pause()
        }

        activeVoiceMessageAudio = audio
        await audio.play()
        syncPlaybackPosition(audio)
        setIsPlaying(true)
        return
      }

      audio.pause()
      syncPlaybackPosition(audio)
      setIsPlaying(false)
    } catch (error) {
      console.error('Failed to toggle voice message playback', error)
    }
  }

  function handleCyclePlaybackSpeed() {
    setPlaybackRate((currentRate) => {
      const currentIndex = VOICE_PLAYBACK_SPEEDS.indexOf(currentRate)
      const nextIndex = (currentIndex + 1) % VOICE_PLAYBACK_SPEEDS.length
      return VOICE_PLAYBACK_SPEEDS[nextIndex] ?? 1
    })
  }

  function handleSeek(event: React.MouseEvent<HTMLButtonElement>) {
    const audio = audioRef.current

    if (!audio || !signedUrl || !effectiveDurationSeconds || effectiveDurationSeconds <= 0) {
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    const clickOffsetX = event.clientX - bounds.left
    const nextProgress = bounds.width > 0 ? Math.min(1, Math.max(0, clickOffsetX / bounds.width)) : 0
    const nextTimeSeconds = nextProgress * effectiveDurationSeconds

    if (audio.src !== signedUrl) {
      audio.src = signedUrl
    }

    audio.currentTime = nextTimeSeconds
    syncPlaybackPosition(audio)
  }

  if (loadError) {
    return <p className="mt-1 text-sm text-red-600">Не удалось загрузить голосовое сообщение</p>
  }

  return (
    <div
      className={`mt-1 flex w-full items-center gap-1.5 rounded-[18px] px-2 py-1 ${
        isOwnMessage
          ? 'bg-green-100 dark:bg-green-900/35'
          : 'bg-black/[0.04] dark:bg-white/[0.07]'
      }`}
    >
      <button
        type="button"
        onClick={handleTogglePlayback}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-[transform,background-color,box-shadow] duration-150 active:scale-95 ${
          isPlaying
            ? 'bg-emerald-600 text-white shadow-[0_3px_10px_rgba(5,150,105,0.28)] dark:bg-emerald-500'
            : 'bg-black/[0.08] text-black active:bg-black/[0.12] dark:bg-white/[0.14] dark:text-white dark:active:bg-white/[0.18]'
        }`}
        aria-label={isPlaying ? 'Пауза голосового сообщения' : 'Воспроизвести голосовое сообщение'}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon className="h-4 w-4 translate-x-[1px]" />}
      </button>
      <button
        type="button"
        onClick={handleSeek}
        className="relative flex h-7 min-w-0 flex-1 items-center gap-0.5"
        aria-label="Перемотать голосовое сообщение"
      >
        <span className="pointer-events-none absolute inset-0 flex items-center gap-0.5">
          {waveformBars.map((barHeight, index) => (
            <span
              key={`${storagePath}:base:${index}`}
              className={`w-1 rounded-full transition-colors ${
                isPlaying
                  ? 'bg-black/30 dark:bg-white/28'
                  : 'bg-black/20 dark:bg-white/20'
              }`}
              style={{ height: `${Math.max(7, Math.round((barHeight / 100) * 22))}px` }}
            />
          ))}
        </span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden"
          style={{ width: `${waveformOverlayWidthPercent}%` }}
        >
          <span className="absolute inset-0 flex items-center gap-0.5">
            {waveformBars.map((barHeight, index) => (
              <span
                key={`${storagePath}:progress:${index}`}
                className="w-1 rounded-full bg-emerald-700 transition-colors dark:bg-emerald-400"
                style={{ height: `${Math.max(7, Math.round((barHeight / 100) * 22))}px` }}
              />
            ))}
          </span>
        </span>
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-white/80 bg-emerald-600 shadow-[0_1px_4px_rgba(5,150,105,0.28)] transition-opacity dark:border-white/60 dark:bg-emerald-400 ${
            hasPlaybackProgress ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ left: `calc(${playbackProgress * 100}% - 5px)` }}
        />
      </button>
      <span className="shrink-0 text-[9px] font-medium tabular-nums text-black/55 dark:text-white/55">
        {durationDisplayLabel}
      </span>
      <button
        type="button"
        onClick={handleCyclePlaybackSpeed}
        className="shrink-0 rounded-full bg-black/[0.06] px-1.5 py-0.5 text-[10px] font-medium dark:bg-white/[0.12]"
        aria-label={`Скорость воспроизведения ${playbackRate}x`}
      >
        {playbackRate}x
      </button>
      <audio
        ref={audioRef}
        src={signedUrl ?? undefined}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) => {
          syncPlaybackPosition(event.currentTarget)
        }}
        onTimeUpdate={(event) => {
          syncPlaybackPosition(event.currentTarget)
        }}
        onDurationChange={(event) => {
          syncPlaybackPosition(event.currentTarget)
        }}
        onPause={(event) => {
          if (activeVoiceMessageAudio === event.currentTarget) {
            activeVoiceMessageAudio = null
          }
          syncPlaybackPosition(event.currentTarget)
          setIsPlaying(false)
        }}
        onPlay={() => {
          activeVoiceMessageAudio = audioRef.current
          if (audioRef.current) {
            syncPlaybackPosition(audioRef.current)
          }
          setIsPlaying(true)
        }}
        onEnded={(event) => {
          if (activeVoiceMessageAudio === event.currentTarget) {
            activeVoiceMessageAudio = null
          }
          setIsPlaying(false)
          setCurrentTimeSeconds(0)
          setDisplayedCurrentTimeSeconds(0)
          event.currentTarget.currentTime = 0
        }}
      />
    </div>
  )
}

function getGalleryGridClass(attachmentCount: number) {
  if (attachmentCount <= 4) {
    return 'grid-cols-2'
  }

  return 'grid-cols-3'
}

function getGalleryTileClass(attachmentCount: number, index: number) {
  if (attachmentCount === 3 && index === 0) {
    return 'row-span-2'
  }

  if ((attachmentCount === 5 || attachmentCount === 7) && index === 0) {
    return 'col-span-2 row-span-2'
  }

  return ''
}

function ChatImageAttachments({
  message,
  attachments,
  attachmentStates,
  createdAtLabel,
  isOwnMessage,
  isImageOnlyMessage,
  compactPreview,
  onImageClick,
  onImageLoad,
}: {
  message: ChatMessageItem
  attachments: ChatMessageAttachment[]
  attachmentStates?: ChatMessageItem['optimisticAttachmentStates']
  createdAtLabel: string
  isOwnMessage: boolean
  isImageOnlyMessage: boolean
  compactPreview: boolean
  onImageClick?: (attachments: ChatMessageAttachment[], index: number) => void
  onImageLoad?: (message: ChatMessageItem, sortOrder: number, publicUrl: string) => void
}) {
  const normalizedAttachmentStates = attachments.map((attachment, index) => (
    attachmentStates?.[index] ?? 'attached'
  ))
  const [failedPreviewIds, setFailedPreviewIds] = useState<Record<string, true>>({})
  const attachmentRenderKey = attachments.map((attachment) => `${attachment.id}:${attachment.publicUrl}`).join('|')
  const previousAttachmentDebugSnapshotRef = useRef<Record<string, {
    attachmentId: string | null
    sourceUrl: string | null
    sourceType: AttachmentDebugSourceType
  }>>({})

  useEffect(() => {
    setFailedPreviewIds({})
  }, [attachmentRenderKey])

  useEffect(() => {
    const nextSnapshot: Record<string, {
      attachmentId: string | null
      sourceUrl: string | null
      sourceType: AttachmentDebugSourceType
    }> = {}

    attachments.forEach((attachment, index) => {
      const slotKey = String(attachment.sortOrder ?? index)
      const sourceUrl = attachment.publicUrl?.trim() ? attachment.publicUrl : null
      const sourceType = getAttachmentDebugSourceType(sourceUrl)
      const previousSnapshot = previousAttachmentDebugSnapshotRef.current[slotKey]
      const nextPayload = buildAttachmentDebugPayload({
        message,
        attachment,
        tileIndex: index,
        renderKey: getAttachmentStableRenderKey(attachment, index),
        sourceType,
        sourceUrlChanged: Boolean(previousSnapshot && previousSnapshot.sourceUrl !== sourceUrl),
        visualState: getAttachmentDebugVisualState({
          sourceType,
          attachmentState: normalizedAttachmentStates[index] ?? 'attached',
          previewFailedToLoad: Boolean(failedPreviewIds[attachment.id]),
          hasLoadedCurrentSource: sourceType === 'local_preview',
        }),
      })

      if (previousSnapshot && previousSnapshot.attachmentId !== attachment.id) {
        logChatSendDebug('attachment_key_changed', nextPayload)
      }

      if (
        previousSnapshot &&
        (
          previousSnapshot.sourceUrl !== sourceUrl ||
          previousSnapshot.sourceType !== sourceType
        )
      ) {
        logChatSendDebug('attachment_source_changed', {
          ...nextPayload,
          sourceUrlChanged: previousSnapshot.sourceUrl !== sourceUrl,
        })
      }

      nextSnapshot[slotKey] = {
        attachmentId: attachment.id,
        sourceUrl,
        sourceType,
      }
    })

    previousAttachmentDebugSnapshotRef.current = nextSnapshot
  }, [attachments, failedPreviewIds, message, normalizedAttachmentStates])

  if (attachments.length === 0) {
    return null
  }

  const wrapperClassName = `relative mt-1 block overflow-hidden rounded-2xl ${
    compactPreview ? 'max-w-[62%]' : 'max-w-[72%]'
  } ${
    isImageOnlyMessage
      ? isOwnMessage
        ? 'ml-auto mr-1.5'
        : ''
      : isOwnMessage
        ? 'ml-auto'
        : ''
  }`

  function handleAttachmentPreviewError(attachmentId: string) {
    setFailedPreviewIds((currentIds) => (
      currentIds[attachmentId]
        ? currentIds
        : {
            ...currentIds,
            [attachmentId]: true,
          }
    ))
  }

  function renderAttachmentMedia(
    attachment: ChatMessageAttachment,
    index: number,
    className: string,
    style?: {
      aspectRatio?: string
      minHeight?: string
    }
  ) {
    const attachmentState = normalizedAttachmentStates[index] ?? 'attached'
    const previewFailedToLoad = Boolean(failedPreviewIds[attachment.id])

    return (
      <ChatImageAttachmentTile
        key={getAttachmentStableRenderKey(attachment, index)}
        message={message}
        attachment={attachment}
        attachmentState={attachmentState}
        tileIndex={index}
        className={className}
        style={style}
        previewFailedToLoad={previewFailedToLoad}
        onPreviewError={handleAttachmentPreviewError}
        onImageClick={onImageClick}
        onImageLoad={onImageLoad}
        attachments={attachments}
      />
    )
  }

  if (attachments.length === 1) {
    const attachment = attachments[0]!

    return (
      <div className={wrapperClassName}>
        {renderAttachmentMedia(
          attachment,
          0,
          `relative block w-full overflow-hidden rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] ${
            compactPreview ? 'max-h-40' : 'max-h-80'
          }`,
          getImageAttachmentCardStyle(attachment, compactPreview)
        )}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/55 via-black/15 to-transparent"
        />
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/38 px-1.5 py-0.5 text-[11px] font-medium leading-none text-white backdrop-blur-[2px]">
          {createdAtLabel}
        </span>
      </div>
    )
  }

  return (
    <div className={wrapperClassName}>
      <div className={`grid ${getGalleryGridClass(attachments.length)} gap-1`}>
        {attachments.map((attachment, index) =>
          renderAttachmentMedia(
            attachment,
            index,
            `relative aspect-square overflow-hidden rounded-[18px] bg-black/[0.04] dark:bg-white/[0.06] ${
              getGalleryTileClass(attachments.length, index)
            }`
          )
        )}
      </div>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-16 rounded-b-2xl bg-gradient-to-t from-black/45 via-black/10 to-transparent"
      />
      <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/40 px-1.5 py-0.5 text-[11px] font-medium leading-none text-white backdrop-blur-[2px]">
        {createdAtLabel}
      </span>
    </div>
  )
}

function ChatMessageBody({
  message,
  isOwnMessage = false,
  showSenderName = true,
  onReplyPreviewClick,
  onImageClick,
  onImageLoad,
  onRetryFailedMessage,
  currentUserId = null,
  onReactionToggle,
  onReactionDetailsOpen,
  animatedReactionKey = null,
  compactPreview = false,
}: {
  message: ChatMessageItem
  isOwnMessage?: boolean
  showSenderName?: boolean
  onReplyPreviewClick?: () => void
  onImageClick?: (attachments: ChatMessageAttachment[], index: number) => void
  onImageLoad?: (message: ChatMessageItem, sortOrder: number, publicUrl: string) => void
  onRetryFailedMessage?: (message: ChatMessageItem) => void
  currentUserId?: string | null
  onReactionToggle?: (messageId: string, emoji: string) => void
  onReactionDetailsOpen?: (message: ChatMessageItem, reaction: ChatMessageItem['reactions'][number]) => void
  animatedReactionKey?: string | null
  compactPreview?: boolean
}) {
  const isFallbackReplyPreview = Boolean(
    message.replyTo && message.replyTo.userId === null && message.replyTo.text === ''
  )
  const hasVoiceAttachment = message.messageType === 'voice'
  const hasImageAttachments = message.attachments.length > 0
  const isImageOnlyMessage = Boolean(hasImageAttachments && !message.text && !message.replyTo && !hasVoiceAttachment)
  // Guard matches text_pending_label_cleared: once the server has accepted the message
  // (optimisticServerMessageId set) the pending label must not render even if a deferred
  // React render snapshot still carries optimisticStatus 'sending'.
  // Image upload overlays are driven by attachment states and are unaffected.
  const isPendingMessage = message.isOptimistic &&
    message.optimisticStatus === 'sending' &&
    !message.optimisticServerMessageId
  const isFailedMessage = message.isOptimistic && message.optimisticStatus === 'failed'
  const attachmentProgress = hasImageAttachments
    ? getOptimisticAttachmentProgress(message)
    : null
  const hasAttachmentTaskState = Boolean(message.optimisticAttachmentStates?.length)
  const hasPendingAttachmentUploads = Boolean(
    attachmentProgress && attachmentProgress.uploadingCount > 0
  )
  const hasAttachmentFailures = Boolean(
    attachmentProgress && attachmentProgress.failedCount > 0
  )
  const hasServerBackedImageMessage = Boolean(
    message.messageType === 'image' &&
    hasAttachmentTaskState &&
    (message.optimisticServerMessageId || !message.id.startsWith('temp-'))
  )
  const isAttachmentFailureState = Boolean(hasServerBackedImageMessage && hasAttachmentFailures)
  const isMessageSendFailureState = Boolean(isFailedMessage && !isAttachmentFailureState)
  const isUploadingImageMessage = Boolean(
    hasImageAttachments &&
    message.optimisticAttachmentUploadState === 'uploading'
  )
  const pendingStatusLabel = isUploadingImageMessage
    ? attachmentProgress && attachmentProgress.total > 1
      ? `Загрузка фото... ${attachmentProgress.availableCount} из ${attachmentProgress.total}`
      : 'Загрузка фото...'
    : 'Отправка...'
  const failedStatusLabel = isAttachmentFailureState
    ? attachmentProgress?.failedCount === 1
      ? 'Не удалось загрузить 1 фото'
      : `Не удалось загрузить ${attachmentProgress?.failedCount ?? 0} фото`
    : 'Не отправлено'
  const shouldShowRetryButton = Boolean(
    onRetryFailedMessage &&
    (isMessageSendFailureState || (isAttachmentFailureState && !hasPendingAttachmentUploads))
  )

  return (
    <>
      {showSenderName ? (
        <p
          className={`truncate ${
            compactPreview ? 'text-[10px]' : 'text-[9px]'
          } ${
            isOwnMessage ? 'app-text-secondary text-right opacity-70' : 'app-text-secondary opacity-75'
          }`}
        >
          {message.displayName}
        </p>
      ) : null}
      {message.replyTo ? (
        <button
          type="button"
          onClick={onReplyPreviewClick}
          disabled={!onReplyPreviewClick}
          className={`mt-1 rounded-[14px] ${
            compactPreview ? 'px-2 py-1' : 'px-2.5 py-1.5'
          } ${
            isOwnMessage
              ? 'bg-black/[0.04] dark:bg-white/[0.07]'
              : 'bg-black/[0.03] dark:bg-white/[0.05]'
          } ${onReplyPreviewClick ? 'block w-full cursor-pointer text-left' : 'block w-full cursor-default text-left'} ${
            isFallbackReplyPreview ? 'opacity-75' : ''
          }`}
        >
          <p
            className={`${isFallbackReplyPreview ? 'app-text-secondary' : 'app-text-primary'} truncate font-medium ${
              compactPreview ? 'text-[11px]' : 'text-xs'
            }`}
          >
            {message.replyTo.displayName}
          </p>
          {message.replyTo.text ? (
            <p className={`app-text-secondary truncate ${compactPreview ? 'text-[11px]' : 'text-xs'}`}>
              {message.replyTo.text}
            </p>
          ) : null}
        </button>
      ) : null}
      {hasImageAttachments ? (
        <ChatImageAttachments
          message={message}
          attachments={message.attachments}
          attachmentStates={message.optimisticAttachmentStates}
          createdAtLabel={message.createdAtLabel}
          isOwnMessage={isOwnMessage}
          isImageOnlyMessage={isImageOnlyMessage}
          compactPreview={compactPreview}
          onImageClick={onImageClick}
          onImageLoad={onImageLoad}
        />
      ) : null}
      {hasVoiceAttachment ? (
        <>
          {message.isOptimistic ? (
            <div
              className={`mt-1 flex w-full items-center gap-1.5 rounded-[18px] px-2 py-1 ${
                isOwnMessage
                  ? 'bg-green-100 dark:bg-green-900/35'
                  : 'bg-black/[0.04] dark:bg-white/[0.07]'
              }`}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/[0.08] text-black/50 dark:bg-white/[0.14] dark:text-white/60">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">Отправка...</p>
                <p className="app-text-secondary text-[11px]">
                  {formatVoiceMessageDuration(message.mediaDurationSeconds)}
                </p>
              </div>
            </div>
          ) : message.mediaUrl ? (
            <VoiceMessageAudio
              storagePath={message.mediaUrl}
              durationSeconds={message.mediaDurationSeconds}
              isOwnMessage={isOwnMessage}
            />
          ) : (
            <div
              className={`mt-1 inline-flex max-w-full rounded-2xl px-3 py-2 text-sm ${
                isOwnMessage
                  ? 'ml-auto bg-green-100 text-black/80 dark:bg-green-900/35 dark:text-white/80'
                  : 'bg-black/[0.04] text-black/75 dark:bg-white/[0.07] dark:text-white/75'
              }`}
            >
              {formatVoiceMessageLabel(message.mediaDurationSeconds)}
            </div>
          )}
        </>
      ) : null}
      {message.text ? (
        <p
          className={`app-text-primary break-words whitespace-pre-wrap text-left text-sm ${
            message.replyTo || hasImageAttachments || hasVoiceAttachment ? 'mt-1' : showSenderName ? 'mt-0.5' : ''
          } ${
            compactPreview ? 'leading-5' : 'leading-[1.32]'
          }`}
          style={
            compactPreview
              ? {
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }
              : undefined
          }
        >
          {message.text}
        </p>
      ) : null}
      {!isImageOnlyMessage ? (
        <p className={`${isMessageSendFailureState || isAttachmentFailureState ? 'text-red-600' : 'app-text-secondary'} ${compactPreview ? 'mt-0.5 text-[11px]' : 'mt-1 text-[9px] opacity-60'} ${compactPreview ? '' : isOwnMessage ? 'text-right' : ''}`}>
          {message.createdAtLabel}
          {message.editedAt ? ' • изменено' : ''}
          {isPendingMessage ? ` • ${pendingStatusLabel}` : ''}
          {!isPendingMessage && (isMessageSendFailureState || isAttachmentFailureState) ? ` • ${failedStatusLabel}` : ''}
        </p>
      ) : isPendingMessage || isMessageSendFailureState || isAttachmentFailureState ? (
        <p className={`mt-1 text-[11px] ${isOwnMessage ? 'text-right' : ''} ${isMessageSendFailureState || isAttachmentFailureState ? 'text-red-600' : 'app-text-secondary opacity-70'}`}>
          {isPendingMessage ? pendingStatusLabel : failedStatusLabel}
        </p>
      ) : null}
      {shouldShowRetryButton ? (
        <div className={`mt-1 flex ${isOwnMessage ? 'justify-end' : ''}`}>
          <button
            type="button"
            onClick={() => onRetryFailedMessage?.(message)}
            className="rounded-full border border-red-500/25 px-2.5 py-1 text-[11px] font-medium text-red-600 transition-colors active:scale-[0.98] dark:border-red-400/25 dark:text-red-300"
          >
            Повторить
          </button>
        </div>
      ) : null}
      {message.reactions.length > 0 ? (
        <div className={`flex flex-wrap ${compactPreview ? 'mt-1.5 gap-0.5' : 'mt-2 gap-1'} ${isOwnMessage ? 'justify-end' : ''}`}>
          {message.reactions.map((reaction) => {
            const isSelected = currentUserId ? reaction.userIds.includes(currentUserId) : false
            const reactionKey = `${message.id}:${reaction.emoji}`

            return (
              <ReactionChip
                key={reactionKey}
                reactionKey={reactionKey}
                emoji={reaction.emoji}
                count={reaction.count}
                reactors={reaction.reactors}
                isSelected={isSelected}
                disabled={!onReactionToggle}
                shouldBurst={animatedReactionKey === reactionKey}
                compact={compactPreview}
                onToggle={(event) => {
                  event.stopPropagation()
                  onReactionToggle?.(message.id, reaction.emoji)
                }}
                onOpenDetails={(event) => {
                  event.stopPropagation()
                  onReactionDetailsOpen?.(message, reaction)
                }}
              />
            )
          })}
        </div>
      ) : null}
    </>
  )
}

const ChatMessageList = memo(function ChatMessageList({
  messages,
  currentUserId,
  swipingMessageId,
  swipeOffsetX,
  animatedReactionKey,
  messageRefs,
  onReplyPreviewClick,
  onImageClick,
  onImageLoad,
  onRetryFailedMessage,
  onReactionToggle,
  onReactionDetailsOpen,
  onMessageTouchStart,
  onMessageTouchEnd,
  onMessageTouchCancel,
  onMessageTouchMove,
  onMessageMouseDown,
  onMessageMouseUp,
  onMessageMouseLeave,
  onMessageContextMenu,
}: {
  messages: ChatMessageItem[]
  currentUserId: string | null
  swipingMessageId: string | null
  swipeOffsetX: number
  animatedReactionKey: string | null
  messageRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>
  onReplyPreviewClick: (replyToMessageId: string) => void
  onImageClick: (attachments: ChatMessageAttachment[], index: number) => void
  onImageLoad: (message: ChatMessageItem, sortOrder: number, publicUrl: string) => void
  onRetryFailedMessage: (message: ChatMessageItem) => void
  onReactionToggle: (messageId: string, emoji: string) => void
  onReactionDetailsOpen: (message: ChatMessageItem, reaction: ChatMessageItem['reactions'][number]) => void
  onMessageTouchStart: (message: ChatMessageItem, event: ReactTouchEvent<HTMLDivElement>) => void
  onMessageTouchEnd: (message: ChatMessageItem) => void
  onMessageTouchCancel: () => void
  onMessageTouchMove: (message: ChatMessageItem, event: ReactTouchEvent<HTMLDivElement>) => void
  onMessageMouseDown: (message: ChatMessageItem) => void
  onMessageMouseUp: () => void
  onMessageMouseLeave: () => void
  onMessageContextMenu: (message: ChatMessageItem, event: React.MouseEvent<HTMLDivElement>) => void
}) {
  return (
    <section className="mt-auto flex flex-col px-0 pt-1">
      <div className="flex flex-col">
        {messages.map((message, index) => {
          const isOwnMessage = currentUserId === message.userId
          const isImageOnlyMessage = Boolean(
            message.attachments.length > 0 &&
            !message.text &&
            !message.replyTo &&
            message.messageType !== 'voice'
          )
          const isSwipeActive = swipingMessageId === message.id
          const previousMessage = index > 0 ? messages[index - 1] : null
          const isSameAuthorAsPrevious = previousMessage?.userId === message.userId
          const isFirstInAuthorRun = !isSameAuthorAsPrevious
          const showAvatar = !isOwnMessage && isFirstInAuthorRun
          const showSenderName = isOwnMessage ? isFirstInAuthorRun : isFirstInAuthorRun
          const replyPreviewTargetId =
            message.replyTo && message.replyTo.userId !== null ? message.replyTo.id : null
          const messageSpacingClass = index === 0 ? '' : isSameAuthorAsPrevious ? 'mt-1' : 'mt-4'

          return (
            <div
              key={getMessageStableRenderKey(message)}
              className={messageSpacingClass}
            >
              <article className={`flex items-end gap-2.5 ${isOwnMessage ? 'justify-end' : ''}`}>
                {isOwnMessage ? null : showAvatar ? message.avatarUrl ? (
                  <Image
                    src={message.avatarUrl}
                    alt=""
                    width={40}
                    height={40}
                    className="h-10 w-10 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <AvatarFallback />
                ) : (
                  <div className="h-10 w-10 shrink-0" aria-hidden="true" />
                )}
                <div className={`relative min-w-0 w-full max-w-[80%] md:max-w-[82%] ${isOwnMessage ? 'ml-auto' : ''}`}>
                  <div
                    aria-hidden="true"
                    className={`pointer-events-none absolute left-2 top-1/2 z-[1] hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/[0.05] text-black/55 transition-all dark:bg-white/[0.08] dark:text-white/70 md:hidden ${
                      isSwipeActive && swipeOffsetX > 8 ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
                    }`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 7 4 12l5 5" />
                      <path d="M20 12H4" />
                    </svg>
                  </div>
                  <div
                    ref={(node) => {
                      if (node) {
                        messageRefs.current[message.id] = node
                        return
                      }

                      delete messageRefs.current[message.id]
                    }}
                    style={{
                      transform: isSwipeActive ? `translateX(${swipeOffsetX}px)` : 'translateX(0px)',
                    }}
                    className={`chat-no-select relative z-[2] min-w-0 w-full shadow-none transition-[transform,color,background-color,box-shadow] duration-150 ${
                      isImageOnlyMessage
                        ? 'rounded-2xl bg-transparent px-0 py-0'
                        : `rounded-[18px] px-2.5 py-1 ${
                            isOwnMessage
                              ? 'bg-[#DCF8C6] dark:bg-green-900/40'
                              : 'bg-black/[0.04] dark:bg-white/[0.07]'
                          }`
                    }`}
                    onTouchStart={(event) => onMessageTouchStart(message, event)}
                    onTouchEnd={() => onMessageTouchEnd(message)}
                    onTouchCancel={onMessageTouchCancel}
                    onTouchMove={(event) => onMessageTouchMove(message, event)}
                    onMouseDown={() => onMessageMouseDown(message)}
                    onMouseUp={onMessageMouseUp}
                    onMouseLeave={onMessageMouseLeave}
                    onContextMenu={(event) => onMessageContextMenu(message, event)}
                  >
                    <ChatMessageBody
                      message={message}
                      isOwnMessage={isOwnMessage}
                      showSenderName={showSenderName}
                      currentUserId={currentUserId}
                      animatedReactionKey={animatedReactionKey}
                      onReplyPreviewClick={replyPreviewTargetId ? () => onReplyPreviewClick(replyPreviewTargetId) : undefined}
                      onImageClick={onImageClick}
                      onImageLoad={onImageLoad}
                      onRetryFailedMessage={onRetryFailedMessage}
                      onReactionToggle={onReactionToggle}
                      onReactionDetailsOpen={onReactionDetailsOpen}
                    />
                  </div>
                </div>
              </article>
            </div>
          )
        })}
      </div>
    </section>
  )
})

export default function ChatSection({
  showTitle = true,
  threadId = null,
  currentUserId = null,
  isKeyboardOpen = false,
  isThreadLayoutReady = false,
  title,
  description,
}: ChatSectionProps) {
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const scrollContentRef = useRef<HTMLDivElement | null>(null)
  const composerWrapperRef = useRef<HTMLDivElement | null>(null)
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const messagesRef = useRef<ChatMessageItem[]>([])
  const activeThreadIdRef = useRef<string | null>(threadId)
  const renderedMessagesThreadIdRef = useRef<string | null>(null)
  const pendingDeletedMessageIdsRef = useRef<Set<string>>(new Set())
  const optimisticRealtimeFallbackTimeoutsRef = useRef<Record<string, number>>({})
  const chatSendErrorGuardStateRef = useRef<Record<string, ChatSendErrorGuardState>>({})
  const longPressTimeoutRef = useRef<number | null>(null)
  const pendingReplyJumpTargetIdRef = useRef<string | null>(null)
  const swipeGestureMessageIdRef = useRef<string | null>(null)
  const swipeStartXRef = useRef<number | null>(null)
  const swipeStartYRef = useRef<number | null>(null)
  const swipeOffsetXRef = useRef(0)
  const swipeLockedVerticalRef = useRef(false)
  const highlightedMessageIdRef = useRef<string | null>(null)
  const highlightedMessageTimeoutRef = useRef<number | null>(null)
  const animatedReactionTimeoutRef = useRef<number | null>(null)
  const pendingAutoScrollToBottomRef = useRef(false)
  const prependScrollRestoreRef = useRef<{ scrollHeight: number; scrollTop: number | null } | null>(null)
  const isLoadingOlderMessagesRef = useRef(false)
  const focusedGestureStartScrollTopRef = useRef<number | null>(null)
  const focusedGestureStartClientYRef = useRef<number | null>(null)
  const focusedGestureBlurredRef = useRef(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const initialBottomLockSafetyTimeoutRef = useRef<number | null>(null)
  const initialBottomLockStabilityFrameRef = useRef<number | null>(null)
  const initialBottomLockProgrammaticFrameRef = useRef<number | null>(null)
  const initialBottomLockProgrammaticResetFrameRef = useRef<number | null>(null)
  const initialBottomLockNextSourceRef = useRef<string | null>(null)
  const initialBottomLockUserCancelledRef = useRef(false)
  const initialBottomLockUserScrollIntentRef = useRef(false)
  const initialBottomLockLastGeometryRef = useRef<{ scrollHeight: number; clientHeight: number } | null>(null)
  const initialBottomLockStableSampleCountRef = useRef(0)
  const isStoppingVoiceRecordingRef = useRef(false)
  const shouldCancelVoiceRecordingRef = useRef(false)
  const hasHandledVoiceRecordingStopRef = useRef(false)
  const isSendingVoiceMessageRef = useRef(false)
  const chatSendDebugCopyTimeoutRef = useRef<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const [pendingInitialScroll, setPendingInitialScroll] = useState(false)
  const [hasDeferredInitialSettle, setHasDeferredInitialSettle] = useState(false)
  const [isInitialBottomLockActive, setIsInitialBottomLockActive] = useState(false)
  const [pendingNewMessagesCount, setPendingNewMessagesCount] = useState(0)
  const [hasMoreOlderMessages, setHasMoreOlderMessages] = useState(true)
  const [error, setError] = useState('')
  const [draftMessage, setDraftMessage] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadingVoice, setUploadingVoice] = useState(false)
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [isSendingVoice, setIsSendingVoice] = useState(false)
  const [isStartingVoiceRecording, setIsStartingVoiceRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const threadOpenDebugWindowRef = useRef<{ threadId: string | null; expiresAt: number }>({
    threadId: null,
    expiresAt: 0,
  })
  const [chatSendDebugEvents, setChatSendDebugEvents] = useState<ChatSendDebugEvent[]>(() =>
    CHAT_SEND_DEBUG
      ? getRecentChatSendDebugEvents().filter((event) => CHAT_SEND_DEBUG_VISIBLE_PHASES.has(event.phase))
      : []
  )
  const [isChatSendDebugPanelExpanded, setIsChatSendDebugPanelExpanded] = useState(true)
  const [chatSendDebugCopyStatus, setChatSendDebugCopyStatus] = useState('')
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)
  const [selectedMessage, setSelectedMessage] = useState<ChatMessageItem | null>(null)
  const [selectedMessageAnchorRect, setSelectedMessageAnchorRect] = useState<DOMRect | null>(null)
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false)
  const [deleteConfirmationMessage, setDeleteConfirmationMessage] = useState<ChatMessageItem | null>(null)
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessageItem | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [pendingImages, setPendingImages] = useState<PendingComposerImage[]>([])
  const pendingImagesRef = useRef<PendingComposerImage[]>([])
  const [selectedViewerState, setSelectedViewerState] = useState<{
    attachments: ChatMessageAttachment[]
    initialIndex: number
  } | null>(null)
  const [animatedReactionKey, setAnimatedReactionKey] = useState<string | null>(null)
  const [selectedReactionDetails, setSelectedReactionDetails] = useState<{
    messageId: string
    emoji: string
  } | null>(null)
  const [swipingMessageId, setSwipingMessageId] = useState<string | null>(null)
  const [swipeOffsetX, setSwipeOffsetX] = useState(0)
  const [isComposerFocused, setIsComposerFocused] = useState(false)
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false)
  const [showScrollToBottomButton, setShowScrollToBottomButton] = useState(false)
  const pageTitle = title ?? 'Чат клуба'
  const pageDescription = description ?? 'Последние 50 сообщений клуба в хронологическом порядке.'
  const filteredChatSendDebugEvents = useMemo(
    () => chatSendDebugEvents
      .filter((event) => CHAT_SEND_DEBUG_VISIBLE_PHASES.has(event.phase)),
    [chatSendDebugEvents]
  )
  const visibleChatSendDebugEvents = useMemo(
    () => filteredChatSendDebugEvents.slice(0, CHAT_SEND_DEBUG_VISIBLE_EVENT_LIMIT),
    [filteredChatSendDebugEvents]
  )
  const isThreadOpenDebugActive = useCallback((nextThreadId: string | null | undefined = threadId) => (
    Boolean(nextThreadId) &&
    threadOpenDebugWindowRef.current.threadId === (nextThreadId ?? null) &&
    Date.now() < threadOpenDebugWindowRef.current.expiresAt
  ), [threadId])
  const logThreadOpenImageRehydrations = useCallback((
    previousMessages: ChatMessageItem[],
    nextMessages: ChatMessageItem[],
    source: ThreadOpenDebugSource
  ) => {
    if (!threadId || !isThreadOpenDebugActive(threadId)) {
      return
    }

    const previousById = new Map(previousMessages.map((message) => [message.id, message]))

    nextMessages.forEach((nextMessage) => {
      if (nextMessage.messageType !== 'image') {
        return
      }

      const previousMessage = previousById.get(nextMessage.id)

      if (!previousMessage || previousMessage.messageType !== 'image') {
        return
      }

      const previousAttachmentCount = previousMessage.attachments.length
      const nextAttachmentCount = nextMessage.attachments.length
      const previousHasRemoteUrls = hasRemoteImageUrls(previousMessage)
      const nextHasRemoteUrls = hasRemoteImageUrls(nextMessage)
      const previousSignature = getAttachmentMaterialSignature(previousMessage)
      const nextSignature = getAttachmentMaterialSignature(nextMessage)

      if (
        previousAttachmentCount === nextAttachmentCount &&
        previousHasRemoteUrls === nextHasRemoteUrls &&
        previousSignature === nextSignature
      ) {
        return
      }

      logChatSendDebug('thread_open_image_message_rehydrated', {
        threadId,
        messageId: nextMessage.id,
        previousAttachmentCount,
        nextAttachmentCount,
        previousHasRemoteUrls,
        nextHasRemoteUrls,
        source,
      })
    })
  }, [isThreadOpenDebugActive, threadId])
  const logThreadOpenMessageMutation = useCallback((
    previousMessages: ChatMessageItem[],
    nextMessages: ChatMessageItem[],
    options: {
      source: ThreadOpenDebugSource
      replacedWholeList: boolean
      mergedIntoCurrentList: boolean
    }
  ) => {
    if (!threadId || !isThreadOpenDebugActive(threadId)) {
      return
    }

    const nextSummary = summarizeThreadOpenMessages(nextMessages)
    const changeStats = buildThreadOpenMessageChangeStats(previousMessages, nextMessages)
    const basePayload = {
      threadId,
      ...nextSummary,
      source: options.source,
      replacedWholeList: options.replacedWholeList,
      mergedIntoCurrentList: options.mergedIntoCurrentList,
      ...changeStats,
    }

    logChatSendDebug('thread_open_messages_set', basePayload)

    if (options.replacedWholeList) {
      logChatSendDebug('thread_open_messages_replaced', basePayload)
    }

    if (options.mergedIntoCurrentList) {
      logChatSendDebug('thread_open_messages_merged', basePayload)
    }

    logThreadOpenImageRehydrations(previousMessages, nextMessages, options.source)
  }, [isThreadOpenDebugActive, logThreadOpenImageRehydrations, threadId])

  const trimmedDraftMessage = draftMessage.trim()
  const editingMessage = editingMessageId
    ? messages.find((message) => message.id === editingMessageId) ?? null
    : null
  pendingImagesRef.current = pendingImages
  const hasPendingImage = pendingImages.length > 0
  const isMessageTooLong = trimmedDraftMessage.length > CHAT_MESSAGE_MAX_LENGTH
  const canSubmitMessage = Boolean(trimmedDraftMessage || pendingImages.length > 0)
  const shouldShowVoiceRecorderButton = !editingMessage && !trimmedDraftMessage && !hasPendingImage
  const latestLoadedMessageCreatedAt = messages.length > 0 ? messages[messages.length - 1]?.createdAt ?? null : null
  const oldestLoadedMessageCreatedAt = messages.length > 0 ? messages[0]?.createdAt ?? null : null
  const oldestLoadedMessageId = messages.length > 0 ? messages[0]?.id ?? null : null
  const selectedReactionMessage = selectedReactionDetails
    ? messages.find((message) => message.id === selectedReactionDetails.messageId) ?? null
    : null
  const selectedReaction = selectedReactionMessage && selectedReactionDetails
    ? selectedReactionMessage.reactions.find((reaction) => reaction.emoji === selectedReactionDetails.emoji) ?? null
    : null
  const isCurrentUserSelectedInReaction = Boolean(
    currentUserId && selectedReaction?.userIds.includes(currentUserId)
  )
  const initialBottomLockRequiredStableSamples = 3
  const initialBottomLockSafetyTimeoutMs = 4000

  useEffect(() => {
    if (!CHAT_SEND_DEBUG) {
      return
    }

    const syncDebugEvents = () => {
      setChatSendDebugEvents(
        getRecentChatSendDebugEvents().filter((event) => CHAT_SEND_DEBUG_VISIBLE_PHASES.has(event.phase))
      )
    }

    syncDebugEvents()
    const unsubscribe = subscribeChatSendDebugEvents(syncDebugEvents)
    logChatSendDebug('panel_mounted', {
      threadId,
      enabled: CHAT_SEND_DEBUG,
      mounted: true,
    })

    return unsubscribe
  }, [threadId])

  useEffect(() => {
    const latestDebugEvent = visibleChatSendDebugEvents[0]

    if (!latestDebugEvent) {
      return
    }

    if (latestDebugEvent.level === 'error' || latestDebugEvent.phase === 'ui_error_path_trigger') {
      setIsChatSendDebugPanelExpanded(true)
    }
  }, [visibleChatSendDebugEvents])

  useEffect(() => {
    return () => {
      if (chatSendDebugCopyTimeoutRef.current !== null) {
        window.clearTimeout(chatSendDebugCopyTimeoutRef.current)
      }
    }
  }, [])

  const clearInitialBottomLockSafetyTimeout = useCallback(() => {
    if (initialBottomLockSafetyTimeoutRef.current !== null) {
      window.clearTimeout(initialBottomLockSafetyTimeoutRef.current)
      initialBottomLockSafetyTimeoutRef.current = null
    }
  }, [])

  const clearInitialBottomLockFrames = useCallback(() => {
    if (initialBottomLockStabilityFrameRef.current !== null) {
      window.cancelAnimationFrame(initialBottomLockStabilityFrameRef.current)
      initialBottomLockStabilityFrameRef.current = null
    }

    if (initialBottomLockProgrammaticFrameRef.current !== null) {
      window.cancelAnimationFrame(initialBottomLockProgrammaticFrameRef.current)
      initialBottomLockProgrammaticFrameRef.current = null
    }

    if (initialBottomLockProgrammaticResetFrameRef.current !== null) {
      window.cancelAnimationFrame(initialBottomLockProgrammaticResetFrameRef.current)
      initialBottomLockProgrammaticResetFrameRef.current = null
    }
  }, [])

  const deactivateInitialBottomLock = useCallback((reason = 'unspecified', preserveUserCancelled = false) => {
    clearInitialBottomLockSafetyTimeout()
    clearInitialBottomLockFrames()

    if (!preserveUserCancelled) {
      initialBottomLockUserCancelledRef.current = false
    }
    initialBottomLockUserScrollIntentRef.current = false
    initialBottomLockLastGeometryRef.current = null
    initialBottomLockStableSampleCountRef.current = 0
    setIsInitialBottomLockActive(false)
  }, [clearInitialBottomLockFrames, clearInitialBottomLockSafetyTimeout])

  const keepLatestRenderedMessages = useCallback((
    nextMessages: ChatMessageItem[],
    options?: { preserveExpandedHistory?: boolean }
  ) => {
    const filteredMessages = filterPendingDeletedMessages(nextMessages)

    if (options?.preserveExpandedHistory) {
      return filteredMessages
    }

    if (filteredMessages.length <= MAX_RENDERED_CHAT_MESSAGES) {
      return filteredMessages
    }

    return filteredMessages.slice(-MAX_RENDERED_CHAT_MESSAGES)
  }, [])

  const applyPendingMediaTasksToMessages = useCallback((nextMessages: ChatMessageItem[]) => {
    let didChange = false

    const mergedMessages = nextMessages.map((message) => {
      const mergedMessage = mergeMessageWithPendingMediaTaskState(message)

      if (mergedMessage !== message) {
        didChange = true
      }

      return mergedMessage
    })

    return didChange ? mergedMessages : nextMessages
  }, [])

  const refreshMessages = useCallback(async () => {
    try {
      if (threadId && isThreadOpenDebugActive(threadId)) {
        logChatSendDebug('thread_open_post_mount_refresh_start', {
          threadId,
          ...summarizeThreadOpenMessages(messagesRef.current),
          source: 'refresh',
          replacedWholeList: true,
          mergedIntoCurrentList: false,
        })
      }

      const recentMessages = await loadRecentChatMessages(50, threadId)
      const nextMessages = applyPendingMediaTasksToMessages(keepLatestRenderedMessages(recentMessages))

      if (threadId && isThreadOpenDebugActive(threadId)) {
        logChatSendDebug('thread_open_post_mount_refresh_success', {
          threadId,
          ...summarizeThreadOpenMessages(nextMessages),
          source: 'refresh',
          replacedWholeList: true,
          mergedIntoCurrentList: false,
        })
        logThreadOpenMessageMutation(messagesRef.current, nextMessages, {
          source: 'refresh',
          replacedWholeList: true,
          mergedIntoCurrentList: false,
        })
      }

      setMessages(nextMessages)
      setError('')
      return recentMessages
    } catch {
      setError('Не удалось загрузить чат')
      return null
    }
  }, [applyPendingMediaTasksToMessages, isThreadOpenDebugActive, keepLatestRenderedMessages, logThreadOpenMessageMutation, threadId])

  const releaseOptimisticClientMedia = useCallback((message: ChatMessageItem) => {
    revokeOptimisticVoiceObjectUrl(message)
    revokeOptimisticImageObjectUrls(message)
  }, [])

  const clearOptimisticRealtimeFallbackTimeout = useCallback((messageId: string) => {
    const timeoutId = optimisticRealtimeFallbackTimeoutsRef.current[messageId]

    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId)
      delete optimisticRealtimeFallbackTimeoutsRef.current[messageId]
    }
  }, [])

  const resizeComposerTextarea = useCallback(() => {
    const textarea = composerTextareaRef.current

    if (!textarea) {
      return
    }

    textarea.style.height = 'auto'
    const nextHeight = Math.min(textarea.scrollHeight, CHAT_COMPOSER_TEXTAREA_MAX_HEIGHT)
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY =
      textarea.scrollHeight > CHAT_COMPOSER_TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'
  }, [])

  const isNearBottom = useCallback((thresholdPx = 100) => {
    if (typeof window === 'undefined') {
      return false
    }

    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer) {
      return true
    }

    const distanceFromBottom =
      scrollContainer.scrollHeight - (scrollContainer.scrollTop + scrollContainer.clientHeight)

    return distanceFromBottom <= thresholdPx
  }, [])

  const scrollPageToBottom = useCallback((
    behavior: ScrollBehavior = 'auto',
    source = 'unspecified'
  ) => {
    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer) {
      return
    }

    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior,
    })
  }, [])

  const getInitialBottomLockGeometry = useCallback(() => {
    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer) {
      return null
    }

    return {
      scrollHeight: scrollContainer.scrollHeight,
      clientHeight: scrollContainer.clientHeight,
    }
  }, [])

  const scheduleInitialBottomLockSafetyTimeout = useCallback(() => {
    clearInitialBottomLockSafetyTimeout()

    initialBottomLockSafetyTimeoutRef.current = window.setTimeout(() => {
      if (!initialBottomLockUserCancelledRef.current) {
        deactivateInitialBottomLock('safety-timeout')
      }
    }, initialBottomLockSafetyTimeoutMs)
  }, [clearInitialBottomLockSafetyTimeout, deactivateInitialBottomLock, initialBottomLockSafetyTimeoutMs])

  const scheduleInitialBottomLockStabilityCheck = useCallback((source = 'unspecified') => {
    if (initialBottomLockUserCancelledRef.current) {
      return
    }

    if (initialBottomLockStabilityFrameRef.current !== null) {
      window.cancelAnimationFrame(initialBottomLockStabilityFrameRef.current)
    }

    initialBottomLockStabilityFrameRef.current = window.requestAnimationFrame(() => {
      initialBottomLockStabilityFrameRef.current = null

      if (initialBottomLockUserCancelledRef.current) {
        return
      }

      const geometry = getInitialBottomLockGeometry()

      if (!geometry) {
        return
      }

      const previousGeometry = initialBottomLockLastGeometryRef.current
      const geometryChanged = !previousGeometry ||
        previousGeometry.scrollHeight !== geometry.scrollHeight ||
        previousGeometry.clientHeight !== geometry.clientHeight

      if (geometryChanged) {
        initialBottomLockLastGeometryRef.current = geometry
        initialBottomLockStableSampleCountRef.current = 0
        scheduleInitialBottomLockStabilityCheck('geometry-changed')
        return
      }

      initialBottomLockStableSampleCountRef.current += 1

      if (initialBottomLockStableSampleCountRef.current >= initialBottomLockRequiredStableSamples) {
        deactivateInitialBottomLock('stable-geometry')
        return
      }

      scheduleInitialBottomLockStabilityCheck('stable-sample')
    })
  }, [
    deactivateInitialBottomLock,
    getInitialBottomLockGeometry,
    initialBottomLockRequiredStableSamples,
  ])

  const keepInitialBottomLockAnchored = useCallback((source = 'unspecified') => {
    if (initialBottomLockUserCancelledRef.current) {
      return
    }

    const geometry = getInitialBottomLockGeometry()
    const previousGeometry = initialBottomLockLastGeometryRef.current
    const geometryChanged = !previousGeometry ||
      !geometry ||
      previousGeometry.scrollHeight !== geometry.scrollHeight ||
      previousGeometry.clientHeight !== geometry.clientHeight

    if (geometry) {
      initialBottomLockLastGeometryRef.current = geometry
    }

    if (geometryChanged) {
      initialBottomLockStableSampleCountRef.current = 0
    }

    clearInitialBottomLockFrames()
    initialBottomLockProgrammaticFrameRef.current = window.requestAnimationFrame(() => {
      initialBottomLockProgrammaticFrameRef.current = null
      scrollPageToBottom('auto', source)
      initialBottomLockProgrammaticResetFrameRef.current = window.requestAnimationFrame(() => {
        initialBottomLockProgrammaticResetFrameRef.current = null
      })
    })
    scheduleInitialBottomLockSafetyTimeout()
    scheduleInitialBottomLockStabilityCheck(source)
  }, [
    clearInitialBottomLockFrames,
    getInitialBottomLockGeometry,
    scheduleInitialBottomLockSafetyTimeout,
    scheduleInitialBottomLockStabilityCheck,
    scrollPageToBottom,
  ])

  const handleMessageImageLoad = useCallback((message: ChatMessageItem, sortOrder: number, publicUrl: string) => {
    markChatSendTimingImageRenderable({
      optimisticMessageId: message.id.startsWith('temp-') ? message.id : undefined,
      serverMessageId: message.optimisticServerMessageId ?? (!message.id.startsWith('temp-') ? message.id : null),
      sortOrder,
      publicUrl,
    })
    scanChatSendTimingVisualComplete(messagesRef.current)

    if (!isThreadLayoutReady && hasDeferredInitialSettle) {
      return
    }

    if (isInitialBottomLockActive) {
      logChatSendDebug('thread_open_image_load_anchor_skipped', {
        messageId: message.id,
        sortOrder,
        isInitialBottomLockActive,
      })
      return
    }

    const shouldStickToBottom = isNearBottom(80) || !showScrollToBottomButton

    if (!shouldStickToBottom) {
      return
    }

    window.requestAnimationFrame(() => {
      scrollPageToBottom('auto', 'image-load')
    })
  }, [
    hasDeferredInitialSettle,
    isInitialBottomLockActive,
    isNearBottom,
    isThreadLayoutReady,
    scrollPageToBottom,
    showScrollToBottomButton,
  ])

  const clearReplyTargetHighlight = useCallback(() => {
    if (highlightedMessageTimeoutRef.current !== null) {
      window.clearTimeout(highlightedMessageTimeoutRef.current)
      highlightedMessageTimeoutRef.current = null
    }

    const highlightedMessageId = highlightedMessageIdRef.current

    if (!highlightedMessageId) {
      return
    }

    const highlightedMessageNode = messageRefs.current[highlightedMessageId]
    highlightedMessageNode?.classList.remove(...REPLY_TARGET_HIGHLIGHT_CLASSES)
    highlightedMessageIdRef.current = null
  }, [])

  const scrollAndHighlightMessage = useCallback((replyToMessageId: string) => {
    const targetMessageNode = messageRefs.current[replyToMessageId]

    if (!targetMessageNode) {
      return false
    }

    clearReplyTargetHighlight()
    targetMessageNode.scrollIntoView({ behavior: 'smooth', block: 'center' })
    targetMessageNode.classList.add(...REPLY_TARGET_HIGHLIGHT_CLASSES)
    highlightedMessageIdRef.current = replyToMessageId
    highlightedMessageTimeoutRef.current = window.setTimeout(() => {
      targetMessageNode.classList.remove(...REPLY_TARGET_HIGHLIGHT_CLASSES)
      if (highlightedMessageIdRef.current === replyToMessageId) {
        highlightedMessageIdRef.current = null
      }
      highlightedMessageTimeoutRef.current = null
    }, 1500)
    return true
  }, [clearReplyTargetHighlight])

  const handleReplyPreviewClick = useCallback(async (replyToMessageId: string) => {
    if (scrollAndHighlightMessage(replyToMessageId)) {
      return
    }

    try {
      const targetMessage = await loadChatMessageById(replyToMessageId, threadId)

      if (!targetMessage) {
        return
      }

      pendingReplyJumpTargetIdRef.current = replyToMessageId
      setMessages((currentMessages) => {
        if (currentMessages.some((message) => message.id === replyToMessageId)) {
          return currentMessages
        }

        return insertMessageChronologically(currentMessages, targetMessage)
      })
    } catch {
      // Keep reply navigation non-blocking if the source message is unavailable.
    }
  }, [scrollAndHighlightMessage, threadId])

  function getNewMessagesLabel(count: number) {
    return count === 1 ? '1 новое сообщение' : `${count} новых сообщений`
  }

  function filterPendingDeletedMessages(nextMessages: ChatMessageItem[]) {
    if (pendingDeletedMessageIdsRef.current.size === 0) {
      return nextMessages
    }

    return nextMessages.filter((message) => !pendingDeletedMessageIdsRef.current.has(message.id))
  }

  const prependMessages = useCallback((
    currentMessages: ChatMessageItem[],
    olderMessages: ChatMessageItem[],
  ) => {
    const seenMessageIds = new Set(currentMessages.map((message) => message.id))
    const uniqueOlderMessages = filterPendingDeletedMessages(olderMessages).filter(
      (message) => !seenMessageIds.has(message.id)
    )

    const nextMessages = [...uniqueOlderMessages, ...currentMessages]

    if (nextMessages.length <= MAX_RENDERED_CHAT_MESSAGES) {
      return nextMessages
    }

    // Keep explicitly loaded history in memory so prepending never drops
    // the newest rendered messages or creates gaps in the loaded timeline.
    return nextMessages
  }, [])

  const loadOlderMessages = useCallback(async (
    { requireNearTop = true }: { requireNearTop?: boolean } = {}
  ) => {
    if (
      !currentUserId ||
      !oldestLoadedMessageCreatedAt ||
      !oldestLoadedMessageId
    ) {
      prependScrollRestoreRef.current = null
      return null
    }

    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer || isLoadingOlderMessagesRef.current) {
      return null
    }

    if (requireNearTop && scrollContainer.scrollTop > 80) {
      return null
    }

    isLoadingOlderMessagesRef.current = true
    setIsLoadingOlderMessages(true)
    prependScrollRestoreRef.current = {
      scrollHeight: scrollContainer.scrollHeight,
      scrollTop: scrollContainer.scrollTop,
    }

    try {
      const olderMessages = await loadOlderChatMessages(
        oldestLoadedMessageCreatedAt,
        oldestLoadedMessageId,
        OLDER_CHAT_BATCH_LIMIT,
        threadId
      )

      if (olderMessages.length === 0) {
        prependScrollRestoreRef.current = null
        setHasMoreOlderMessages(false)
        return {
          didLoad: false,
          hasMoreOlderMessages: false,
        }
      }

      const nextHasMoreOlderMessages = olderMessages.length === OLDER_CHAT_BATCH_LIMIT

      setHasMoreOlderMessages(nextHasMoreOlderMessages)
      setMessages((currentMessages) => prependMessages(currentMessages, olderMessages))

      return {
        didLoad: true,
        hasMoreOlderMessages: nextHasMoreOlderMessages,
      }
    } catch {
      prependScrollRestoreRef.current = null
      return null
    } finally {
      isLoadingOlderMessagesRef.current = false
      setIsLoadingOlderMessages(false)
    }
  }, [
    currentUserId,
    oldestLoadedMessageCreatedAt,
    oldestLoadedMessageId,
    prependMessages,
    threadId,
  ])

  useEffect(() => {
    activeThreadIdRef.current = threadId
  }, [threadId])

  useEffect(() => {
    messagesRef.current = messages
    renderedMessagesThreadIdRef.current = activeThreadIdRef.current
  }, [messages])

  useEffect(() => {
    scanChatSendTimingVisualComplete(messages)
  }, [messages])

  useEffect(() => {
    function syncPendingMediaTasksIntoMessages() {
      setMessages((currentMessages) => {
        const nextMessages = applyPendingMediaTasksToMessages(currentMessages)

        if (nextMessages !== currentMessages) {
          logThreadOpenMessageMutation(currentMessages, nextMessages, {
            source: 'unknown',
            replacedWholeList: false,
            mergedIntoCurrentList: true,
          })
        }

        return nextMessages === currentMessages ? currentMessages : nextMessages
      })
    }

    syncPendingMediaTasksIntoMessages()
    return subscribePendingChatMediaTasks(syncPendingMediaTasksIntoMessages)
  }, [applyPendingMediaTasksToMessages, logThreadOpenMessageMutation])

  useEffect(() => {
    if (!selectedReactionDetails) {
      return
    }

    const nextMessage = messages.find((message) => message.id === selectedReactionDetails.messageId) ?? null
    const nextReaction = nextMessage?.reactions.find((reaction) => reaction.emoji === selectedReactionDetails.emoji) ?? null

    if (!nextReaction || nextReaction.count <= 1) {
      setSelectedReactionDetails(null)
    }
  }, [messages, selectedReactionDetails])

  useLayoutEffect(() => {
    if (!currentUserId) {
      return
    }

    const cachedRecentMessages = getCachedRecentChatMessages(threadId)
    const previousMessages = messagesRef.current
    const hasBootstrapFallbackMessages = Boolean(cachedRecentMessages?.messages.length)
    const hasValidExistingThreadState =
      previousMessages.length > 0 &&
      renderedMessagesThreadIdRef.current === threadId
    const shouldApplyBootstrapFallback =
      hasBootstrapFallbackMessages &&
      !hasValidExistingThreadState

    threadOpenDebugWindowRef.current = {
      threadId: threadId ?? null,
      expiresAt: Date.now() + THREAD_OPEN_DEBUG_WINDOW_MS,
    }
    if (threadId) {
      logChatSendDebug('thread_open_start', {
        threadId,
        source: 'initial_load',
        ...summarizeThreadOpenMessages(messagesRef.current),
      })
    }

    deactivateInitialBottomLock('thread-reset')
    pendingImagesRef.current.forEach((image) => {
      revokeObjectUrlIfNeeded(image.previewUrl)
    })
    Object.values(optimisticRealtimeFallbackTimeoutsRef.current).forEach((timeoutId) => {
      window.clearTimeout(timeoutId)
    })
    optimisticRealtimeFallbackTimeoutsRef.current = {}
    messagesRef.current.forEach((message) => {
      releaseOptimisticClientMedia(message)
    })
    pendingDeletedMessageIdsRef.current.clear()

    if (shouldApplyBootstrapFallback) {
      const nextMessages = applyPendingMediaTasksToMessages(
        cachedRecentMessages?.messages ?? []
      )
      messagesRef.current = nextMessages
      logThreadOpenMessageMutation(previousMessages, nextMessages, {
        source: 'fallback',
        replacedWholeList: true,
        mergedIntoCurrentList: false,
      })
      setMessages(nextMessages)
    } else if (hasValidExistingThreadState && threadId && isThreadOpenDebugActive(threadId)) {
      logChatSendDebug('thread_open_messages_replace_skipped', {
        threadId,
        source: 'fallback',
        reason: 'existing_thread_state',
        ...summarizeThreadOpenMessages(previousMessages),
      })
    }

    setPendingInitialScroll(false)
    setHasDeferredInitialSettle(shouldApplyBootstrapFallback)
    setPendingNewMessagesCount(0)
    setHasMoreOlderMessages(cachedRecentMessages?.hasMoreOlderMessages ?? true)
    setError('')
    setDraftMessage('')
    setSubmitError('')
    setReplyingToMessage(null)
    setEditingMessageId(null)
    setSelectedMessage(null)
    setIsActionSheetOpen(false)
    setLoading(!(shouldApplyBootstrapFallback || hasValidExistingThreadState))
  }, [
    applyPendingMediaTasksToMessages,
    currentUserId,
    deactivateInitialBottomLock,
    isThreadOpenDebugActive,
    logThreadOpenMessageMutation,
    releaseOptimisticClientMedia,
    threadId,
  ])

  useEffect(() => {
    if (!threadId || loading) {
      return
    }

    setCachedRecentChatMessages(threadId, messages, {
      hasMoreOlderMessages,
    })
  }, [hasMoreOlderMessages, loading, messages, threadId])

  useEffect(() => {
    if (!threadId || loading) {
      return
    }

    const latestStableMessage =
      [...messages].reverse().find((message) => !message.isOptimistic) ?? null

    updatePrefetchedMessagesListThreadLastMessage(
      threadId,
      latestStableMessage ? toThreadLastMessage(latestStableMessage, threadId) : null
    )
  }, [loading, messages, threadId])

  useLayoutEffect(() => {
    resizeComposerTextarea()
  }, [draftMessage, resizeComposerTextarea])

  useEffect(() => {
    return () => {
      deactivateInitialBottomLock('component-unmount')
      pendingImagesRef.current.forEach((image) => {
        revokeObjectUrlIfNeeded(image.previewUrl)
      })
      Object.values(optimisticRealtimeFallbackTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId)
      })
      optimisticRealtimeFallbackTimeoutsRef.current = {}
      messagesRef.current.forEach((message) => {
        releaseOptimisticClientMedia(message)
      })
      if (longPressTimeoutRef.current !== null) {
        window.clearTimeout(longPressTimeoutRef.current)
      }

      if (animatedReactionTimeoutRef.current !== null) {
        window.clearTimeout(animatedReactionTimeoutRef.current)
      }

      if (timerRef.current !== null) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }

      mediaRecorderRef.current = null
    }
  }, [deactivateInitialBottomLock, releaseOptimisticClientMedia])

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer) {
      return
    }

    function updateScrollToBottomButtonVisibility() {
      setShowScrollToBottomButton(!isNearBottom())
    }

    updateScrollToBottomButtonVisibility()

    scrollContainer.addEventListener('scroll', updateScrollToBottomButtonVisibility, { passive: true })
    window.addEventListener('resize', updateScrollToBottomButtonVisibility)

    return () => {
      scrollContainer.removeEventListener('scroll', updateScrollToBottomButtonVisibility)
      window.removeEventListener('resize', updateScrollToBottomButtonVisibility)
    }
  }, [isNearBottom, messages.length])

  useEffect(() => {
    return () => {
      clearReplyTargetHighlight()
    }
  }, [clearReplyTargetHighlight])

  useEffect(() => {
    const pendingReplyJumpTargetId = pendingReplyJumpTargetIdRef.current

    if (!pendingReplyJumpTargetId) {
      return
    }

    let animationFrameId: number | null = null
    let nestedAnimationFrameId: number | null = null

    animationFrameId = window.requestAnimationFrame(() => {
      nestedAnimationFrameId = window.requestAnimationFrame(() => {
        if (scrollAndHighlightMessage(pendingReplyJumpTargetId)) {
          pendingReplyJumpTargetIdRef.current = null
        }
      })
    })

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }
      if (nestedAnimationFrameId !== null) {
        window.cancelAnimationFrame(nestedAnimationFrameId)
      }
    }
  }, [messages, scrollAndHighlightMessage])

  useEffect(() => {
    return () => {
      swipeGestureMessageIdRef.current = null
      swipeStartXRef.current = null
      swipeStartYRef.current = null
      swipeOffsetXRef.current = 0
      swipeLockedVerticalRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!selectedMessage) {
      setSelectedMessageAnchorRect(null)
      return
    }

    const nextSelectedMessage = messages.find((message) => message.id === selectedMessage.id) ?? null

    if (!nextSelectedMessage) {
      setSelectedMessage(null)
      setSelectedMessageAnchorRect(null)
      setIsActionSheetOpen(false)
      return
    }

    if (nextSelectedMessage !== selectedMessage) {
      setSelectedMessage(nextSelectedMessage)
    }
  }, [messages, selectedMessage])

  useLayoutEffect(() => {
    if (!selectedMessage || !isActionSheetOpen) {
      setSelectedMessageAnchorRect(null)
      return
    }

    function updateSelectedMessageAnchorRect() {
      if (!selectedMessage) {
        setSelectedMessageAnchorRect(null)
        return
      }

      const selectedMessageNode = messageRefs.current[selectedMessage.id]
      setSelectedMessageAnchorRect(selectedMessageNode?.getBoundingClientRect() ?? null)
    }

    updateSelectedMessageAnchorRect()

    const scrollContainer = scrollContainerRef.current
    scrollContainer?.addEventListener('scroll', updateSelectedMessageAnchorRect, { passive: true })
    window.addEventListener('resize', updateSelectedMessageAnchorRect)
    window.visualViewport?.addEventListener('resize', updateSelectedMessageAnchorRect)
    window.visualViewport?.addEventListener('scroll', updateSelectedMessageAnchorRect)

    return () => {
      scrollContainer?.removeEventListener('scroll', updateSelectedMessageAnchorRect)
      window.removeEventListener('resize', updateSelectedMessageAnchorRect)
      window.visualViewport?.removeEventListener('resize', updateSelectedMessageAnchorRect)
      window.visualViewport?.removeEventListener('scroll', updateSelectedMessageAnchorRect)
    }
  }, [isActionSheetOpen, selectedMessage])

  useEffect(() => {
    if (!editingMessageId) {
      return
    }

    const nextEditingMessage = messages.find((message) => message.id === editingMessageId)

    if (!nextEditingMessage) {
      setEditingMessageId(null)
      setDraftMessage('')
      return
    }

    if (nextEditingMessage.messageType !== 'text') {
      clearEditingMessage()
    }
  }, [editingMessageId, messages])

  useEffect(() => {
    let isMounted = true

    async function loadPage() {
      if (!currentUserId) {
        return
      }

      try {
        const cachedRecentMessages = getCachedRecentChatMessages(threadId)
        const hasCachedMessages = Boolean(cachedRecentMessages?.messages.length)

        let initialMessages = cachedRecentMessages?.messages ?? null

        if (!initialMessages) {
          const prefetchedMessages = await getPrefetchedRecentChatMessages(INITIAL_CHAT_MESSAGE_LIMIT, threadId)
          initialMessages = prefetchedMessages
        }

        if (!initialMessages) {
          initialMessages = await loadRecentChatMessages(INITIAL_CHAT_MESSAGE_LIMIT, threadId)
        }

        if (!isMounted) {
          return
        }

        const nextMessages = applyPendingMediaTasksToMessages(keepLatestRenderedMessages(initialMessages))
        const shouldSkipEquivalentInitialReplace =
          messagesRef.current.length > 0 &&
          areThreadOpenMessageListsEquivalent(messagesRef.current, nextMessages)

        if (threadId && isThreadOpenDebugActive(threadId)) {
          logChatSendDebug('thread_open_initial_messages_loaded', {
            threadId,
            ...summarizeThreadOpenMessages(nextMessages),
            source: 'initial_load',
            replacedWholeList: true,
            mergedIntoCurrentList: false,
          })

          if (shouldSkipEquivalentInitialReplace) {
            logChatSendDebug('thread_open_messages_replace_skipped', {
              threadId,
              source: 'initial_load',
              reason: 'equivalent_message_set',
              ...summarizeThreadOpenMessages(nextMessages),
              ...buildThreadOpenMessageChangeStats(messagesRef.current, nextMessages),
            })
          } else {
            logThreadOpenMessageMutation(messagesRef.current, nextMessages, {
              source: 'initial_load',
              replacedWholeList: true,
              mergedIntoCurrentList: false,
            })
          }
        }

        if (!shouldSkipEquivalentInitialReplace) {
          setMessages(nextMessages)
        }
        setError('')
        setHasMoreOlderMessages(cachedRecentMessages?.hasMoreOlderMessages ?? (initialMessages.length === INITIAL_CHAT_MESSAGE_LIMIT))
        if (!hasCachedMessages) {
          setPendingInitialScroll(false)
          setHasDeferredInitialSettle(initialMessages.length > 0)
        }
      } catch {
        if (isMounted) {
          setError('Не удалось загрузить чат')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    void loadPage()

    return () => {
      isMounted = false
    }
  }, [applyPendingMediaTasksToMessages, currentUserId, isThreadOpenDebugActive, keepLatestRenderedMessages, logThreadOpenMessageMutation, threadId])

  useEffect(() => {
    if (loading || !isThreadLayoutReady || !hasDeferredInitialSettle) {
      return
    }

    if (messages.length === 0) {
      return
    }

    setPendingInitialScroll(true)
    setHasDeferredInitialSettle(false)
  }, [
    hasDeferredInitialSettle,
    isThreadLayoutReady,
    loading,
    messages.length,
  ])

  useLayoutEffect(() => {
    if (loading || !pendingInitialScroll) {
      return
    }

    if (messages.length === 0) {
      return
    }

    if (!isThreadLayoutReady) {
      return
    }

    initialBottomLockUserCancelledRef.current = false
    initialBottomLockNextSourceRef.current = 'initial-open'
    initialBottomLockLastGeometryRef.current = getInitialBottomLockGeometry()
    initialBottomLockStableSampleCountRef.current = 0
    setIsInitialBottomLockActive(true)
    setPendingInitialScroll(false)
  }, [
    getInitialBottomLockGeometry,
    isThreadLayoutReady,
    loading,
    messages.length,
    pendingInitialScroll,
  ])

  useLayoutEffect(() => {
    if (!isInitialBottomLockActive || loading || messages.length === 0) {
      return
    }

    const source = initialBottomLockNextSourceRef.current ?? 'bottom-lock-layout-effect'
    initialBottomLockNextSourceRef.current = null
    keepInitialBottomLockAnchored(source)
  }, [isInitialBottomLockActive, keepInitialBottomLockAnchored, loading, messages.length])

  useEffect(() => {
    if (!isInitialBottomLockActive) {
      return
    }

    const scrollContainer = scrollContainerRef.current
    const scrollContent = scrollContentRef.current

    if (!scrollContainer) {
      return
    }

    function handleLayoutChange(source: string) {
      keepInitialBottomLockAnchored(source)
    }

    if (typeof ResizeObserver === 'undefined') {
      const handleWindowResize = () => {
        handleLayoutChange('window-resize')
      }

      window.addEventListener('resize', handleWindowResize)

      return () => {
        window.removeEventListener('resize', handleWindowResize)
      }
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const source =
          entry.target === scrollContainerRef.current
            ? 'resize-observer-scroll-container'
            : entry.target === scrollContentRef.current
              ? 'resize-observer-content'
              : 'resize-observer-unknown'

        keepInitialBottomLockAnchored(source)
      }
    })

    observer.observe(scrollContainer)
    if (scrollContent) {
      observer.observe(scrollContent)
    }
    const handleWindowResize = () => {
      handleLayoutChange('window-resize')
    }
    window.addEventListener('resize', handleWindowResize)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', handleWindowResize)
    }
  }, [isInitialBottomLockActive, keepInitialBottomLockAnchored])

  useEffect(() => {
    if (!isInitialBottomLockActive) {
      return
    }

    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer) {
      return
    }

    function handleScroll() {
      if (!initialBottomLockUserScrollIntentRef.current) {
        return
      }

      if (initialBottomLockProgrammaticFrameRef.current !== null || initialBottomLockProgrammaticResetFrameRef.current !== null) {
        return
      }

      if (isNearBottom(24)) {
        return
      }

      initialBottomLockUserScrollIntentRef.current = false
      initialBottomLockUserCancelledRef.current = true
      deactivateInitialBottomLock('user-scroll-away', true)
    }

    function markUserScrollIntent() {
      initialBottomLockUserScrollIntentRef.current = true
    }

    function clearUserScrollIntent() {
      initialBottomLockUserScrollIntentRef.current = false
    }

    scrollContainer.addEventListener('wheel', markUserScrollIntent, { passive: true })
    scrollContainer.addEventListener('touchstart', markUserScrollIntent, { passive: true })
    scrollContainer.addEventListener('touchend', clearUserScrollIntent, { passive: true })
    scrollContainer.addEventListener('touchcancel', clearUserScrollIntent, { passive: true })
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      scrollContainer.removeEventListener('wheel', markUserScrollIntent)
      scrollContainer.removeEventListener('touchstart', markUserScrollIntent)
      scrollContainer.removeEventListener('touchend', clearUserScrollIntent)
      scrollContainer.removeEventListener('touchcancel', clearUserScrollIntent)
      scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [deactivateInitialBottomLock, isInitialBottomLockActive, isNearBottom])

  useEffect(() => {
    if (!pendingAutoScrollToBottomRef.current || messages.length === 0) {
      return
    }

    if (prependScrollRestoreRef.current || isLoadingOlderMessagesRef.current) {
      pendingAutoScrollToBottomRef.current = false
      return
    }

    let nestedAnimationFrameId: number | null = null
    const animationFrameId = window.requestAnimationFrame(() => {
      nestedAnimationFrameId = window.requestAnimationFrame(() => {
        scrollPageToBottom('auto', 'pending-auto-scroll')
        pendingAutoScrollToBottomRef.current = false
      })
    })

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      if (nestedAnimationFrameId !== null) {
        window.cancelAnimationFrame(nestedAnimationFrameId)
      }
    }
  }, [messages, scrollPageToBottom])

  useLayoutEffect(() => {
    const pendingRestore = prependScrollRestoreRef.current

    if (!pendingRestore) {
      return
    }

    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer || pendingRestore.scrollTop === null) {
      prependScrollRestoreRef.current = null
      return
    }

    const scrollHeightDelta = scrollContainer.scrollHeight - pendingRestore.scrollHeight
    if (scrollHeightDelta === 0) {
      prependScrollRestoreRef.current = null
      return
    }

    scrollContainer.scrollTop = Math.max(0, pendingRestore.scrollTop + scrollHeightDelta)
    prependScrollRestoreRef.current = null
  }, [messages])

  useEffect(() => {
    if (pendingNewMessagesCount === 0) {
      return
    }

    function handleScroll() {
      if (isNearBottom()) {
        setPendingNewMessagesCount(0)
      }
    }

    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer) {
      return
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll)

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [isNearBottom, pendingNewMessagesCount])

  useEffect(() => {
    if (
      loading ||
      !currentUserId ||
      !oldestLoadedMessageCreatedAt ||
      !oldestLoadedMessageId ||
      !hasMoreOlderMessages
    ) {
      return
    }

    function handleScroll() {
      void loadOlderMessages()
    }

    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer) {
      return
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [
    hasMoreOlderMessages,
    currentUserId,
    loadOlderMessages,
    loading,
  ])

  useEffect(() => {
    if (
      loading ||
      messages.length === 0 ||
      !hasMoreOlderMessages ||
      !currentUserId ||
      !oldestLoadedMessageCreatedAt ||
      !oldestLoadedMessageId
    ) {
      return
    }

    let isCancelled = false
    let frameId: number | null = null

    async function waitForLayout() {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve())
        })
      })
    }

    async function autoLoadOlderMessagesToFillViewport() {
      await waitForLayout()

      let remainingBatches = AUTO_FILL_OLDER_MESSAGES_MAX_BATCHES
      let canLoadMore = hasMoreOlderMessages

      while (!isCancelled && canLoadMore && remainingBatches > 0) {
        const scrollContainer = scrollContainerRef.current

        if (!scrollContainer || scrollContainer.scrollHeight > scrollContainer.clientHeight) {
          return
        }

        const result = await loadOlderMessages({ requireNearTop: false })

        if (isCancelled || !result?.didLoad) {
          return
        }

        canLoadMore = result.hasMoreOlderMessages
        remainingBatches -= 1
        await waitForLayout()
      }
    }

    frameId = window.requestAnimationFrame(() => {
      void autoLoadOlderMessagesToFillViewport()
    })

    return () => {
      isCancelled = true

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [
    currentUserId,
    hasMoreOlderMessages,
    loadOlderMessages,
    loading,
    messages.length,
    oldestLoadedMessageCreatedAt,
    oldestLoadedMessageId,
    threadId,
  ])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer) {
      return
    }

    function resetFocusedGestureTracking() {
      focusedGestureStartScrollTopRef.current = null
      focusedGestureStartClientYRef.current = null
      focusedGestureBlurredRef.current = false
    }

    function handleTouchStart(event: TouchEvent) {
      if (!isComposerFocused || window.innerWidth >= 768) {
        resetFocusedGestureTracking()
        return
      }

      const activeScrollContainer = scrollContainerRef.current
      const touch = event.touches[0]

      if (!touch || !activeScrollContainer) {
        resetFocusedGestureTracking()
        return
      }

      focusedGestureStartScrollTopRef.current = activeScrollContainer.scrollTop
      focusedGestureStartClientYRef.current = touch.clientY
      focusedGestureBlurredRef.current = false
    }

    function handleTouchMove(event: TouchEvent) {
      if (!isComposerFocused || focusedGestureBlurredRef.current) {
        return
      }

      const activeScrollContainer = scrollContainerRef.current
      const touch = event.touches[0]
      const gestureStartScrollTop = focusedGestureStartScrollTopRef.current
      const gestureStartClientY = focusedGestureStartClientYRef.current
      const textarea = composerTextareaRef.current

      if (!touch || !activeScrollContainer || gestureStartScrollTop === null || gestureStartClientY === null || !textarea) {
        return
      }

      const dragDistance = touch.clientY - gestureStartClientY
      const scrollDelta = gestureStartScrollTop - activeScrollContainer.scrollTop
      const isIntentionalUpwardScroll = dragDistance > 18 && scrollDelta > 24

      if (!isIntentionalUpwardScroll) {
        return
      }

      focusedGestureBlurredRef.current = true
      textarea.blur()
    }

    scrollContainer.addEventListener('touchstart', handleTouchStart, { passive: true })
    scrollContainer.addEventListener('touchmove', handleTouchMove, { passive: true })
    scrollContainer.addEventListener('touchend', resetFocusedGestureTracking, { passive: true })
    scrollContainer.addEventListener('touchcancel', resetFocusedGestureTracking, { passive: true })

    return () => {
      scrollContainer.removeEventListener('touchstart', handleTouchStart)
      scrollContainer.removeEventListener('touchmove', handleTouchMove)
      scrollContainer.removeEventListener('touchend', resetFocusedGestureTracking)
      scrollContainer.removeEventListener('touchcancel', resetFocusedGestureTracking)
    }
  }, [isComposerFocused])

  useEffect(() => {
    if (loading || !currentUserId) {
      return
    }

    const messageChangeConfig = {
      schema: 'public',
      table: 'chat_messages',
      ...(threadId ? { filter: `thread_id=eq.${threadId}` } : {}),
    }

    const channel = supabase
      .channel(threadId ? `chat-messages:${threadId}` : 'chat-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          ...messageChangeConfig,
        },
        async (payload) => {
          const realtimeRow = toRealtimeChatMessageRow(payload.new)
          const nextMessageId = realtimeRow?.id ?? ''
          const shouldAutoScroll = isNearBottom()
          const optimisticServerMatch = messagesRef.current.find((message) =>
            message.isOptimistic &&
            message.optimisticServerMessageId === nextMessageId
          ) ?? null

          if (!realtimeRow || !nextMessageId) {
            return
          }

          if (threadId && isThreadOpenDebugActive(threadId)) {
            logChatSendDebug('thread_open_realtime_insert_received', {
              threadId,
              ...summarizeThreadOpenMessages(messagesRef.current),
              source: 'realtime_insert',
              replacedWholeList: false,
              mergedIntoCurrentList: true,
            })
          }

          if (
            messagesRef.current.some((message) => message.id === nextMessageId) &&
            !optimisticServerMatch
          ) {
            return
          }

          if (pendingDeletedMessageIdsRef.current.has(nextMessageId)) {
            return
          }

          try {
            const optimisticVoiceMatch =
              optimisticServerMatch?.messageType === 'voice'
                ? optimisticServerMatch
                : messagesRef.current.find((message) =>
                    message.isOptimistic &&
                    message.messageType === 'voice' &&
                    resolveRealtimeMessageType(realtimeRow) === 'voice' &&
                    message.userId === realtimeRow.user_id &&
                    message.mediaUrl === realtimeRow.media_url
                  ) ?? null

            if (optimisticVoiceMatch) {
              const finalizedMessage = finalizeOptimisticMessageFromRealtimeRow(optimisticVoiceMatch, realtimeRow)
              clearOptimisticRealtimeFallbackTimeout(nextMessageId)
              updateChatSendErrorGuardState(optimisticVoiceMatch.id, {
                hasReconciliationSuccess: true,
              })
              logChatSendDebug('reconciliation_success', {
                threadId,
                optimisticMessageId: optimisticVoiceMatch.id,
                serverMessageId: nextMessageId,
                source: 'realtime_insert',
                messageType: 'voice',
              })
              markChatSendTimingReconciliationSuccess({
                optimisticMessageId: optimisticVoiceMatch.id,
                serverMessageId: nextMessageId,
                source: 'realtime_insert',
              })
              releaseOptimisticClientMedia(optimisticVoiceMatch)
              setMessages((currentMessages) =>
                {
                  const nextMessages = keepLatestRenderedMessages(
                    replaceMessageById(currentMessages, optimisticVoiceMatch.id, finalizedMessage),
                    {
                      preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
                    }
                  )
                  logThreadOpenMessageMutation(currentMessages, nextMessages, {
                    source: 'realtime_insert',
                    replacedWholeList: false,
                    mergedIntoCurrentList: true,
                  })
                  return nextMessages
                }
              )
              return
            }

            const optimisticTextOrImageMatch =
              (
                optimisticServerMatch && optimisticServerMatch.messageType !== 'voice'
                  ? optimisticServerMatch
                  : null
              ) ??
              findMatchingOptimisticTextOrImageMessageForRealtime(messagesRef.current, realtimeRow)

            if (optimisticTextOrImageMatch) {
              const finalizedMessage = finalizeOptimisticMessageFromRealtimeRow(optimisticTextOrImageMatch, realtimeRow)
              const mergedMessage = mergeMessageWithPendingMediaTaskState(
                mergeServerMessageWithOptimisticImageState(
                  {
                    ...optimisticTextOrImageMatch,
                    optimisticServerMessageId: optimisticTextOrImageMatch.optimisticServerMessageId ?? finalizedMessage.id,
                  },
                  finalizedMessage,
                  currentUserId
                )
              )
              clearOptimisticRealtimeFallbackTimeout(nextMessageId)
              updateChatSendErrorGuardState(optimisticTextOrImageMatch.id, {
                hasReconciliationSuccess: true,
              })
              logChatSendDebug('reconciliation_success', {
                threadId,
                optimisticMessageId: optimisticTextOrImageMatch.id,
                serverMessageId: nextMessageId,
                source: 'realtime_insert',
                messageType: finalizedMessage.messageType,
                isStillOptimistic: Boolean(mergedMessage.isOptimistic),
              })
              markChatSendTimingReconciliationSuccess({
                optimisticMessageId: optimisticTextOrImageMatch.id,
                serverMessageId: nextMessageId,
                source: 'realtime_insert',
              })

              if (!mergedMessage.isOptimistic) {
                releaseOptimisticClientMedia(optimisticTextOrImageMatch)
              }
              setMessages((currentMessages) =>
                {
                  const nextMessages = keepLatestRenderedMessages(
                    replaceMessageById(currentMessages, optimisticTextOrImageMatch.id, mergedMessage),
                    {
                      preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
                    }
                  )
                  logThreadOpenMessageMutation(currentMessages, nextMessages, {
                    source: 'realtime_insert',
                    replacedWholeList: false,
                    mergedIntoCurrentList: true,
                  })
                  return nextMessages
                }
              )
              return
            }

            if (shouldAutoScroll) {
              pendingAutoScrollToBottomRef.current = true
              setPendingNewMessagesCount(0)
            } else {
              setPendingNewMessagesCount((currentCount) => currentCount + 1)
            }

            const nextMessage = await loadChatMessageItem(nextMessageId, threadId)

            if (!nextMessage) {
              return
            }

            setMessages((currentMessages) =>
              {
                const nextMessages = keepLatestRenderedMessages(
                  insertMessageChronologically(
                    currentMessages,
                    mergeMessageWithPendingMediaTaskState(nextMessage)
                  ),
                  {
                  preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
                  }
                )
                logThreadOpenMessageMutation(currentMessages, nextMessages, {
                  source: 'realtime_insert',
                  replacedWholeList: false,
                  mergedIntoCurrentList: true,
                })
                return nextMessages
              }
            )
          } catch (error) {
            logChatSendDebugError('reconciliation_failure', {
              threadId,
              serverMessageId: nextMessageId,
              source: 'realtime_insert',
              category: 'optimistic_reconcile_error',
              error: getChatSendDebugErrorDetails(error),
            })
            void refreshMessages()
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          ...messageChangeConfig,
        },
        async (payload) => {
          const nextMessageId = String((payload.new as { id?: string } | null)?.id ?? '')

          if (!nextMessageId) {
            return
          }

          if (threadId && isThreadOpenDebugActive(threadId)) {
            logChatSendDebug('thread_open_realtime_update_received', {
              threadId,
              ...summarizeThreadOpenMessages(messagesRef.current),
              source: 'realtime_update',
              replacedWholeList: false,
              mergedIntoCurrentList: true,
            })
          }

          try {
            const nextMessage = await loadChatMessageItem(nextMessageId, threadId)

            if (!nextMessage) {
              pendingDeletedMessageIdsRef.current.delete(nextMessageId)
              setMessages((currentMessages) => {
                const nextMessages = removeMessageById(currentMessages, nextMessageId)
                logThreadOpenMessageMutation(currentMessages, nextMessages, {
                  source: 'realtime_update',
                  replacedWholeList: false,
                  mergedIntoCurrentList: true,
                })
                return nextMessages
              })
              return
            }

            if (pendingDeletedMessageIdsRef.current.has(nextMessageId)) {
              return
            }

            const currentRenderedMessage =
              messagesRef.current.find((message) => message.id === nextMessage.id) ?? null
            const mergedMessage = currentRenderedMessage
              ? mergeServerMessageWithOptimisticImageState(currentRenderedMessage, nextMessage, currentUserId)
              : nextMessage

            setMessages((currentMessages) =>
              {
                const nextMessages = keepLatestRenderedMessages(
                  upsertMessageById(currentMessages, mergeMessageWithPendingMediaTaskState(mergedMessage)),
                  {
                  preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
                  }
                )
                logThreadOpenMessageMutation(currentMessages, nextMessages, {
                  source: 'realtime_update',
                  replacedWholeList: false,
                  mergedIntoCurrentList: true,
                })
                return nextMessages
              }
            )
          } catch {
            // Keep realtime additive and non-blocking if enrichment fails.
          }
        }
      )
      .subscribe((status) => {
        if (
          status === 'SUBSCRIBED' &&
          threadId &&
          isThreadOpenDebugActive(threadId)
        ) {
          logChatSendDebug('thread_open_realtime_subscription_ready', {
            threadId,
            ...summarizeThreadOpenMessages(messagesRef.current),
            source: 'unknown',
            replacedWholeList: false,
            mergedIntoCurrentList: false,
          })
        }
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [
    clearOptimisticRealtimeFallbackTimeout,
    currentUserId,
    isNearBottom,
    keepLatestRenderedMessages,
    loading,
    refreshMessages,
    releaseOptimisticClientMedia,
    logThreadOpenMessageMutation,
    isThreadOpenDebugActive,
    threadId,
  ])

  useEffect(() => {
    if (loading || !currentUserId) {
      return
    }

    const channel = supabase
      .channel(threadId ? `chat-message-reactions:${threadId}` : 'chat-message-reactions')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_message_reactions',
        },
        (payload) => {
          const reaction = payload.new as { message_id?: string; user_id?: string; emoji?: string } | null
          const messageId = String(reaction?.message_id ?? '')
          const userId = String(reaction?.user_id ?? '')
          const emoji = String(reaction?.emoji ?? '')

          if (!messageId || !userId || !emoji || !messagesRef.current.some((message) => message.id === messageId)) {
            return
          }

          setMessages((currentMessages) =>
            updateMessageReaction(currentMessages, messageId, userId, emoji, getReactionProfileForUser(userId), true)
          )
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'chat_message_reactions',
        },
        (payload) => {
          const reaction = payload.old as { message_id?: string; user_id?: string; emoji?: string } | null
          const messageId = String(reaction?.message_id ?? '')
          const userId = String(reaction?.user_id ?? '')
          const emoji = String(reaction?.emoji ?? '')

          if (!messageId || !userId || !emoji || !messagesRef.current.some((message) => message.id === messageId)) {
            return
          }

          setMessages((currentMessages) =>
            updateMessageReaction(currentMessages, messageId, userId, emoji, getReactionProfileForUser(userId), false)
          )
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [currentUserId, loading, threadId])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!currentUserId || submitting) {
      return
    }

    if (!trimmedDraftMessage && pendingImages.length === 0) {
      setSubmitError('Введите сообщение или выберите фото')
      return
    }

    if (isMessageTooLong) {
      setSubmitError(`Сообщение должно быть не длиннее ${CHAT_MESSAGE_MAX_LENGTH} символов`)
      return
    }

    setSubmitting(true)
    setSubmitError('')
    let submitOptimisticMessageId: string | null = null

    try {
      const editingMessageSnapshot = editingMessage
      const nextEditedAt = new Date().toISOString()

      if (editingMessageId) {
        if (!editingMessageSnapshot || editingMessageSnapshot.messageType !== 'text') {
          setSubmitError('Нельзя редактировать нетекстовое сообщение')
          clearEditingMessage()
          return
        }

        if (!trimmedDraftMessage) {
          setSubmitError('Введите текст сообщения')
          return
        }

        const { error: updateError } = await updateChatMessage(
          editingMessageId,
          currentUserId,
          trimmedDraftMessage,
          threadId
        )

        if (updateError) {
          throw updateError
        }

        if (editingMessageSnapshot) {
          setMessages((currentMessages) =>
            keepLatestRenderedMessages(
              currentMessages.map((message) =>
                message.id === editingMessageId
                  ? {
                      ...message,
                      text: trimmedDraftMessage,
                      previewText: trimmedDraftMessage,
                      editedAt: nextEditedAt,
                    }
                  : message
              )
            )
          )
        }
      } else {
        const optimisticMessage = createOptimisticTextOrImageMessage({
          userId: currentUserId,
          text: trimmedDraftMessage,
          attachments: pendingImages,
        })
        const sendContentKind = getChatSendContentKind({
          textLength: trimmedDraftMessage.length,
          imageCount: pendingImages.length,
        })
        registerChatSendTimingTap(optimisticMessage.id, sendContentKind)
        logChatSendDebug('send_start', {
          threadId,
          optimisticMessageId: optimisticMessage.id,
          textLength: trimmedDraftMessage.length,
          attachmentCounts: getComposerAttachmentDebugCounts(pendingImages),
          attachmentKinds: pendingImages.length > 0 ? ['image'] : [],
          contentKind: sendContentKind,
        })
        submitOptimisticMessageId = optimisticMessage.id

        setDraftMessage('')
        clearSelectedImages({ revokePreviews: false })
        setReplyingToMessage(null)
        setEditingMessageId(null)
        window.requestAnimationFrame(() => {
          resizeComposerTextarea()
        })

        await sendOptimisticTextOrImageMessage(optimisticMessage)
      }

      setPendingNewMessagesCount(0)
      if (editingMessageId) {
        setDraftMessage('')
        clearSelectedImages()
        setReplyingToMessage(null)
        setEditingMessageId(null)
        window.requestAnimationFrame(() => {
          resizeComposerTextarea()
        })
      }
    } catch (error) {
      const guardState = getChatSendErrorGuardState(submitOptimisticMessageId)
      logChatSendDebug('error_guard_check', {
        threadId,
        optimisticMessageId: submitOptimisticMessageId,
        hasRequestSuccess: guardState.hasRequestSuccess,
        hasResponseOk: guardState.hasResponseOk,
        hasReconciliationSuccess: guardState.hasReconciliationSuccess,
      })

      if (guardState.hasRequestSuccess) {
        setSubmitError('')
        return
      }

      logChatSendDebugError('ui_error_path_trigger', {
        threadId,
        optimisticMessageId: submitOptimisticMessageId,
        category: getChatSendDebugErrorCategory(error),
        error: getChatSendDebugErrorDetails(error),
      })
      setSubmitError('Не удалось отправить сообщение')
    } finally {
      setSubmitting(false)
    }
  }

  function handleDeleteMessage(message: ChatMessageItem) {
    if (!currentUserId || deletingMessageId || message.userId !== currentUserId || message.isDeleted) {
      return
    }

    setDeleteConfirmationMessage(message)
  }

  async function confirmDeleteMessage() {
    const message = deleteConfirmationMessage

    if (!currentUserId || !message || deletingMessageId || message.userId !== currentUserId || message.isDeleted) {
      return
    }

    setDeletingMessageId(message.id)
    setDeleteConfirmationMessage(null)
    pendingDeletedMessageIdsRef.current.add(message.id)
    setMessages((currentMessages) => removeMessageById(currentMessages, message.id))

    try {
      const { error: deleteError } = await softDeleteChatMessage(message.id, currentUserId, threadId)

      if (deleteError) {
        throw deleteError
      }

      if (message.messageType === 'voice' && message.mediaUrl) {
        try {
          const { error: storageDeleteError } = await supabase.storage
            .from(CHAT_VOICE_BUCKET)
            .remove([message.mediaUrl])

          if (storageDeleteError) {
            throw storageDeleteError
          }
        } catch (error) {
          console.error('Failed to delete voice message file from storage', {
            messageId: message.id,
            mediaUrl: message.mediaUrl,
            error,
          })
        }
      }

      if (message.attachments.length > 0) {
        const removableStoragePaths = message.attachments
          .map((attachment) => attachment.storagePath)
          .filter((storagePath): storagePath is string => Boolean(storagePath))

        if (removableStoragePaths.length > 0) {
          await Promise.allSettled(
            removableStoragePaths.map(async (storagePath) => {
              await deleteUploadedChatImage(storagePath)
            })
          )
        }
      }

    } catch {
      pendingDeletedMessageIdsRef.current.delete(message.id)
      setMessages((currentMessages) =>
        keepLatestRenderedMessages(insertMessageChronologically(currentMessages, message), {
          preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
        })
      )
      setError('Не удалось удалить сообщение')
    } finally {
      setDeletingMessageId(null)
    }
  }

  const handleRetryFailedMessage = useCallback(async (message: ChatMessageItem) => {
    if (!currentUserId || message.userId !== currentUserId || message.messageType === 'voice') {
      return
    }

    setSubmitError('')
    setError('')

    const serverMessageId = message.optimisticServerMessageId ?? (!message.id.startsWith('temp-') ? message.id : null)

    if (serverMessageId && retryPendingChatMediaTask(serverMessageId)) {
      return
    }

    if (!message.isOptimistic || message.optimisticStatus !== 'failed') {
      return
    }

    try {
      await sendOptimisticTextOrImageMessage(message)
    } catch {
      setSubmitError('Не удалось повторно отправить сообщение')
    }
  }, [currentUserId, sendOptimisticTextOrImageMessage])

  function handleActionSheetOpenChange(open: boolean) {
    setIsActionSheetOpen(open)

    if (!open) {
      setSelectedMessageAnchorRect(null)
      setSelectedMessage(null)
    }
  }

  function handleReplyToMessage(message: ChatMessageItem) {
    if (!messagesRef.current.some((currentMessage) => currentMessage.id === message.id)) {
      setReplyingToMessage(null)
      return
    }

    setReplyingToMessage(message)
    setEditingMessageId(null)
  }

  const getReactionProfileForUser = useCallback((userId: string) => {
    const matchingMessage = messagesRef.current.find((message) => message.userId === userId) ?? null

    return {
      displayName: matchingMessage?.displayName ?? (userId === currentUserId ? 'Вы' : 'Бегун'),
      avatarUrl: matchingMessage?.avatarUrl ?? null,
    }
  }, [currentUserId])

  const handleToggleReaction = useCallback(async (messageId: string, emoji: string) => {
    if (!currentUserId) {
      return
    }

    const currentMessage = messagesRef.current.find((message) => message.id === messageId) ?? null

    if (!currentMessage) {
      return
    }

    const hasReacted = currentMessage.reactions.some(
      (reaction) => reaction.emoji === emoji && reaction.userIds.includes(currentUserId)
    )
    const currentUserReactionProfile = getReactionProfileForUser(currentUserId)
    const nextShouldActivate = !hasReacted
    const nextAnimatedReactionKey = nextShouldActivate ? `${messageId}:${emoji}` : null

    if (nextAnimatedReactionKey) {
      if (animatedReactionTimeoutRef.current !== null) {
        window.clearTimeout(animatedReactionTimeoutRef.current)
      }

      setAnimatedReactionKey(nextAnimatedReactionKey)
      animatedReactionTimeoutRef.current = window.setTimeout(() => {
        setAnimatedReactionKey((currentKey) => (currentKey === nextAnimatedReactionKey ? null : currentKey))
        animatedReactionTimeoutRef.current = null
      }, REACTION_ANIMATION_DURATION_MS + 40)
    }

    setMessages((currentMessages) =>
      updateMessageReaction(currentMessages, messageId, currentUserId, emoji, currentUserReactionProfile, nextShouldActivate)
    )

    try {
      await toggleChatMessageReaction(messageId, currentUserId, emoji)
    } catch (error) {
      console.error('Failed to toggle chat reaction', error)
      if (nextAnimatedReactionKey) {
        setAnimatedReactionKey((currentKey) => (currentKey === nextAnimatedReactionKey ? null : currentKey))
      }
      setMessages((currentMessages) =>
        updateMessageReaction(currentMessages, messageId, currentUserId, emoji, currentUserReactionProfile, hasReacted)
      )
    }
  }, [currentUserId, getReactionProfileForUser])

  function clearEditingMessage() {
    setEditingMessageId(null)
    setDraftMessage('')
    setSubmitError('')
    window.requestAnimationFrame(() => {
      resizeComposerTextarea()
    })
  }

  function handleEditMessage(message: ChatMessageItem) {
    if (message.messageType !== 'text') {
      setSubmitError('Нельзя редактировать нетекстовое сообщение')
      setSelectedMessage(null)
      setIsActionSheetOpen(false)
      return
    }

    setEditingMessageId(message.id)
    setReplyingToMessage(null)
    clearSelectedImages()
    setDraftMessage(message.text)
    setSubmitError('')
    setSelectedMessage(null)
    setIsActionSheetOpen(false)
    window.requestAnimationFrame(() => {
      resizeComposerTextarea()
      composerTextareaRef.current?.focus()
    })
  }

  function resetImageInput() {
    if (imageInputRef.current) {
      imageInputRef.current.value = ''
    }
  }

  function clearSelectedImages(options?: { revokePreviews?: boolean }) {
    const shouldRevokePreviews = options?.revokePreviews ?? true
    const imagesToClear = pendingImagesRef.current

    setPendingImages([])
    resetImageInput()

    if (!shouldRevokePreviews || imagesToClear.length === 0) {
      return
    }

    imagesToClear.forEach((image) => {
      revokeObjectUrlIfNeeded(image.previewUrl)
    })
  }

  function handleRemovePendingImage(imageId: string) {
    const imageToRemove = pendingImagesRef.current.find((image) => image.id === imageId) ?? null

    setPendingImages((currentImages) =>
      currentImages.filter((image) => image.id !== imageId)
    )
    resetImageInput()

    if (!imageToRemove) {
      return
    }

    revokeObjectUrlIfNeeded(imageToRemove.previewUrl)
  }

  async function handleImageInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFiles = Array.from(event.target.files ?? [])
    resetImageInput()

    if (nextFiles.length === 0) {
      return
    }

    if (!currentUserId) {
      clearSelectedImages()
      setSubmitError('Нужно войти, чтобы отправлять фото')
      return
    }

    const availableSlots = CHAT_MESSAGE_MAX_ATTACHMENTS - pendingImagesRef.current.length

    if (availableSlots <= 0) {
      setSubmitError(`Можно прикрепить не больше ${CHAT_MESSAGE_MAX_ATTACHMENTS} фото`)
      return
    }

    const filesToUpload = nextFiles.slice(0, availableSlots)
    logChatSendDebug('local_files_picked', {
      threadId,
      attachmentCount: filesToUpload.length,
      attachmentKinds: filesToUpload.length > 0 ? ['image'] : [],
      attachments: filesToUpload.map((file) => ({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      })),
    })

    if (filesToUpload.some((file) => !file.type.startsWith('image/'))) {
      setSubmitError('Можно выбрать только изображения')
      return
    }

    setSubmitError('')
    setUploadingImage(true)

    try {
      const pendingSelections = await Promise.all(filesToUpload.map(async (file, index) => {
        const previewUrl = URL.createObjectURL(file)
        const dimensions = await new Promise<{ width: number | null; height: number | null }>((resolve) => {
          const image = new window.Image()
          image.onload = () => {
            resolve({
              width: Number.isFinite(image.naturalWidth) && image.naturalWidth > 0 ? image.naturalWidth : null,
              height: Number.isFinite(image.naturalHeight) && image.naturalHeight > 0 ? image.naturalHeight : null,
            })
          }
          image.onerror = () => {
            resolve({ width: null, height: null })
          }
          image.src = previewUrl
        })

        return {
          id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          previewUrl,
          width: dimensions.width,
          height: dimensions.height,
        } satisfies PendingComposerImage
      }))

      setPendingImages((currentImages) => [...currentImages, ...pendingSelections])
      logChatSendDebug('local_files_prepared', {
        threadId,
        attachmentCount: pendingSelections.length,
        attachments: pendingSelections.map((selection) => ({
          id: selection.id,
          width: selection.width,
          height: selection.height,
        })),
      })

      if (filesToUpload.length < nextFiles.length) {
        setSubmitError(`Можно прикрепить не больше ${CHAT_MESSAGE_MAX_ATTACHMENTS} фото`)
      }
    } finally {
      setUploadingImage(false)
    }
  }

  function cleanupVoiceRecordingResources() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    mediaRecorderRef.current = null

    chunksRef.current = []
    startTimeRef.current = 0
    isStoppingVoiceRecordingRef.current = false
    hasHandledVoiceRecordingStopRef.current = false
    shouldCancelVoiceRecordingRef.current = false
    setRecordingTime(0)
    setIsRecordingVoice(false)
    setIsSendingVoice(false)
    setIsStartingVoiceRecording(false)
  }

  function revokeOptimisticVoiceObjectUrl(message: Pick<ChatMessageItem, 'isOptimistic' | 'optimisticLocalObjectUrl'>) {
    if (!message.isOptimistic || !message.optimisticLocalObjectUrl) {
      return
    }

    URL.revokeObjectURL(message.optimisticLocalObjectUrl)
  }

  function revokeOptimisticImageObjectUrls(message: Pick<ChatMessageItem, 'isOptimistic' | 'attachments'>) {
    if (!message.isOptimistic) {
      return
    }

    if ('optimisticServerMessageId' in message) {
      const taskMessageId =
        typeof message.optimisticServerMessageId === 'string' && message.optimisticServerMessageId
          ? message.optimisticServerMessageId
          : null

      if (taskMessageId && hasPendingChatMediaTask(taskMessageId)) {
        return
      }
    }

    message.attachments.forEach((attachment) => {
      revokeObjectUrlIfNeeded(attachment.publicUrl)
    })
  }

  function getOptimisticServerMessageId(message: ChatMessageItem) {
    if (message.optimisticServerMessageId) {
      return message.optimisticServerMessageId
    }

    return message.isOptimistic && !message.id.startsWith('temp-') ? message.id : null
  }

  function matchesOptimisticMessageReference(
    message: ChatMessageItem,
    optimisticMessageId: string,
    serverMessageId?: string | null
  ) {
    if (message.id === optimisticMessageId) {
      return true
    }

    if (!serverMessageId) {
      return false
    }

    return message.id === serverMessageId || message.optimisticServerMessageId === serverMessageId
  }

  function scheduleOptimisticRealtimeFallback(optimisticMessageId: string, serverMessageId: string) {
    clearOptimisticRealtimeFallbackTimeout(serverMessageId)
    logChatSendDebug('reconciliation_waiting_realtime', {
      threadId,
      optimisticMessageId,
      serverMessageId,
      source: 'fallback_timer_scheduled',
    })

    optimisticRealtimeFallbackTimeoutsRef.current[serverMessageId] = window.setTimeout(() => {
      delete optimisticRealtimeFallbackTimeoutsRef.current[serverMessageId]

      const currentOptimisticMessage = messagesRef.current.find((message) => message.id === optimisticMessageId)

      if (!currentOptimisticMessage?.isOptimistic) {
        return
      }

      void loadChatMessageItem(serverMessageId, threadId)
        .then((nextMessage) => {
          if (!nextMessage) {
            logChatSendDebugError('reconciliation_failure', {
              threadId,
              optimisticMessageId,
              serverMessageId,
              source: 'fallback_fetch',
              category: 'optimistic_reconcile_error',
              reason: 'message_not_found',
            })
            return
          }

          const mergedMessage = mergeMessageWithPendingMediaTaskState(
            mergeServerMessageWithOptimisticImageState(currentOptimisticMessage, nextMessage, currentUserId)
          )
          updateChatSendErrorGuardState(optimisticMessageId, {
            hasReconciliationSuccess: true,
          })
          logChatSendDebug('reconciliation_success', {
            threadId,
            optimisticMessageId,
            serverMessageId,
            source: 'fallback_fetch',
            isStillOptimistic: Boolean(mergedMessage.isOptimistic),
          })
          markChatSendTimingReconciliationSuccess({
            optimisticMessageId,
            serverMessageId,
            source: 'fallback_fetch',
          })

          if (!mergedMessage.isOptimistic) {
            releaseOptimisticClientMedia(currentOptimisticMessage)
          }
          setMessages((currentMessages) =>
            keepLatestRenderedMessages(
              replaceMessageById(currentMessages, optimisticMessageId, mergedMessage),
              {
                preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
              }
            )
          )
        })
        .catch((error) => {
          logChatSendDebugError('reconciliation_failure', {
            threadId,
            optimisticMessageId,
            serverMessageId,
            source: 'fallback_fetch',
            category: 'optimistic_reconcile_error',
            error: getChatSendDebugErrorDetails(error),
          })
          // Leave the optimistic message intact if the fallback enrichment fails.
        })
    }, 4000)
  }

  function createOptimisticTextOrImageMessage({
    userId,
    text,
    attachments,
  }: {
    userId: string
    text: string
    attachments: PendingComposerImage[]
  }): ChatMessageItem {
    const createdAt = new Date().toISOString()
    const optimisticMessageId = createOptimisticMessageId(attachments.length > 0 ? 'image' : 'text')
    const normalizedAttachments = attachments.map((attachment, index) => ({
      id: `temp-attachment-${index}-${attachment.id}`,
      type: 'image' as const,
      storagePath: null,
      publicUrl: attachment.previewUrl,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
      sortOrder: index,
    }))
    const messageType = normalizedAttachments.length > 0 ? 'image' : 'text'
    const previewText = text.trim() || (normalizedAttachments.length > 1 ? `${normalizedAttachments.length} фото` : normalizedAttachments.length === 1 ? 'Фото' : '')

    return {
      id: optimisticMessageId,
      userId,
      text,
      messageType,
      imageUrl: normalizedAttachments[0]?.publicUrl ?? null,
      attachments: normalizedAttachments,
      mediaUrl: null,
      mediaDurationSeconds: null,
      editedAt: null,
      createdAt,
      createdAtLabel: 'Сейчас',
      isDeleted: false,
      displayName: 'Вы',
      avatarUrl: null,
      replyToId: replyingToMessage?.id ?? null,
      replyTo: getOptimisticMessageReplyPreview(replyingToMessage),
      reactions: [],
      previewText,
      optimisticRenderKey: optimisticMessageId,
      isOptimistic: true,
      optimisticStatus: 'sending',
      optimisticServerMessageId: null,
      optimisticLocalObjectUrl: null,
      optimisticImageFiles: attachments.map((attachment) => attachment.file),
      optimisticAttachmentUploadState: normalizedAttachments.length > 0 ? 'uploading' : null,
      optimisticAttachmentStates: normalizedAttachments.length > 0
        ? normalizedAttachments.map(() => 'pending' as const)
        : null,
    }
  }

  async function sendOptimisticTextOrImageMessage(optimisticMessage: ChatMessageItem) {
    const hasPendingAttachmentUploads = hasPendingOptimisticImageAttachments(optimisticMessage)
    const workingMessage = {
      ...optimisticMessage,
      optimisticStatus: 'sending' as const,
      optimisticAttachmentUploadState: hasPendingAttachmentUploads
        ? 'uploading'
        : optimisticMessage.optimisticAttachmentUploadState,
      optimisticAttachmentStates: hasPendingAttachmentUploads
        ? getOptimisticAttachmentStates(optimisticMessage)
        : optimisticMessage.optimisticAttachmentStates ?? null,
    }
    const shouldAutoScroll = isNearBottom()
    logChatSendDebug('optimistic_message_created', {
      threadId,
      optimisticMessageId: optimisticMessage.id,
      textLength: optimisticMessage.text.trim().length,
      attachmentCounts: {
        image: optimisticMessage.attachments.length,
        voice: 0,
      },
      attachmentKinds: optimisticMessage.attachments.length > 0 ? ['image'] : [],
      contentKind: getChatSendContentKind({
        textLength: optimisticMessage.text.trim().length,
        imageCount: optimisticMessage.attachments.length,
      }),
    })

    if (shouldAutoScroll) {
      pendingAutoScrollToBottomRef.current = true
      setPendingNewMessagesCount(0)
    }

    setMessages((currentMessages) =>
      keepLatestRenderedMessages(
        currentMessages.some((message) => message.id === optimisticMessage.id)
          ? currentMessages.map((message) =>
              message.id === optimisticMessage.id
                ? {
                    ...workingMessage,
                    optimisticStatus: 'sending',
                  }
                : message
            )
          : insertMessageChronologically(currentMessages, workingMessage),
        {
          preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
        }
      )
    )

    queueMicrotask(() => {
      markChatSendTimingOptimisticInsert(optimisticMessage.id)
    })

    let serverMessageId = getOptimisticServerMessageId(workingMessage)

    if (!serverMessageId) {
      chatSendErrorGuardStateRef.current[workingMessage.id] = {
        hasRequestSuccess: false,
        hasResponseOk: false,
        hasReconciliationSuccess: false,
      }
      logChatSendDebug('request_start', {
        threadId,
        optimisticMessageId: workingMessage.id,
        textLength: workingMessage.text.trim().length,
        attachmentCounts: {
          image: workingMessage.attachments.length,
          voice: 0,
        },
        attachmentKinds: workingMessage.attachments.length > 0 ? ['image'] : [],
        contentKind: getChatSendContentKind({
          textLength: workingMessage.text.trim().length,
          imageCount: workingMessage.attachments.length,
        }),
        hasPendingAttachmentUploads,
      })
      const { error: insertError, messageId } = await createChatMessage(
        workingMessage.userId,
        workingMessage.text,
        workingMessage.replyToId ?? null,
        threadId,
        hasPendingAttachmentUploads
          ? []
          : workingMessage.attachments
            .filter((attachment): attachment is ChatMessageAttachment & { storagePath: string } => Boolean(attachment.storagePath))
            .map((attachment) => ({
              storagePath: attachment.storagePath,
              publicUrl: attachment.publicUrl,
              width: attachment.width,
              height: attachment.height,
            })),
        hasPendingAttachmentUploads ? null : workingMessage.imageUrl,
        hasPendingAttachmentUploads
          ? {
              pendingAttachmentCount: workingMessage.attachments.length,
              optimisticMessageId: workingMessage.id,
            }
          : {
              optimisticMessageId: workingMessage.id,
            }
      )

      if (insertError || !messageId) {
        logChatSendDebugError('request_failed', {
          threadId,
          optimisticMessageId: workingMessage.id,
          error: insertError ? getChatSendDebugErrorDetails(insertError) : null,
          messageId,
        })
        setMessages((currentMessages) =>
          keepLatestRenderedMessages(
            currentMessages.map((message) =>
              message.id === workingMessage.id
                ? {
                    ...message,
                    optimisticStatus: 'failed',
                    optimisticAttachmentUploadState: message.messageType === 'image'
                      ? (message.optimisticAttachmentUploadState ?? 'failed')
                      : message.optimisticAttachmentUploadState,
                  }
                : message
            ),
            {
              preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
            }
          )
        )
        throw insertError ?? new Error('chat_message_create_failed')
      }

      serverMessageId = messageId
      updateChatSendErrorGuardState(workingMessage.id, {
        hasRequestSuccess: true,
        hasResponseOk: true,
      })
      setSubmitError('')
      logChatSendDebug('request_success', {
        threadId,
        optimisticMessageId: workingMessage.id,
        serverMessageId: messageId,
      })
      markChatSendTimingRequestSuccess(workingMessage.id, messageId)

      if (hasPendingAttachmentUploads) {
        const queuedTask = queuePendingChatMediaTask({
          messageId,
          threadId,
          userId: workingMessage.userId,
          attachments: workingMessage.attachments.map((attachment, index) => ({
            id: attachment.id,
            sortOrder: attachment.sortOrder,
            file: workingMessage.optimisticImageFiles?.[index] ?? null,
            previewUrl: attachment.publicUrl,
            width: attachment.width,
            height: attachment.height,
          })),
        })
        logChatSendDebug('attachment_task_queued', {
          threadId,
          optimisticMessageId: workingMessage.id,
          serverMessageId: messageId,
          attachmentCount: queuedTask.attachments.length,
          attachmentStates: queuedTask.attachments.map((attachment) => attachment.state),
        })
        markChatSendTimingPhase('attachment_task_queued', {
          optimisticMessageId: workingMessage.id,
          serverMessageId: messageId,
        })

        setMessages((currentMessages) =>
          keepLatestRenderedMessages(
            currentMessages.map((message) =>
              message.id === workingMessage.id
                ? mergeMessageWithPendingMediaTaskState({
                    ...message,
                    optimisticStatus: undefined,
                    optimisticServerMessageId: messageId,
                    optimisticAttachmentUploadState: deriveOptimisticAttachmentUploadState(
                      queuedTask.attachments.map((attachment) => attachment.state)
                    ),
                    optimisticAttachmentStates: queuedTask.attachments.map((attachment) => attachment.state),
                  })
                : message
            ),
            {
              preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
            }
          )
        )
      }

      scheduleOptimisticRealtimeFallback(workingMessage.id, messageId)
      if (!hasPendingAttachmentUploads) {
        logChatSendDebug('text_pending_label_cleared', {
          optimisticMessageId: workingMessage.id,
          serverMessageId: messageId,
        })
        setMessages((currentMessages) =>
          keepLatestRenderedMessages(
            currentMessages.map((message) =>
              message.id === workingMessage.id
                ? {
                    ...message,
                    optimisticStatus: undefined,
                    optimisticServerMessageId: messageId,
                  }
                : message
            ),
            {
              preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
            }
          )
        )
      }
    }
  }

  function createOptimisticVoiceMessage(file: File, userId: string, durationSeconds: number | null): ChatMessageItem {
    const createdAt = new Date().toISOString()
    const localObjectUrl = URL.createObjectURL(file)
    const optimisticMessageId = `temp-${Date.now()}`

    return {
      id: optimisticMessageId,
      userId,
      text: '',
      messageType: 'voice',
      imageUrl: null,
      attachments: [],
      mediaUrl: localObjectUrl,
      mediaDurationSeconds: durationSeconds,
      editedAt: null,
      createdAt,
      createdAtLabel: 'Сейчас',
      isDeleted: false,
      displayName: 'Вы',
      avatarUrl: null,
      replyToId: replyingToMessage?.id ?? null,
      replyTo: replyingToMessage ? {
        id: replyingToMessage.id,
        userId: replyingToMessage.userId,
        displayName: replyingToMessage.displayName,
        text: replyingToMessage.previewText || replyingToMessage.text,
      } : null,
      reactions: [],
      previewText: 'Голосовое сообщение',
      optimisticRenderKey: optimisticMessageId,
      isOptimistic: true,
      optimisticStatus: 'sending',
      optimisticServerMessageId: null,
      optimisticLocalObjectUrl: localObjectUrl,
      optimisticImageFiles: null,
      optimisticAttachmentUploadState: null,
      optimisticAttachmentStates: null,
    }
  }

  function transitionVoiceRecordingToSendingState() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    mediaRecorderRef.current = null

    chunksRef.current = []
    startTimeRef.current = 0
    isStoppingVoiceRecordingRef.current = false
    hasHandledVoiceRecordingStopRef.current = false
    shouldCancelVoiceRecordingRef.current = false
    setRecordingTime(0)
    setIsRecordingVoice(false)
    setIsSendingVoice(true)
    setIsStartingVoiceRecording(false)
  }

  function getVoiceRecorderMimeType() {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return ''
    }

    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      return 'audio/webm;codecs=opus'
    }

    if (MediaRecorder.isTypeSupported('audio/webm')) {
      return 'audio/webm'
    }

    return ''
  }

  function getErrorDetails(error: unknown) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
    }

    if (typeof error === 'object' && error !== null) {
      try {
        return JSON.parse(JSON.stringify(error))
      } catch {
        return { raw: String(error) }
      }
    }

    return { raw: String(error) }
  }

  async function getVoiceFileDurationSeconds(file: File): Promise<number | null> {
    const objectUrl = URL.createObjectURL(file)

    try {
      const durationSeconds = await new Promise<number | null>((resolve) => {
        const audio = new Audio(objectUrl)

        audio.onloadedmetadata = () => {
          const nextDuration = Math.round(audio.duration)
          resolve(Number.isFinite(nextDuration) && nextDuration > 0 ? nextDuration : null)
        }

        audio.onerror = () => {
          resolve(null)
        }
      })

      return durationSeconds
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }

  function cancelVoiceRecording() {
    shouldCancelVoiceRecordingRef.current = true
    void stopVoiceRecording()
  }

  function sendVoiceRecording() {
    shouldCancelVoiceRecordingRef.current = false
    void stopVoiceRecording()
  }

  async function sendRecordedVoiceMessage(file: File) {
    if (!currentUserId || isSendingVoiceMessageRef.current) {
      cleanupVoiceRecordingResources()
      return
    }

    isSendingVoiceMessageRef.current = true
    setUploadingVoice(true)
    setSubmitError('')

    const durationSeconds = await getVoiceFileDurationSeconds(file)
    logChatSendDebug('send_start', {
      threadId,
      textLength: 0,
      attachmentCounts: {
        image: 0,
        voice: 1,
      },
      attachmentKinds: ['voice'],
      contentKind: getChatSendContentKind({
        textLength: 0,
        imageCount: 0,
        voiceCount: 1,
      }),
      durationSeconds,
    })
    const optimisticMessage = createOptimisticVoiceMessage(file, currentUserId, durationSeconds)
    chatSendErrorGuardStateRef.current[optimisticMessage.id] = {
      hasRequestSuccess: false,
      hasResponseOk: false,
      hasReconciliationSuccess: false,
    }
    const shouldAutoScroll = isNearBottom()

    if (shouldAutoScroll) {
      pendingAutoScrollToBottomRef.current = true
      setPendingNewMessagesCount(0)
    }

    setMessages((currentMessages) =>
      keepLatestRenderedMessages(insertMessageChronologically(currentMessages, optimisticMessage), {
        preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
      })
    )

    try {
      const uploadResult = await uploadVoiceMessage({
        file,
        userId: currentUserId,
      })
      const path = uploadResult.path

      setMessages((currentMessages) =>
        keepLatestRenderedMessages(
          currentMessages.map((message) =>
            message.id === optimisticMessage.id
              ? {
                  ...message,
                  mediaUrl: path,
                }
              : message
          ),
          {
            preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
          }
        )
      )
      const { error: insertError, messageId } = await createVoiceChatMessage(
        currentUserId,
        path,
        durationSeconds,
        replyingToMessage?.id ?? null,
        threadId
      )

      if (insertError) {
        throw new Error(`voice_insert_failed:${insertError.message}`)
      }

      updateChatSendErrorGuardState(optimisticMessage.id, {
        hasRequestSuccess: true,
        hasResponseOk: true,
      })
      setSubmitError('')
      logChatSendDebug('request_success', {
        threadId,
        optimisticMessageId: optimisticMessage.id,
        serverMessageId: messageId ?? null,
        contentKind: 'voice',
      })

      setPendingNewMessagesCount(0)
      setReplyingToMessage(null)
      cleanupVoiceRecordingResources()
    } catch (error) {
      const guardState = getChatSendErrorGuardState(optimisticMessage.id)
      logChatSendDebug('error_guard_check', {
        threadId,
        optimisticMessageId: optimisticMessage.id,
        hasRequestSuccess: guardState.hasRequestSuccess,
        hasResponseOk: guardState.hasResponseOk,
        hasReconciliationSuccess: guardState.hasReconciliationSuccess,
      })

      if (guardState.hasRequestSuccess) {
        setSubmitError('')
        cleanupVoiceRecordingResources()
        return
      }

      setMessages((currentMessages) => {
        const optimisticMatch = currentMessages.find((message) => message.id === optimisticMessage.id)

        if (optimisticMatch) {
          revokeOptimisticVoiceObjectUrl(optimisticMatch)
        }

        return removeMessageById(currentMessages, optimisticMessage.id)
      })
      const errorDetails = getErrorDetails(error)
      console.error('Failed to send voice message', errorDetails)

      logChatSendDebugError('ui_error_path_trigger', {
        threadId,
        optimisticMessageId: optimisticMessage.id,
        category: getChatSendDebugErrorCategory(error),
        error: getChatSendDebugErrorDetails(error),
        contentKind: 'voice',
      })
      setSubmitError('Не удалось отправить голосовое сообщение')
      cleanupVoiceRecordingResources()
    } finally {
      isSendingVoiceMessageRef.current = false
      setUploadingVoice(false)
    }
  }

  async function startVoiceRecording() {
    if (mediaRecorderRef.current?.state === 'recording') {
      return
    }

    if (
      !currentUserId ||
      uploadingVoice ||
      submitting ||
      isRecordingVoice ||
      isStartingVoiceRecording ||
      !shouldShowVoiceRecorderButton
    ) {
      return
    }

    if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setSubmitError('Запись голоса не поддерживается на этом устройстве')
      return
    }

    setIsStartingVoiceRecording(true)
    setRecordingTime(0)
    setSubmitError('')
    shouldCancelVoiceRecordingRef.current = false

    try {
      const stream = await getVoiceStream()
      const recorderMimeType = getVoiceRecorderMimeType()
      const recorder = recorderMimeType
        ? new MediaRecorder(stream, { mimeType: recorderMimeType })
        : new MediaRecorder(stream)

      chunksRef.current = []
      startTimeRef.current = Date.now()
      mediaRecorderRef.current = recorder
      isStoppingVoiceRecordingRef.current = false
      hasHandledVoiceRecordingStopRef.current = false

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      })

      recorder.addEventListener('stop', () => {
        if (hasHandledVoiceRecordingStopRef.current) {
          return
        }

        hasHandledVoiceRecordingStopRef.current = true
        const shouldCancelRecording = shouldCancelVoiceRecordingRef.current
        const recordingDurationMs = Date.now() - startTimeRef.current
        const voiceBlob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        })

        scheduleVoiceStreamStop()

        if (shouldCancelRecording) {
          cleanupVoiceRecordingResources()
          return
        }

        if (recordingDurationMs < 400) {
          cleanupVoiceRecordingResources()
          return
        }

        if (voiceBlob.size < 1024) {
          cleanupVoiceRecordingResources()
          console.info('Voice recording ignored because blob is too small', {
            blobSize: voiceBlob.size,
          })
          return
        }

        const voiceFile = new File([voiceBlob], `voice-message-${Date.now()}.webm`, {
          type: voiceBlob.type || 'audio/webm',
        })

        transitionVoiceRecordingToSendingState()
        void sendRecordedVoiceMessage(voiceFile)
      })

      recorder.addEventListener('error', (event) => {
        console.error('Voice recorder error', event)
      })

      recorder.start(250)
      if (timerRef.current !== null) {
        clearInterval(timerRef.current)
      }
      timerRef.current = setInterval(() => {
        setRecordingTime((currentTime) => currentTime + 1)
      }, 1000)
      setIsStartingVoiceRecording(false)
      setIsRecordingVoice(true)
    } catch (error) {
      console.error('Failed to start voice recording', error)
      cleanupVoiceRecordingResources()
      setSubmitError('Не удалось начать запись голоса')
    }
  }

  async function stopVoiceRecording() {
    const recorder = mediaRecorderRef.current

    if (!recorder || isStoppingVoiceRecordingRef.current) {
      return
    }

    isStoppingVoiceRecordingRef.current = true
    setIsStartingVoiceRecording(false)
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setRecordingTime(0)

    if (recorder.state === 'recording') {
      const duration = Date.now() - startTimeRef.current

      try {
        recorder.requestData()
      } catch (error) {
        console.error('Failed to request final voice recorder data', error)
      }

      if (duration < 300) {
        window.setTimeout(() => {
          const activeRecorder = mediaRecorderRef.current

          if (activeRecorder?.state === 'recording') {
            activeRecorder.stop()
            return
          }

          cleanupVoiceRecordingResources()
        }, 300 - duration)
        return
      }

      recorder.stop()
      return
    }

    cleanupVoiceRecordingResources()
  }

  const clearLongPressTimeout = useCallback(() => {
    if (longPressTimeoutRef.current !== null) {
      window.clearTimeout(longPressTimeoutRef.current)
      longPressTimeoutRef.current = null
    }
  }, [])

  const startLongPress = useCallback((message: ChatMessageItem) => {
    if (message.isOptimistic) {
      return
    }

    clearLongPressTimeout()
    longPressTimeoutRef.current = window.setTimeout(() => {
      navigator.vibrate?.(10)
      setSelectedMessage(message)
      setIsActionSheetOpen(true)
      longPressTimeoutRef.current = null
    }, LONG_PRESS_MS)
  }, [clearLongPressTimeout])

  const resetSwipeReplyGesture = useCallback(() => {
    swipeGestureMessageIdRef.current = null
    swipeStartXRef.current = null
    swipeStartYRef.current = null
    swipeOffsetXRef.current = 0
    swipeLockedVerticalRef.current = false
    setSwipingMessageId(null)
    setSwipeOffsetX(0)
  }, [])

  const isMobileSwipeViewport = useCallback(() => {
    return typeof window !== 'undefined' && window.innerWidth < 768
  }, [])

  const handleMessageTouchStart = useCallback((message: ChatMessageItem, event: ReactTouchEvent<HTMLDivElement>) => {
    startLongPress(message)

    if (!isMobileSwipeViewport()) {
      return
    }

    const touch = event.touches[0]

    if (!touch) {
      return
    }

    swipeGestureMessageIdRef.current = message.id
    swipeStartXRef.current = touch.clientX
    swipeStartYRef.current = touch.clientY
    swipeOffsetXRef.current = 0
    swipeLockedVerticalRef.current = false
    setSwipingMessageId(null)
    setSwipeOffsetX(0)
  }, [isMobileSwipeViewport, startLongPress])

  const handleMessageTouchMove = useCallback((message: ChatMessageItem, event: ReactTouchEvent<HTMLDivElement>) => {
    if (!isMobileSwipeViewport()) {
      clearLongPressTimeout()
      return
    }

    if (swipeGestureMessageIdRef.current !== message.id) {
      return
    }

    const touch = event.touches[0]
    const startX = swipeStartXRef.current
    const startY = swipeStartYRef.current

    if (!touch || startX === null || startY === null) {
      return
    }

    const deltaX = touch.clientX - startX
    const deltaY = touch.clientY - startY
    const absoluteDeltaX = Math.abs(deltaX)
    const absoluteDeltaY = Math.abs(deltaY)

    if (absoluteDeltaX > 8 || absoluteDeltaY > 8) {
      clearLongPressTimeout()
    }

    if (swipeLockedVerticalRef.current) {
      setSwipingMessageId(null)
      setSwipeOffsetX(0)
      swipeOffsetXRef.current = 0
      return
    }

    if (
      absoluteDeltaY > SWIPE_REPLY_VERTICAL_LOCK_PX &&
      absoluteDeltaX <= absoluteDeltaY * SWIPE_REPLY_HORIZONTAL_DOMINANCE_RATIO
    ) {
      swipeLockedVerticalRef.current = true
      setSwipingMessageId(null)
      setSwipeOffsetX(0)
      swipeOffsetXRef.current = 0
      return
    }

    if (deltaX <= 0) {
      setSwipingMessageId(null)
      setSwipeOffsetX(0)
      swipeOffsetXRef.current = 0
      return
    }

    if (absoluteDeltaX <= absoluteDeltaY * SWIPE_REPLY_HORIZONTAL_DOMINANCE_RATIO) {
      setSwipingMessageId(null)
      setSwipeOffsetX(0)
      swipeOffsetXRef.current = 0
      return
    }

    const nextSwipeOffsetX = Math.min(deltaX, SWIPE_REPLY_MAX_OFFSET_PX)
    setSwipingMessageId(message.id)
    setSwipeOffsetX(nextSwipeOffsetX)
    swipeOffsetXRef.current = nextSwipeOffsetX
  }, [clearLongPressTimeout, isMobileSwipeViewport])

  const handleMessageTouchEnd = useCallback((message: ChatMessageItem) => {
    const shouldReply =
      isMobileSwipeViewport() &&
      swipeGestureMessageIdRef.current === message.id &&
      swipeOffsetXRef.current >= SWIPE_REPLY_TRIGGER_PX

    clearLongPressTimeout()
    resetSwipeReplyGesture()

    if (shouldReply) {
      setReplyingToMessage(message)
    }
  }, [clearLongPressTimeout, isMobileSwipeViewport, resetSwipeReplyGesture])

  const handleMessageTouchCancel = useCallback(() => {
    clearLongPressTimeout()
    resetSwipeReplyGesture()
  }, [clearLongPressTimeout, resetSwipeReplyGesture])

  const handleMessageContextMenu = useCallback((message: ChatMessageItem, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()

    if (message.isOptimistic) {
      return
    }

    clearLongPressTimeout()
    setSelectedMessage(message)
    setIsActionSheetOpen(true)
  }, [clearLongPressTimeout])

  const handleReactionDetailsOpen = useCallback((
    targetMessage: ChatMessageItem,
    reaction: ChatMessageItem['reactions'][number]
  ) => {
    if (reaction.count > 1) {
      setSelectedReactionDetails({
        messageId: targetMessage.id,
        emoji: reaction.emoji,
      })
    }
  }, [])

  const getChatSendErrorGuardState = useCallback((optimisticMessageId: string | null | undefined): ChatSendErrorGuardState => {
    if (!optimisticMessageId) {
      return {
        hasRequestSuccess: false,
        hasResponseOk: false,
        hasReconciliationSuccess: false,
      }
    }

    return chatSendErrorGuardStateRef.current[optimisticMessageId] ?? {
      hasRequestSuccess: false,
      hasResponseOk: false,
      hasReconciliationSuccess: false,
    }
  }, [])

  const updateChatSendErrorGuardState = useCallback((
    optimisticMessageId: string | null | undefined,
    nextState: Partial<ChatSendErrorGuardState>
  ) => {
    if (!optimisticMessageId) {
      return
    }

    const currentState = getChatSendErrorGuardState(optimisticMessageId)
    chatSendErrorGuardStateRef.current[optimisticMessageId] = {
      ...currentState,
      ...nextState,
    }
  }, [getChatSendErrorGuardState])

  const handleCopyChatSendDebug = useCallback(async () => {
    const exportPayload = filteredChatSendDebugEvents.map((event) => ({
      timestamp: event.timestamp,
      phase: event.phase,
      level: event.level,
      summary: summarizeChatSendDebugPayload(event.payload),
      payload: event.payload,
    }))

    const formattedText = exportPayload.map((event) => (
      `[${event.timestamp}] ${event.phase} (${event.level})\nsummary: ${event.summary}\npayload: ${JSON.stringify(event.payload)}`
    )).join('\n\n')

    try {
      await navigator.clipboard.writeText(formattedText)
      setChatSendDebugCopyStatus('Скопировано. Вставьте этот текст в чат с разработчиком.')
    } catch (error) {
      setChatSendDebugCopyStatus(
        `Не удалось скопировать автоматически: ${error instanceof Error ? error.message : 'clipboard_unavailable'}`
      )
    }

    if (chatSendDebugCopyTimeoutRef.current !== null) {
      window.clearTimeout(chatSendDebugCopyTimeoutRef.current)
    }

    chatSendDebugCopyTimeoutRef.current = window.setTimeout(() => {
      setChatSendDebugCopyStatus('')
      chatSendDebugCopyTimeoutRef.current = null
    }, 3000)
  }, [filteredChatSendDebugEvents])

  function renderComposer() {
    return (
      <div>
        <section className="rounded-[26px] border border-black/[0.06] bg-[color:var(--background)]/90 px-3 py-2 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-[color:var(--background)]/86">
          <form onSubmit={handleSubmit}>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageInputChange}
              className="sr-only"
              tabIndex={-1}
            />
            {editingMessage ? (
              <div className="mb-2 flex items-start justify-between gap-3 rounded-[18px] border border-black/[0.05] bg-black/[0.03] px-3 py-2 dark:border-white/[0.08] dark:bg-white/[0.04]">
                <div className="min-w-0 flex-1">
                  <p className="app-text-primary truncate text-sm font-medium">Редактирование сообщения</p>
                  <p className="app-text-secondary mt-0.5 truncate text-sm">
                    {editingMessage.previewText || 'Измените текст сообщения'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={clearEditingMessage}
                  className="app-text-secondary mt-0.5 shrink-0 rounded-full p-1"
                  aria-label="Отменить редактирование"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
            {replyingToMessage ? (
              <div className="mb-2 flex items-start justify-between gap-3 rounded-[18px] border border-black/[0.05] bg-black/[0.03] px-3 py-2 dark:border-white/[0.08] dark:bg-white/[0.04]">
                <div className="min-w-0 flex-1">
                  <p className="app-text-primary truncate text-sm font-medium">{replyingToMessage.displayName}</p>
                  <p className="app-text-secondary mt-0.5 truncate text-sm">{replyingToMessage.previewText || 'Сообщение'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyingToMessage(null)}
                  className="app-text-secondary mt-0.5 shrink-0 rounded-full p-1"
                  aria-label="Отменить ответ"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
            {hasPendingImage ? (
              <div className="mb-2 flex items-start justify-between gap-3 rounded-[18px] border border-black/[0.05] bg-black/[0.03] px-3 py-2 dark:border-white/[0.08] dark:bg-white/[0.04]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="app-text-primary text-sm font-medium">
                      {pendingImages.length > 1 ? 'Фото готовы' : 'Фото готово'}
                    </p>
                    <p className="app-text-secondary text-xs">
                      {pendingImages.length}/{CHAT_MESSAGE_MAX_ATTACHMENTS}
                    </p>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {pendingImages.map((image, index) => (
                      <div
                        key={image.id}
                        className="relative aspect-square overflow-hidden rounded-2xl bg-black/[0.04] dark:bg-white/[0.06]"
                      >
                        <img
                          src={image.previewUrl}
                          alt={`Предпросмотр ${index + 1}`}
                          className="h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemovePendingImage(image.id)}
                          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm"
                          aria-label={`Убрать фото ${index + 1}`}
                        >
                          <CloseIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
            {isRecordingVoice || isStartingVoiceRecording || isSendingVoice ? (
              <div className={`flex min-h-11 items-center justify-between gap-3 rounded-[22px] px-3.5 py-2 text-sm ${
                isSendingVoice
                  ? 'bg-black/[0.04] text-black/70 dark:bg-white/[0.08] dark:text-white/75'
                  : 'bg-red-500/10 text-red-600 dark:bg-red-500/15'
              }`}>
                {isSendingVoice ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-black/35 dark:bg-white/45" />
                      <p className="font-medium">Отправка аудио...</p>
                    </div>
                    <span className="text-xs opacity-80">Пожалуйста, подождите</span>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={cancelVoiceRecording}
                      disabled={isStartingVoiceRecording}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-600 disabled:opacity-50 dark:bg-red-500/20 dark:text-red-300"
                      aria-label="Отменить голосовую запись"
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                    <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse dark:bg-red-400" />
                      <p className="truncate font-medium tabular-nums">
                        {formatRecordingTime(recordingTime)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={sendVoiceRecording}
                      disabled={isStartingVoiceRecording}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 disabled:opacity-50 dark:bg-emerald-500/20 dark:text-emerald-300"
                      aria-label="Отправить голосовую запись"
                    >
                      <CheckIcon className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={
                    submitting ||
                    uploadingImage ||
                    uploadingVoice ||
                    Boolean(editingMessageId) ||
                    pendingImages.length >= CHAT_MESSAGE_MAX_ATTACHMENTS
                  }
                  className="app-button-secondary flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-base font-medium shadow-none"
                  aria-label="Выбрать фото"
                >
                  {uploadingImage ? '...' : '+'}
                </button>
                <div className="flex min-w-0 flex-1 items-end rounded-[18px] bg-black/[0.035] px-3 dark:bg-white/[0.05]">
                  <label htmlFor="chat-message" className="sr-only">
                    Сообщение
                  </label>
                  <textarea
                    ref={composerTextareaRef}
                    id="chat-message"
                    value={draftMessage}
                    onChange={(event) => {
                      setDraftMessage(event.target.value)
                      setSubmitError('')
                    }}
                    onFocus={() => setIsComposerFocused(true)}
                    onBlur={() => setIsComposerFocused(false)}
                    placeholder={editingMessage ? 'Измените сообщение' : hasPendingImage ? 'Добавьте подпись к фото' : 'Сообщение'}
                    disabled={submitting || uploadingImage || uploadingVoice}
                    maxLength={CHAT_MESSAGE_MAX_LENGTH}
                    rows={1}
                    className="min-h-11 max-h-[120px] w-full resize-none overflow-hidden bg-transparent py-2.5 text-sm leading-5 outline-none placeholder:app-text-secondary"
                  />
                </div>
                {shouldShowVoiceRecorderButton ? (
                  <button
                    type="button"
                    onClick={() => {
                      void startVoiceRecording()
                    }}
                    disabled={submitting || uploadingImage || uploadingVoice || isStartingVoiceRecording}
                    className="app-button-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full px-0 text-sm font-medium shadow-none disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label="Начать запись голосового сообщения"
                  >
                    {isStartingVoiceRecording ? '...' : <MicIcon />}
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={submitting || uploadingImage || uploadingVoice || !canSubmitMessage || isMessageTooLong}
                    className="app-button-primary flex h-10 min-w-10 shrink-0 items-center justify-center rounded-full px-3.5 text-sm font-medium shadow-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? '...' : editingMessage ? 'OK' : '>'}
                  </button>
                )}
              </div>
            )}
            <div className="mt-1.5 flex items-center justify-between gap-3 px-1">
              <p className="app-text-secondary text-xs">
                {trimmedDraftMessage.length}/{CHAT_MESSAGE_MAX_LENGTH}
                {hasPendingImage ? ` • ${pendingImages.length}/${CHAT_MESSAGE_MAX_ATTACHMENTS} фото` : ''}
                {isRecordingVoice || isStartingVoiceRecording ? ' + запись' : uploadingVoice ? ' + аудио' : ''}
              </p>
              {submitError ? <p className="text-xs text-red-600">{submitError}</p> : <span />}
            </div>
          </form>
        </section>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-3 pb-4 pt-4 md:px-5 md:pb-5 md:pt-4">
        {showTitle ? (
          <div className="mb-4 space-y-1">
            <h1 className="app-text-primary text-2xl font-bold">{pageTitle}</h1>
            <p className="app-text-secondary text-sm">{pageDescription}</p>
          </div>
        ) : null}
        <div className="px-0 py-1">
          <div className="space-y-4">
            {[0, 1, 2].map((item) => (
              <div key={item} className="flex items-start gap-3">
                <div className="h-10 w-10 shrink-0 rounded-full skeleton-line" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex gap-2">
                    <div className="skeleton-line h-4 w-24" />
                    <div className="skeleton-line h-4 w-28" />
                  </div>
                  <div className="skeleton-line h-4 w-full" />
                  <div className="skeleton-line h-4 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!currentUserId) {
    return (
      <div className="mx-auto flex min-h-[240px] max-w-3xl items-center justify-center px-3 py-4 md:px-5">
        <Link href="/login" className="text-sm underline">
          Открыть вход
        </Link>
      </div>
    )
  }

  return (
    <div
      className={`mx-auto flex h-full min-h-0 max-w-3xl flex-col overflow-hidden px-3 md:px-5 md:py-4 ${
        showTitle ? 'pt-4' : 'pt-2'
      }`}
    >
      {showTitle ? (
        <div className="mb-4 space-y-1">
          <h1 className="app-text-primary text-2xl font-bold">{pageTitle}</h1>
          <p className="app-text-secondary text-sm">{pageDescription}</p>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <>
          <div
            className={`pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 transition-opacity duration-150 ${
              isLoadingOlderMessages ? 'opacity-100' : 'opacity-0'
            }`}
            aria-hidden={!isLoadingOlderMessages}
          >
            <div className="rounded-full border border-black/[0.05] bg-[color:var(--background)]/92 px-2.5 py-1 text-[11px] font-medium text-black/55 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-[color:var(--background)]/84 dark:text-white/60">
              Загрузка...
            </div>
          </div>
          {showScrollToBottomButton ? (
            <div className="pointer-events-none absolute bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-3 z-20 md:bottom-20 md:right-4">
              <button
                type="button"
                onClick={() => {
                  setPendingNewMessagesCount(0)
                  scrollPageToBottom('smooth', 'scroll-to-bottom-button')
                }}
                className="pointer-events-auto relative flex h-9 w-9 items-center justify-center rounded-full border border-black/[0.04] bg-[color:var(--background)]/90 text-black shadow-sm backdrop-blur-md transition-transform duration-200 hover:scale-[1.03] active:scale-95 dark:border-white/10 dark:bg-[color:var(--background)]/84 dark:text-white"
                aria-label={pendingNewMessagesCount > 0 ? getNewMessagesLabel(pendingNewMessagesCount) : 'Прокрутить вниз'}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 5v14" />
                  <path d="m19 12-7 7-7-7" />
                </svg>
                {pendingNewMessagesCount > 0 ? (
                  <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 py-0.5 text-[10px] font-semibold leading-none text-white shadow-sm">
                    {pendingNewMessagesCount > 9 ? '9+' : pendingNewMessagesCount}
                  </span>
                ) : null}
              </button>
            </div>
          ) : null}
          {CHAT_SEND_DEBUG ? (
            <ChatSendDebugPanel
              events={visibleChatSendDebugEvents}
              expanded={isChatSendDebugPanelExpanded}
              copyStatus={chatSendDebugCopyStatus}
              debugEnabled={CHAT_SEND_DEBUG}
              mounted
              threadId={threadId}
              onToggle={() => {
                setIsChatSendDebugPanelExpanded((currentValue) => !currentValue)
              }}
              onCopy={() => {
                void handleCopyChatSendDebug()
              }}
            />
          ) : null}
          <div
            ref={scrollContainerRef}
            data-chat-scroll-container="true"
            className="flex min-h-0 flex-1 flex-col overflow-y-auto [WebkitOverflowScrolling:touch]"
          >
            <div ref={scrollContentRef} className="flex min-h-full flex-col">
              {error ? (
                <section className="flex flex-1 p-1">
                  <p className="text-sm text-red-600">{error}</p>
                </section>
              ) : messages.length === 0 ? (
                <section className="flex flex-1 flex-col px-1 py-4">
                  <p className="app-text-secondary text-sm">Пока нет сообщений.</p>
                  <p className="app-text-secondary mt-2 text-sm">
                    Когда в базе появятся сообщения, они отобразятся здесь.
                  </p>
                </section>
              ) : (
                <ChatMessageList
                  messages={messages}
                  currentUserId={currentUserId}
                  swipingMessageId={swipingMessageId}
                  swipeOffsetX={swipeOffsetX}
                  animatedReactionKey={animatedReactionKey}
                  messageRefs={messageRefs}
                  onReplyPreviewClick={handleReplyPreviewClick}
                  onImageClick={(attachments, index) => {
                    setSelectedViewerState({
                      attachments,
                      initialIndex: index,
                    })
                  }}
                  onImageLoad={handleMessageImageLoad}
                  onRetryFailedMessage={handleRetryFailedMessage}
                  onReactionToggle={handleToggleReaction}
                  onReactionDetailsOpen={handleReactionDetailsOpen}
                  onMessageTouchStart={handleMessageTouchStart}
                  onMessageTouchEnd={handleMessageTouchEnd}
                  onMessageTouchCancel={handleMessageTouchCancel}
                  onMessageTouchMove={handleMessageTouchMove}
                  onMessageMouseDown={startLongPress}
                  onMessageMouseUp={clearLongPressTimeout}
                  onMessageMouseLeave={clearLongPressTimeout}
                  onMessageContextMenu={handleMessageContextMenu}
                />
              )}
            </div>
          </div>
          <div
            ref={composerWrapperRef}
            className={`shrink-0 pt-3 ${
              isKeyboardOpen ? 'pb-0' : 'pb-[max(0.75rem,env(safe-area-inset-bottom))]'
            }`}
          >
            {renderComposer()}
          </div>
        </>
      </div>
      {selectedViewerState ? (
        <FullscreenImageViewer
          images={selectedViewerState.attachments}
          initialIndex={selectedViewerState.initialIndex}
          onClose={() => setSelectedViewerState(null)}
        />
      ) : null}
      {selectedReactionMessage && selectedReaction ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/20 p-3 sm:items-center">
          <button
            type="button"
            aria-label="Закрыть список реакций"
            className="absolute inset-0"
            onClick={() => setSelectedReactionDetails(null)}
          />
          <div className="app-card relative w-full max-w-[320px] overflow-hidden rounded-[20px] border border-black/[0.05] shadow-lg dark:border-white/10">
            <div className="flex items-center justify-between border-b border-black/[0.05] px-3 py-2 dark:border-white/10">
              <div className="flex items-center gap-2">
                <span className="text-lg leading-none">{selectedReaction.emoji}</span>
                <div>
                  <p className="app-text-primary text-sm font-semibold">Реакции</p>
                  <p className="app-text-secondary text-[11px]">{selectedReactionMessage.displayName}</p>
                </div>
              </div>
              <button
                type="button"
                className="app-text-secondary rounded-full px-2 py-1 text-xs"
                onClick={() => setSelectedReactionDetails(null)}
              >
                Закрыть
              </button>
            </div>
            <div className="max-h-[min(50svh,320px)] overflow-y-auto p-2">
              {selectedReaction.reactors.map((reactor) => (
                <div
                  key={`${selectedReactionMessage.id}:${selectedReaction.emoji}:${reactor.userId}`}
                  className="flex items-center gap-2 rounded-xl px-2 py-2"
                >
                  <TinyUserAvatar
                    avatarUrl={reactor.avatarUrl}
                    displayName={reactor.displayName}
                    className="h-7 w-7"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="app-text-primary truncate text-sm font-medium">{reactor.displayName}</p>
                  </div>
                  <span className="text-base leading-none">{selectedReaction.emoji}</span>
                </div>
              ))}
            </div>
            {currentUserId ? (
              <div className="border-t border-black/[0.05] p-2 dark:border-white/10">
                <button
                  type="button"
                  className="app-text-primary w-full rounded-xl px-3 py-2 text-sm font-medium"
                  onClick={() => {
                    void handleToggleReaction(selectedReactionMessage.id, selectedReaction.emoji)
                    setSelectedReactionDetails(null)
                  }}
                >
                  {isCurrentUserSelectedInReaction ? 'Убрать мою реакцию' : 'Поставить эту реакцию'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {selectedMessage ? (
        <ChatMessageActions
          message={selectedMessage}
          anchorRect={selectedMessageAnchorRect}
          currentUserId={currentUserId}
          open={isActionSheetOpen}
          onOpenChange={handleActionSheetOpenChange}
          onDelete={handleDeleteMessage}
          onEdit={handleEditMessage}
          onReply={handleReplyToMessage}
          onToggleReaction={handleToggleReaction}
        />
      ) : null}
      <ConfirmActionSheet
        open={Boolean(deleteConfirmationMessage)}
        title="Удалить сообщение?"
        description="Сообщение исчезнет из чата. Это действие нельзя отменить."
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        loading={Boolean(deleteConfirmationMessage && deletingMessageId === deleteConfirmationMessage.id)}
        destructive
        onConfirm={() => {
          void confirmDeleteMessage()
        }}
        onCancel={() => {
          if (!deletingMessageId) {
            setDeleteConfirmationMessage(null)
          }
        }}
      />
    </div>
  )
}
