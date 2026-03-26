'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react'
import { useRouter } from 'next/navigation'
import ChatMessageActions from '@/components/chat/ChatMessageActions'
import { getBootstrapUser } from '@/lib/auth'
import {
  CHAT_MESSAGE_MAX_LENGTH,
  createChatMessage,
  createVoiceChatMessage,
  loadChatMessageById,
  loadChatReadState,
  loadChatMessageItem,
  loadOlderChatMessages,
  loadRecentChatMessages,
  softDeleteChatMessage,
  toggleChatMessageReaction,
  type ChatMessageItem,
  updateChatMessage,
  uploadChatImage,
  upsertChatReadState,
} from '@/lib/chat'
import { ensureProfileExists } from '@/lib/profiles'
import { uploadVoiceMessage } from '@/lib/storage/uploadVoiceMessage'
import { supabase } from '@/lib/supabase'

type ChatSectionProps = {
  showTitle?: boolean
  threadId?: string | null
  title?: string
  description?: string
  enableReadState?: boolean
}

const LONG_PRESS_MS = 450
const INITIAL_CHAT_MESSAGE_LIMIT = 10
const OLDER_CHAT_BATCH_LIMIT = 10
const MAX_RENDERED_CHAT_MESSAGES = 60
const CHAT_APP_HEIGHT_CSS_VAR = '--chat-app-height'
const CHAT_COMPOSER_TEXTAREA_MAX_HEIGHT = 120
const SWIPE_REPLY_TRIGGER_PX = 80
const SWIPE_REPLY_MAX_OFFSET_PX = 96
const SWIPE_REPLY_VERTICAL_LOCK_PX = 12
const SWIPE_REPLY_HORIZONTAL_DOMINANCE_RATIO = 1.5
const REACTION_ANIMATION_DURATION_MS = 200
const CHAT_VOICE_BUCKET = 'chat-voice'
const CHAT_VOICE_SIGNED_URL_TTL_SECONDS = 60 * 60
const REPLY_TARGET_HIGHLIGHT_CLASSES = [
  'bg-yellow-100',
  'dark:bg-yellow-500/20',
  'ring-2',
  'ring-yellow-300',
  'dark:ring-yellow-400/40',
]

function AvatarFallback() {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700">
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

function toggleReactionOnMessage(
  message: ChatMessageItem,
  userId: string,
  emoji: string,
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
  }))

  if (nextIsActive) {
    if (existingReaction) {
      nextReactions = nextReactions.map((reaction) =>
        reaction.emoji === emoji
          ? {
              ...reaction,
              count: reaction.count + 1,
              userIds: reaction.userIds.includes(userId) ? reaction.userIds : [...reaction.userIds, userId],
            }
          : reaction
      )
    } else {
      nextReactions = [...nextReactions, { emoji, count: 1, userIds: [userId] }]
    }
  } else {
    nextReactions = nextReactions
      .map((reaction) =>
        reaction.emoji === emoji
          ? {
              ...reaction,
              count: Math.max(0, reaction.count - 1),
              userIds: reaction.userIds.filter((currentUserId) => currentUserId !== userId),
            }
          : reaction
      )
      .filter((reaction) => reaction.count > 0)
  }

  const emojiOrder = ['👍', '❤️', '🔥', '😂']
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
  shouldActivate?: boolean
) {
  return messages.map((message) =>
    message.id === messageId ? toggleReactionOnMessage(message, userId, emoji, shouldActivate) : message
  )
}

function ReactionChip({
  reactionKey,
  emoji,
  count,
  isSelected,
  disabled,
  shouldBurst,
  onClick,
}: {
  reactionKey: string
  emoji: string
  count: number
  isSelected: boolean
  disabled: boolean
  shouldBurst: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const [burstPhase, setBurstPhase] = useState<'idle' | 'start' | 'end'>('idle')

  useEffect(() => {
    if (!shouldBurst) {
      return
    }

    let animationFrameId: number | null = null
    const timeoutId = window.setTimeout(() => {
      setBurstPhase('idle')
    }, REACTION_ANIMATION_DURATION_MS + 30)

    setBurstPhase('start')
    animationFrameId = window.requestAnimationFrame(() => {
      setBurstPhase('end')
    })

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }

      window.clearTimeout(timeoutId)
    }
  }, [reactionKey, shouldBurst])

  const isBursting = burstPhase !== 'idle'

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      disabled={disabled}
      className={`relative inline-flex items-center gap-1 overflow-visible rounded-full px-2.5 py-1 text-xs font-medium transition-transform duration-200 ease-out ${
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
        className={`pointer-events-none absolute left-1/2 top-1/2 z-[1] -translate-x-1/2 text-sm transition-all duration-200 ease-out ${
          burstPhase === 'start'
            ? '-translate-y-1 scale-95 opacity-90'
            : burstPhase === 'end'
              ? '-translate-y-5 scale-125 opacity-0'
              : 'translate-y-0 scale-75 opacity-0'
        }`}
      >
        {emoji}
      </span>
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

function VoiceMessageAudio({ storagePath }: { storagePath: string }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)

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

  if (loadError) {
    return <p className="mt-1 text-sm text-red-600">Не удалось загрузить голосовое сообщение</p>
  }

  if (!signedUrl) {
    return <p className="mt-1 text-sm app-text-secondary">Загрузка аудио...</p>
  }

  return <audio controls src={signedUrl} className="mt-1 w-full" />
}

function ChatMessageBody({
  message,
  isOwnMessage = false,
  showSenderName = true,
  onReplyPreviewClick,
  onImageClick,
  currentUserId = null,
  onReactionToggle,
  animatedReactionKey = null,
}: {
  message: ChatMessageItem
  isOwnMessage?: boolean
  showSenderName?: boolean
  onReplyPreviewClick?: () => void
  onImageClick?: (imageUrl: string) => void
  currentUserId?: string | null
  onReactionToggle?: (messageId: string, emoji: string) => void
  animatedReactionKey?: string | null
}) {
  const isFallbackReplyPreview = Boolean(
    message.replyTo && message.replyTo.userId === null && message.replyTo.text === ''
  )
  const hasVoiceAttachment = message.messageType === 'voice'
  const voiceMessageLabel = formatVoiceMessageLabel(message.mediaDurationSeconds)

  return (
    <>
      {showSenderName ? (
        <p
          className={`truncate text-[11px] font-medium ${
            isOwnMessage ? 'app-text-secondary text-right' : 'app-text-primary'
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
          className={`mt-1 rounded-[14px] px-2.5 py-1.5 ${
            isOwnMessage
              ? 'bg-black/[0.04] dark:bg-white/[0.07]'
              : 'bg-black/[0.03] dark:bg-white/[0.05]'
          } ${onReplyPreviewClick ? 'block w-full cursor-pointer text-left' : 'block w-full cursor-default text-left'} ${
            isFallbackReplyPreview ? 'opacity-75' : ''
          }`}
        >
          <p className={`${isFallbackReplyPreview ? 'app-text-secondary' : 'app-text-primary'} truncate text-xs font-medium`}>
            {message.replyTo.displayName}
          </p>
          {message.replyTo.text ? (
            <p className="app-text-secondary truncate text-xs">{message.replyTo.text}</p>
          ) : null}
        </button>
      ) : null}
      {message.imageUrl ? (
        <button
          type="button"
          onClick={() => onImageClick?.(message.imageUrl!)}
          className={`mt-1 block max-w-[70%] overflow-hidden rounded-2xl ${
            isOwnMessage ? 'ml-auto' : ''
          }`}
          aria-label="Открыть изображение"
        >
          <img
            src={message.imageUrl}
            alt="Вложение"
            className="max-h-80 w-auto rounded-2xl object-cover"
          />
        </button>
      ) : null}
      {hasVoiceAttachment ? (
        <>
          <div
            className={`mt-1 inline-flex max-w-full rounded-2xl px-3 py-2 text-sm ${
              isOwnMessage
                ? 'ml-auto bg-black/[0.05] text-black/80 dark:bg-white/[0.09] dark:text-white/80'
                : 'bg-black/[0.04] text-black/75 dark:bg-white/[0.07] dark:text-white/75'
            }`}
          >
            {voiceMessageLabel}
          </div>
          {message.mediaUrl ? <VoiceMessageAudio storagePath={message.mediaUrl} /> : null}
        </>
      ) : null}
      {message.text ? (
        <p
          className={`app-text-primary break-words whitespace-pre-wrap text-sm leading-6 ${
            message.replyTo || message.imageUrl || hasVoiceAttachment ? 'mt-1' : showSenderName ? 'mt-0.5' : ''
          } ${
            isOwnMessage ? 'text-right' : ''
          }`}
        >
          {message.text}
        </p>
      ) : null}
      <p className={`app-text-secondary mt-1 text-xs ${isOwnMessage ? 'text-right' : ''}`}>
        {message.createdAtLabel}
        {message.editedAt ? ' • изменено' : ''}
      </p>
      {message.reactions.length > 0 ? (
        <div className={`mt-2 flex flex-wrap gap-1.5 ${isOwnMessage ? 'justify-end' : ''}`}>
          {message.reactions.map((reaction) => {
            const isSelected = currentUserId ? reaction.userIds.includes(currentUserId) : false
            const reactionKey = `${message.id}:${reaction.emoji}`

            return (
              <ReactionChip
                key={reactionKey}
                reactionKey={reactionKey}
                emoji={reaction.emoji}
                count={reaction.count}
                isSelected={isSelected}
                disabled={!onReactionToggle}
                shouldBurst={animatedReactionKey === reactionKey}
                onClick={(event) => {
                  event.stopPropagation()
                  onReactionToggle?.(message.id, reaction.emoji)
                }}
              />
            )
          })}
        </div>
      ) : null}
    </>
  )
}

export default function ChatSection({
  showTitle = true,
  threadId = null,
  title,
  description,
  enableReadState = true,
}: ChatSectionProps) {
  const router = useRouter()
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const messagesRef = useRef<ChatMessageItem[]>([])
  const pendingDeletedMessageIdsRef = useRef<Set<string>>(new Set())
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
  const isMarkingReadRef = useRef(false)
  const pendingAutoScrollToBottomRef = useRef(false)
  const prependScrollRestoreRef = useRef<{ scrollHeight: number; scrollTop: number | null } | null>(null)
  const isLoadingOlderMessagesRef = useRef(false)
  const focusedGestureStartScrollTopRef = useRef<number | null>(null)
  const focusedGestureStartClientYRef = useRef<number | null>(null)
  const focusedGestureBlurredRef = useRef(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordedVoiceChunksRef = useRef<Blob[]>([])
  const isStoppingVoiceRecordingRef = useRef(false)
  const shouldStopVoiceRecordingOnStartRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const [lastReadAt, setLastReadAt] = useState<string | null>(null)
  const [hasLoadedReadState, setHasLoadedReadState] = useState(false)
  const [pendingInitialScroll, setPendingInitialScroll] = useState(false)
  const [pendingNewMessagesCount, setPendingNewMessagesCount] = useState(0)
  const [hasMoreOlderMessages, setHasMoreOlderMessages] = useState(true)
  const [error, setError] = useState('')
  const [draftMessage, setDraftMessage] = useState('')
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadingVoice, setUploadingVoice] = useState(false)
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [isStartingVoiceRecording, setIsStartingVoiceRecording] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)
  const [selectedMessage, setSelectedMessage] = useState<ChatMessageItem | null>(null)
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false)
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessageItem | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [selectedViewerImageUrl, setSelectedViewerImageUrl] = useState<string | null>(null)
  const [animatedReactionKey, setAnimatedReactionKey] = useState<string | null>(null)
  const [swipingMessageId, setSwipingMessageId] = useState<string | null>(null)
  const [swipeOffsetX, setSwipeOffsetX] = useState(0)
  const [isComposerFocused, setIsComposerFocused] = useState(false)
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)
  const [showScrollToBottomButton, setShowScrollToBottomButton] = useState(false)
  const pageTitle = title ?? 'Чат клуба'
  const pageDescription = description ?? 'Последние 50 сообщений клуба в хронологическом порядке.'

  const trimmedDraftMessage = draftMessage.trim()
  const editingMessage = editingMessageId
    ? messages.find((message) => message.id === editingMessageId) ?? null
    : null
  const hasPendingImage = Boolean(pendingImageUrl)
  const isMessageTooLong = trimmedDraftMessage.length > CHAT_MESSAGE_MAX_LENGTH
  const canSubmitMessage = Boolean(trimmedDraftMessage || pendingImageUrl)
  const shouldShowVoiceRecorderButton = !editingMessage && !trimmedDraftMessage && !hasPendingImage
  const latestLoadedMessageCreatedAt = messages.length > 0 ? messages[messages.length - 1]?.createdAt ?? null : null
  const oldestLoadedMessageCreatedAt = messages.length > 0 ? messages[0]?.createdAt ?? null : null
  const oldestLoadedMessageId = messages.length > 0 ? messages[0]?.id ?? null : null
  const firstUnreadMessageId = (() => {
    if (!enableReadState) {
      return null
    }

    if (messages.length === 0) {
      return null
    }

    if (!lastReadAt) {
      return null
    }

    const lastReadAtMs = new Date(lastReadAt).getTime()
    return messages.find((message) => new Date(message.createdAt).getTime() > lastReadAtMs)?.id ?? null
  })()

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

  const refreshMessages = useCallback(async () => {
    try {
      const recentMessages = await loadRecentChatMessages(50, threadId)
      setMessages(keepLatestRenderedMessages(recentMessages))
      setError('')
      return recentMessages
    } catch {
      setError('Не удалось загрузить чат')
      return null
    }
  }, [keepLatestRenderedMessages, threadId])

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

  const isNearBottom = useCallback(() => {
    if (typeof window === 'undefined') {
      return false
    }

    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer) {
      return true
    }

    const distanceFromBottom =
      scrollContainer.scrollHeight - (scrollContainer.scrollTop + scrollContainer.clientHeight)

    return distanceFromBottom <= 100
  }, [])

  const scrollPageToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer) {
      return
    }

    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior,
    })
  }, [])

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
    return count === 1 ? '1 new message' : `${count} new messages`
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

  const markMessagesRead = useCallback(async (nextLastReadAt: string) => {
    if (!currentUserId || document.visibilityState !== 'visible') {
      return
    }

    const nextLastReadAtMs = new Date(nextLastReadAt).getTime()
    const currentLastReadAtMs = lastReadAt ? new Date(lastReadAt).getTime() : null

    if ((currentLastReadAtMs ?? 0) >= nextLastReadAtMs || isMarkingReadRef.current) {
      return
    }

    isMarkingReadRef.current = true

    try {
      const { error: upsertError } = await upsertChatReadState(currentUserId, nextLastReadAt)

      if (upsertError) {
        throw upsertError
      }

      setLastReadAt((currentLastReadValue) => {
        if (!currentLastReadValue || new Date(currentLastReadValue).getTime() < nextLastReadAtMs) {
          return nextLastReadAt
        }

        return currentLastReadValue
      })
    } catch {
      // Keep read tracking non-blocking for the chat experience.
    } finally {
      isMarkingReadRef.current = false
    }
  }, [currentUserId, lastReadAt])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    document.documentElement.dataset.chatIsolatedRoute = 'true'
    document.body.dataset.chatIsolatedRoute = 'true'

    return () => {
      delete document.documentElement.dataset.chatIsolatedRoute
      delete document.body.dataset.chatIsolatedRoute
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }

    const rootStyle = document.documentElement.style
    let frameId: number | null = null
    let nestedFrameId: number | null = null
    let timeoutId: number | null = null

    function applyChatAppHeight() {
      const visualViewport = window.visualViewport
      const viewportHeight = visualViewport?.height ?? window.innerHeight
      const viewportOffsetTop = visualViewport?.offsetTop ?? 0
      const isMobileViewport = window.innerWidth < 768
      const effectiveViewportHeight = Math.round(viewportHeight + viewportOffsetTop)

      rootStyle.setProperty(CHAT_APP_HEIGHT_CSS_VAR, `${effectiveViewportHeight}px`)
      setIsKeyboardOpen(isMobileViewport && window.innerHeight - effectiveViewportHeight > 120)
    }

    function clearScheduledViewportSync() {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
        frameId = null
      }

      if (nestedFrameId !== null) {
        window.cancelAnimationFrame(nestedFrameId)
        nestedFrameId = null
      }

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    function updateChatAppHeight() {
      applyChatAppHeight()
      clearScheduledViewportSync()

      frameId = window.requestAnimationFrame(() => {
        nestedFrameId = window.requestAnimationFrame(() => {
          applyChatAppHeight()
        })
      })

      timeoutId = window.setTimeout(() => {
        applyChatAppHeight()
      }, 80)
    }

    updateChatAppHeight()

    window.visualViewport?.addEventListener('resize', updateChatAppHeight)
    window.visualViewport?.addEventListener('scroll', updateChatAppHeight)
    window.addEventListener('resize', updateChatAppHeight)

    return () => {
      clearScheduledViewportSync()
      window.visualViewport?.removeEventListener('resize', updateChatAppHeight)
      window.visualViewport?.removeEventListener('scroll', updateChatAppHeight)
      window.removeEventListener('resize', updateChatAppHeight)
      rootStyle.removeProperty(CHAT_APP_HEIGHT_CSS_VAR)
    }
  }, [])

  useEffect(() => {
    pendingDeletedMessageIdsRef.current.clear()
    messagesRef.current = []
    setMessages([])
    setLastReadAt(null)
    setHasLoadedReadState(false)
    setPendingInitialScroll(false)
    setPendingNewMessagesCount(0)
    setHasMoreOlderMessages(true)
    setError('')
    setDraftMessage('')
    setSubmitError('')
    setReplyingToMessage(null)
    setEditingMessageId(null)
    setSelectedMessage(null)
    setIsActionSheetOpen(false)
  }, [threadId])

  useLayoutEffect(() => {
    resizeComposerTextarea()
  }, [draftMessage, resizeComposerTextarea])

  useEffect(() => {
    return () => {
      if (longPressTimeoutRef.current !== null) {
        window.clearTimeout(longPressTimeoutRef.current)
      }

      if (animatedReactionTimeoutRef.current !== null) {
        window.clearTimeout(animatedReactionTimeoutRef.current)
      }

      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop())
      mediaRecorderRef.current = null
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!isRecordingVoice && !isStartingVoiceRecording) {
      return
    }

    function handleRelease() {
      void stopVoiceRecording()
    }

    window.addEventListener('mouseup', handleRelease)
    window.addEventListener('touchend', handleRelease)
    window.addEventListener('touchcancel', handleRelease)

    return () => {
      window.removeEventListener('mouseup', handleRelease)
      window.removeEventListener('touchend', handleRelease)
      window.removeEventListener('touchcancel', handleRelease)
    }
  }, [isRecordingVoice, isStartingVoiceRecording])

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
      return
    }

    const nextSelectedMessage = messages.find((message) => message.id === selectedMessage.id) ?? null

    if (!nextSelectedMessage) {
      setSelectedMessage(null)
      setIsActionSheetOpen(false)
      return
    }

    if (nextSelectedMessage !== selectedMessage) {
      setSelectedMessage(nextSelectedMessage)
    }
  }, [messages, selectedMessage])

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
    if (!selectedViewerImageUrl) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelectedViewerImageUrl(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedViewerImageUrl])

  useEffect(() => {
    let isMounted = true

    async function loadPage() {
      try {
        const user = await getBootstrapUser()

        if (!isMounted) {
          return
        }

        if (!user) {
          setIsAuthenticated(false)
          setCurrentUserId(null)
          router.replace('/login')
          return
        }

        setIsAuthenticated(true)
        setCurrentUserId(user.id)
        void ensureProfileExists(user)

        if (!isMounted) {
          return
        }

        const initialMessages = await loadRecentChatMessages(INITIAL_CHAT_MESSAGE_LIMIT, threadId)
        let nextLastReadAt: string | null = null

        if (enableReadState) {
          try {
            nextLastReadAt = await loadChatReadState(user.id)
          } catch (readStateError) {
            console.error('Failed to load chat read state', readStateError)
            nextLastReadAt = null
          }
        }

        if (!isMounted) {
          return
        }

        setMessages(keepLatestRenderedMessages(initialMessages))
        setError('')
        setLastReadAt(nextLastReadAt)
        setHasLoadedReadState(true)
        setHasMoreOlderMessages(initialMessages.length === INITIAL_CHAT_MESSAGE_LIMIT)
        setPendingInitialScroll(true)
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
  }, [enableReadState, keepLatestRenderedMessages, router, threadId])

  useLayoutEffect(() => {
    if (loading || !hasLoadedReadState || !pendingInitialScroll) {
      return
    }

    if (messages.length === 0) {
      return
    }

    scrollPageToBottom()
    setPendingInitialScroll(false)
  }, [hasLoadedReadState, loading, messages.length, pendingInitialScroll, scrollPageToBottom])

  useEffect(() => {
    if (
      loading ||
      !isAuthenticated ||
      !enableReadState ||
      !hasLoadedReadState ||
      !currentUserId ||
      !latestLoadedMessageCreatedAt ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return
    }

    const bottomSentinel = bottomSentinelRef.current

    if (!bottomSentinel) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return
        }

        void markMessagesRead(latestLoadedMessageCreatedAt)
      },
      {
        root: scrollContainerRef.current,
        threshold: 0.1,
      }
    )

    observer.observe(bottomSentinel)

    return () => {
      observer.disconnect()
    }
  }, [
    currentUserId,
    enableReadState,
    hasLoadedReadState,
    isAuthenticated,
    latestLoadedMessageCreatedAt,
    loading,
    markMessagesRead,
  ])

  useEffect(() => {
    if (!pendingAutoScrollToBottomRef.current || messages.length === 0) {
      return
    }

    let nestedAnimationFrameId: number | null = null
    const animationFrameId = window.requestAnimationFrame(() => {
      nestedAnimationFrameId = window.requestAnimationFrame(() => {
        scrollPageToBottom()
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

  useEffect(() => {
    const pendingRestore = prependScrollRestoreRef.current

    if (!pendingRestore) {
      return
    }

    let nestedAnimationFrameId: number | null = null
    const animationFrameId = window.requestAnimationFrame(() => {
      nestedAnimationFrameId = window.requestAnimationFrame(() => {
        const scrollContainer = scrollContainerRef.current

        if (!scrollContainer || pendingRestore.scrollTop === null) {
          prependScrollRestoreRef.current = null
          return
        }

        const scrollHeightDelta = scrollContainer.scrollHeight - pendingRestore.scrollHeight
        scrollContainer.scrollTop = Math.max(0, pendingRestore.scrollTop + scrollHeightDelta)
        prependScrollRestoreRef.current = null
      })
    })

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      if (nestedAnimationFrameId !== null) {
        window.cancelAnimationFrame(nestedAnimationFrameId)
      }
    }
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
      !isAuthenticated ||
      !oldestLoadedMessageCreatedAt ||
      !oldestLoadedMessageId ||
      !hasMoreOlderMessages
    ) {
      return
    }

    async function loadOlderMessages() {
      const oldestCreatedAt = oldestLoadedMessageCreatedAt
      const oldestMessageId = oldestLoadedMessageId

      if (!oldestCreatedAt || !oldestMessageId) {
        prependScrollRestoreRef.current = null
        return
      }

      const scrollContainer = scrollContainerRef.current

      if (!scrollContainer || scrollContainer.scrollTop > 80 || isLoadingOlderMessagesRef.current) {
        return
      }

      isLoadingOlderMessagesRef.current = true
      prependScrollRestoreRef.current = {
        scrollHeight: scrollContainer.scrollHeight,
        scrollTop: scrollContainer.scrollTop,
      }

      try {
        const olderMessages = await loadOlderChatMessages(
          oldestCreatedAt,
          oldestMessageId,
          OLDER_CHAT_BATCH_LIMIT,
          threadId
        )

        if (olderMessages.length === 0) {
          prependScrollRestoreRef.current = null
          setHasMoreOlderMessages(false)
          return
        }

        setHasMoreOlderMessages(olderMessages.length === OLDER_CHAT_BATCH_LIMIT)
        setMessages((currentMessages) => prependMessages(currentMessages, olderMessages))
      } catch {
        prependScrollRestoreRef.current = null
      } finally {
        isLoadingOlderMessagesRef.current = false
      }
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
    isAuthenticated,
    loading,
    oldestLoadedMessageCreatedAt,
    oldestLoadedMessageId,
    prependMessages,
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
    if (loading || !isAuthenticated) {
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
          const nextMessageId = String((payload.new as { id?: string } | null)?.id ?? '')
          const shouldAutoScroll = isNearBottom()

          if (!nextMessageId) {
            return
          }

          if (messagesRef.current.some((message) => message.id === nextMessageId)) {
            return
          }

          if (pendingDeletedMessageIdsRef.current.has(nextMessageId)) {
            return
          }

          try {
            const nextMessage = await loadChatMessageItem(nextMessageId, threadId)

            if (!nextMessage) {
              return
            }

            if (shouldAutoScroll) {
              pendingAutoScrollToBottomRef.current = true
              setPendingNewMessagesCount(0)
            } else {
              setPendingNewMessagesCount((currentCount) => currentCount + 1)
            }

            setMessages((currentMessages) =>
              keepLatestRenderedMessages(insertMessageChronologically(currentMessages, nextMessage), {
                preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
              })
            )
          } catch {
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

          try {
            const nextMessage = await loadChatMessageItem(nextMessageId, threadId)

            if (!nextMessage) {
              pendingDeletedMessageIdsRef.current.delete(nextMessageId)
              setMessages((currentMessages) => removeMessageById(currentMessages, nextMessageId))
              return
            }

            if (pendingDeletedMessageIdsRef.current.has(nextMessageId)) {
              return
            }

            setMessages((currentMessages) =>
              keepLatestRenderedMessages(upsertMessageById(currentMessages, nextMessage), {
                preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
              })
            )
          } catch {
            // Keep realtime additive and non-blocking if enrichment fails.
          }
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [isNearBottom, keepLatestRenderedMessages, loading, isAuthenticated, refreshMessages, threadId])

  useEffect(() => {
    if (loading || !isAuthenticated) {
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
            updateMessageReaction(currentMessages, messageId, userId, emoji, true)
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
            updateMessageReaction(currentMessages, messageId, userId, emoji, false)
          )
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [isAuthenticated, loading, threadId])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!currentUserId || submitting) {
      return
    }

    if (!trimmedDraftMessage && !pendingImageUrl) {
      setSubmitError('Введите сообщение или выберите изображение')
      return
    }

    if (isMessageTooLong) {
      setSubmitError(`Сообщение должно быть не длиннее ${CHAT_MESSAGE_MAX_LENGTH} символов`)
      return
    }

    setSubmitting(true)
    setSubmitError('')

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
        const { error: insertError } = await createChatMessage(
          currentUserId,
          trimmedDraftMessage,
          replyingToMessage?.id ?? null,
          threadId,
          pendingImageUrl
        )

        if (insertError) {
          throw insertError
        }
      }

      setPendingNewMessagesCount(0)
      setDraftMessage('')
      clearSelectedImage()
      setReplyingToMessage(null)
      setEditingMessageId(null)
      window.requestAnimationFrame(() => {
        resizeComposerTextarea()
      })
    } catch {
      setSubmitError('Не удалось отправить сообщение')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteMessage(message: ChatMessageItem) {
    if (!currentUserId || deletingMessageId || message.userId !== currentUserId || message.isDeleted) {
      return
    }

    const shouldDelete = typeof window === 'undefined'
      ? true
      : window.confirm('Удалить это сообщение?')

    if (!shouldDelete) {
      return
    }

    setDeletingMessageId(message.id)
    pendingDeletedMessageIdsRef.current.add(message.id)
    setMessages((currentMessages) => removeMessageById(currentMessages, message.id))

    try {
      const { error: deleteError } = await softDeleteChatMessage(message.id, currentUserId, threadId)

      if (deleteError) {
        throw deleteError
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

  function handleActionSheetOpenChange(open: boolean) {
    setIsActionSheetOpen(open)

    if (!open) {
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

  async function handleToggleReaction(messageId: string, emoji: string) {
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
      updateMessageReaction(currentMessages, messageId, currentUserId, emoji, nextShouldActivate)
    )

    try {
      await toggleChatMessageReaction(messageId, currentUserId, emoji)
    } catch (error) {
      console.error('Failed to toggle chat reaction', error)
      if (nextAnimatedReactionKey) {
        setAnimatedReactionKey((currentKey) => (currentKey === nextAnimatedReactionKey ? null : currentKey))
      }
      setMessages((currentMessages) =>
        updateMessageReaction(currentMessages, messageId, currentUserId, emoji, hasReacted)
      )
    }
  }

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
    clearSelectedImage()
    setDraftMessage(message.text)
    setSubmitError('')
    setSelectedMessage(null)
    setIsActionSheetOpen(false)
    window.requestAnimationFrame(() => {
      resizeComposerTextarea()
      composerTextareaRef.current?.focus()
    })
  }

  function clearSelectedImage() {
    setPendingImageUrl(null)

    if (imageInputRef.current) {
      imageInputRef.current.value = ''
    }
  }

  async function handleImageInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0]

    if (!nextFile) {
      return
    }

    if (!currentUserId) {
      clearSelectedImage()
      setSubmitError('Нужно войти, чтобы отправлять изображения')
      return
    }

    if (!nextFile.type.startsWith('image/')) {
      clearSelectedImage()
      setSubmitError('Можно выбрать только изображение')
      return
    }

    setUploadingImage(true)
    setSubmitError('')

    try {
      const publicUrl = await uploadChatImage(currentUserId, nextFile, threadId)
      setPendingImageUrl(publicUrl)
    } catch (error) {
      console.error('Failed to upload image in chat composer', error)
      clearSelectedImage()
      setSubmitError('Не удалось загрузить изображение')
    } finally {
      setUploadingImage(false)
    }
  }

  function cleanupVoiceRecordingResources() {
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop())
    mediaRecorderRef.current = null

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    recordedVoiceChunksRef.current = []
    isStoppingVoiceRecordingRef.current = false
    shouldStopVoiceRecordingOnStartRef.current = false
    setIsRecordingVoice(false)
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

  async function sendRecordedVoiceMessage(file: File) {
    if (!currentUserId) {
      return
    }

    setUploadingVoice(true)
    setSubmitError('')

    try {
      const uploadResult = await uploadVoiceMessage({
        file,
        userId: currentUserId,
      })
      const { error: insertError } = await createVoiceChatMessage(
        currentUserId,
        uploadResult.path,
        replyingToMessage?.id ?? null,
        threadId
      )

      if (insertError) {
        throw insertError
      }

      setPendingNewMessagesCount(0)
      setReplyingToMessage(null)
    } catch (error) {
      console.error('Failed to send voice message', error)
      setSubmitError('Не удалось отправить голосовое сообщение')
    } finally {
      setUploadingVoice(false)
    }
  }

  async function startVoiceRecording() {
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
    setSubmitError('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })
      const recorderMimeType = getVoiceRecorderMimeType()
      const recorder = recorderMimeType
        ? new MediaRecorder(stream, { mimeType: recorderMimeType })
        : new MediaRecorder(stream)

      recordedVoiceChunksRef.current = []
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      isStoppingVoiceRecordingRef.current = false

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          recordedVoiceChunksRef.current.push(event.data)
        }
      })

      recorder.addEventListener('stop', () => {
        const voiceBlob = new Blob(recordedVoiceChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        })

        cleanupVoiceRecordingResources()

        if (voiceBlob.size < 1024) {
          return
        }

        const voiceFile = new File([voiceBlob], `voice-message-${Date.now()}.webm`, {
          type: voiceBlob.type || 'audio/webm',
        })

        void sendRecordedVoiceMessage(voiceFile)
      })

      recorder.start()
      setIsStartingVoiceRecording(false)
      setIsRecordingVoice(true)

      if (shouldStopVoiceRecordingOnStartRef.current) {
        shouldStopVoiceRecordingOnStartRef.current = false
        void stopVoiceRecording()
      }
    } catch (error) {
      console.error('Failed to start voice recording', error)
      cleanupVoiceRecordingResources()
      setSubmitError('Не удалось начать запись голоса')
    }
  }

  async function stopVoiceRecording() {
    const recorder = mediaRecorderRef.current

    if (!recorder && isStartingVoiceRecording) {
      shouldStopVoiceRecordingOnStartRef.current = true
      return
    }

    if (!recorder || isStoppingVoiceRecordingRef.current) {
      return
    }

    isStoppingVoiceRecordingRef.current = true
    setIsStartingVoiceRecording(false)

    if (recorder.state !== 'inactive') {
      recorder.stop()
      return
    }

    cleanupVoiceRecordingResources()
  }

  function clearLongPressTimeout() {
    if (longPressTimeoutRef.current !== null) {
      window.clearTimeout(longPressTimeoutRef.current)
      longPressTimeoutRef.current = null
    }
  }

  const resetSwipeReplyGesture = useCallback(() => {
    swipeGestureMessageIdRef.current = null
    swipeStartXRef.current = null
    swipeStartYRef.current = null
    swipeOffsetXRef.current = 0
    swipeLockedVerticalRef.current = false
    setSwipingMessageId(null)
    setSwipeOffsetX(0)
  }, [])

  function isMobileSwipeViewport() {
    return typeof window !== 'undefined' && window.innerWidth < 768
  }

  function handleMessageTouchStart(message: ChatMessageItem, event: ReactTouchEvent<HTMLDivElement>) {
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
  }

  function handleMessageTouchMove(message: ChatMessageItem, event: ReactTouchEvent<HTMLDivElement>) {
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
  }

  function handleMessageTouchEnd(message: ChatMessageItem) {
    const shouldReply =
      isMobileSwipeViewport() &&
      swipeGestureMessageIdRef.current === message.id &&
      swipeOffsetXRef.current >= SWIPE_REPLY_TRIGGER_PX

    clearLongPressTimeout()
    resetSwipeReplyGesture()

    if (shouldReply) {
      setReplyingToMessage(message)
    }
  }

  function handleMessageTouchCancel() {
    clearLongPressTimeout()
    resetSwipeReplyGesture()
  }

  function renderComposer() {
    return (
      <div>
        <section className="rounded-[24px] border border-black/[0.06] bg-[color:var(--background)]/82 px-2 py-1.5 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-[color:var(--background)]/78">
          <form onSubmit={handleSubmit}>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageInputChange}
              className="sr-only"
              tabIndex={-1}
            />
            {editingMessage ? (
              <div className="mb-1.5 flex items-start justify-between gap-2.5 rounded-[18px] bg-black/[0.04] px-3 py-2 dark:bg-white/[0.06]">
                <div className="min-w-0">
                  <p className="app-text-primary truncate text-sm font-medium">Редактирование сообщения</p>
                  <p className="app-text-secondary truncate text-sm">
                    {editingMessage.previewText || 'Измените текст сообщения'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={clearEditingMessage}
                  className="app-text-secondary shrink-0 rounded-full p-1.5 text-sm"
                  aria-label="Отменить редактирование"
                >
                  X
                </button>
              </div>
            ) : null}
            {replyingToMessage ? (
              <div className="mb-1.5 flex items-start justify-between gap-2.5 rounded-[18px] bg-black/[0.04] px-3 py-2 dark:bg-white/[0.06]">
                <div className="min-w-0">
                  <p className="app-text-primary truncate text-sm font-medium">{replyingToMessage.displayName}</p>
                  <p className="app-text-secondary truncate text-sm">{replyingToMessage.previewText || 'Сообщение'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyingToMessage(null)}
                  className="app-text-secondary shrink-0 rounded-full p-1.5 text-sm"
                  aria-label="Отменить ответ"
                >
                  X
                </button>
              </div>
            ) : null}
            {hasPendingImage ? (
              <div className="mb-1.5 flex items-start justify-between gap-2.5 rounded-[18px] bg-black/[0.04] px-3 py-2 dark:bg-white/[0.06]">
                <div className="min-w-0">
                  <p className="app-text-primary text-sm font-medium">Изображение готово</p>
                  <img
                    src={pendingImageUrl ?? undefined}
                    alt="Предпросмотр"
                    className="mt-2 max-h-36 w-auto max-w-[160px] rounded-2xl object-cover"
                  />
                </div>
                <button
                  type="button"
                  onClick={clearSelectedImage}
                  className="app-text-secondary shrink-0 rounded-full p-1.5 text-sm"
                  aria-label="Убрать изображение"
                >
                  X
                </button>
              </div>
            ) : null}
            {isRecordingVoice || isStartingVoiceRecording ? (
              <div className="mb-1.5 rounded-[18px] bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:bg-red-500/15">
                Recording...
              </div>
            ) : null}
            <div className="flex items-end gap-1.5">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={submitting || uploadingImage || uploadingVoice || isRecordingVoice || isStartingVoiceRecording || Boolean(editingMessageId)}
                className="app-button-secondary flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-base font-medium shadow-none"
                aria-label="Выбрать изображение"
              >
                {uploadingImage ? '...' : '+'}
              </button>
              <div className="app-input flex min-w-0 flex-1 items-end rounded-[22px] border px-3.5 shadow-none">
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
                  placeholder={editingMessage ? 'Измените сообщение' : hasPendingImage ? 'Добавьте подпись' : 'Сообщение'}
                  disabled={submitting || uploadingImage || uploadingVoice || isRecordingVoice || isStartingVoiceRecording}
                  maxLength={CHAT_MESSAGE_MAX_LENGTH}
                  rows={1}
                  className="min-h-11 max-h-[120px] w-full resize-none overflow-hidden bg-transparent py-2.5 text-sm leading-5 outline-none placeholder:app-text-secondary"
                />
              </div>
              {shouldShowVoiceRecorderButton ? (
                <button
                  type="button"
                  onMouseDown={() => {
                    void startVoiceRecording()
                  }}
                  onMouseUp={() => {
                    void stopVoiceRecording()
                  }}
                  onMouseLeave={() => {
                    void stopVoiceRecording()
                  }}
                  onTouchStart={(event) => {
                    event.preventDefault()
                    void startVoiceRecording()
                  }}
                  onTouchEnd={(event) => {
                    event.preventDefault()
                    void stopVoiceRecording()
                  }}
                  onTouchCancel={(event) => {
                    event.preventDefault()
                    void stopVoiceRecording()
                  }}
                  disabled={submitting || uploadingImage || uploadingVoice || isStartingVoiceRecording}
                  className="app-button-primary flex h-10 min-w-10 shrink-0 items-center justify-center rounded-full px-3.5 text-sm font-medium shadow-none disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={isRecordingVoice ? 'Отпустите для отправки голосового сообщения' : 'Удерживайте для записи голосового сообщения'}
                >
                  {isStartingVoiceRecording ? '...' : isRecordingVoice ? 'REC' : 'Mic'}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={submitting || uploadingImage || uploadingVoice || isRecordingVoice || isStartingVoiceRecording || !canSubmitMessage || isMessageTooLong}
                  className="app-button-primary flex h-10 min-w-10 shrink-0 items-center justify-center rounded-full px-3.5 text-sm font-medium shadow-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? '...' : editingMessage ? 'OK' : '>'}
                </button>
              )}
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3 px-1">
              <p className="app-text-secondary text-xs">
                {trimmedDraftMessage.length}/{CHAT_MESSAGE_MAX_LENGTH}{hasPendingImage ? ' + фото' : ''}{isRecordingVoice || isStartingVoiceRecording ? ' + запись' : uploadingVoice ? ' + аудио' : ''}
              </p>
              {submitError ? <p className="text-xs text-red-600">{submitError}</p> : <span />}
            </div>
          </form>
        </section>
      </div>
    )
  }

  function startLongPress(message: ChatMessageItem) {
    clearLongPressTimeout()
    longPressTimeoutRef.current = window.setTimeout(() => {
      navigator.vibrate?.(10)
      setSelectedMessage(message)
      setIsActionSheetOpen(true)
      longPressTimeoutRef.current = null
    }, LONG_PRESS_MS)
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:max-w-none md:p-4">
        {showTitle ? (
          <div className="mb-4 space-y-1">
            <h1 className="app-text-primary text-2xl font-bold">{pageTitle}</h1>
            <p className="app-text-secondary text-sm">{pageDescription}</p>
          </div>
        ) : null}
        <div className="app-card rounded-2xl border p-4 shadow-sm">
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

  if (!isAuthenticated) {
    return (
      <div className="mx-auto flex min-h-[240px] max-w-xl items-center justify-center p-4 md:max-w-none">
        <Link href="/login" className="text-sm underline">
          Открыть вход
        </Link>
      </div>
    )
  }

  return (
    <div
      className={`mx-auto flex h-full min-h-0 max-w-xl flex-col overflow-hidden px-4 md:max-w-none md:p-4 ${
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
          {showScrollToBottomButton ? (
            <div className="pointer-events-none absolute bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-20 md:bottom-24">
              <button
                type="button"
                onClick={() => {
                  setPendingNewMessagesCount(0)
                  scrollPageToBottom('smooth')
                }}
                className="pointer-events-auto relative flex h-12 w-12 items-center justify-center rounded-full border border-black/[0.06] bg-[color:var(--background)]/92 text-black shadow-lg backdrop-blur-md transition-transform duration-200 hover:scale-[1.03] active:scale-95 dark:border-white/10 dark:bg-[color:var(--background)]/88 dark:text-white"
                aria-label={pendingNewMessagesCount > 0 ? getNewMessagesLabel(pendingNewMessagesCount) : 'Прокрутить вниз'}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
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
                  <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white shadow-sm">
                    {pendingNewMessagesCount > 9 ? '9+' : pendingNewMessagesCount}
                  </span>
                ) : null}
              </button>
            </div>
          ) : null}
          <div
            ref={scrollContainerRef}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto [WebkitOverflowScrolling:touch]"
          >
            <div className="flex min-h-full flex-col">
              {error ? (
                <section className="app-card flex flex-1 rounded-2xl border p-4 shadow-sm">
                  <p className="text-sm text-red-600">{error}</p>
                </section>
              ) : messages.length === 0 ? (
                <section className="app-card flex flex-1 flex-col rounded-2xl border p-4 shadow-sm">
                  <p className="app-text-secondary text-sm">Пока нет сообщений.</p>
                  <p className="app-text-secondary mt-2 text-sm">
                    Когда в базе появятся сообщения, они отобразятся здесь.
                  </p>
                </section>
              ) : (
                <section className="app-card flex flex-1 flex-col rounded-2xl border px-4 pb-4 pt-3 shadow-sm">
                  <div className="flex flex-col">
                    {messages.map((message, index) => {
                      const isOwnMessage = currentUserId === message.userId
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
                          key={message.id}
                          className={messageSpacingClass}
                        >
                        {message.id === firstUnreadMessageId ? (
                          <div className="mb-3.5 flex items-center gap-3">
                            <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
                            <p className="app-text-secondary text-xs font-medium">Непрочитанные сообщения</p>
                            <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
                          </div>
                        ) : null}
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
                          <div className={`relative min-w-0 w-full max-w-[85%] ${isOwnMessage ? 'ml-auto' : ''}`}>
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
                              className={`chat-no-select relative z-[2] min-w-0 w-full rounded-[18px] border px-3 py-2 shadow-none ${
                                isOwnMessage
                                  ? 'border-black/[0.05] bg-black/[0.035] dark:border-white/[0.08] dark:bg-white/[0.075]'
                                  : 'border-black/[0.04] bg-black/[0.015] dark:border-white/[0.08] dark:bg-white/[0.035]'
                              } transition-[transform,color,background-color,box-shadow] duration-150`}
                              onTouchStart={(event) => handleMessageTouchStart(message, event)}
                              onTouchEnd={() => handleMessageTouchEnd(message)}
                              onTouchCancel={handleMessageTouchCancel}
                              onTouchMove={(event) => handleMessageTouchMove(message, event)}
                              onMouseDown={() => startLongPress(message)}
                              onMouseUp={clearLongPressTimeout}
                              onMouseLeave={clearLongPressTimeout}
                              onContextMenu={(event) => {
                                event.preventDefault()
                                clearLongPressTimeout()
                                setSelectedMessage(message)
                                setIsActionSheetOpen(true)
                              }}
                            >
                              <ChatMessageBody
                                message={message}
                                isOwnMessage={isOwnMessage}
                                showSenderName={showSenderName}
                                currentUserId={currentUserId}
                                animatedReactionKey={animatedReactionKey}
                                onReplyPreviewClick={replyPreviewTargetId ? () => handleReplyPreviewClick(replyPreviewTargetId) : undefined}
                                onImageClick={setSelectedViewerImageUrl}
                                onReactionToggle={handleToggleReaction}
                              />
                            </div>
                          </div>
                        </article>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}
              <div ref={bottomSentinelRef} className="h-px w-full shrink-0" aria-hidden="true" />
            </div>
          </div>
          <div
            className={`shrink-0 pt-3 ${
              isKeyboardOpen ? 'pb-0' : 'pb-[max(0.75rem,env(safe-area-inset-bottom))]'
            }`}
          >
            {renderComposer()}
          </div>
        </>
      </div>
      {selectedMessage && isActionSheetOpen ? (
        <div className="chat-no-select pointer-events-none fixed inset-x-4 top-[40svh] z-[60] mx-auto max-w-xl -translate-y-1/2 md:left-1/2 md:w-full md:max-w-md md:-translate-x-1/2">
          <div className="chat-no-select chat-selected-preview app-card rounded-2xl border px-4 py-3 shadow-lg ring-1 ring-black/10 dark:ring-white/10">
            <div className="flex items-start gap-3">
              {selectedMessage.avatarUrl ? (
                <Image
                  src={selectedMessage.avatarUrl}
                  alt=""
                  width={40}
                  height={40}
                  className="h-10 w-10 shrink-0 rounded-full object-cover"
                />
              ) : (
                <AvatarFallback />
              )}
              <div className="chat-no-select min-w-0 flex-1 rounded-2xl bg-black/[0.03] px-3 py-2 dark:bg-white/[0.08]">
                <ChatMessageBody
                  message={selectedMessage}
                  currentUserId={currentUserId}
                  animatedReactionKey={animatedReactionKey}
                  onImageClick={setSelectedViewerImageUrl}
                  onReactionToggle={handleToggleReaction}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {selectedViewerImageUrl ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setSelectedViewerImageUrl(null)}
        >
          <button
            type="button"
            aria-label="Закрыть изображение"
            className="absolute right-4 top-4 z-[81] flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-xl text-white backdrop-blur-sm"
            onClick={() => setSelectedViewerImageUrl(null)}
          >
            X
          </button>
          <div
            className="flex max-h-full max-w-full items-center justify-center"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={selectedViewerImageUrl}
              alt="Полноразмерное изображение"
              className="max-h-[calc(100svh-2rem)] max-w-[calc(100vw-2rem)] rounded-2xl object-contain"
            />
          </div>
        </div>
      ) : null}
      {selectedMessage ? (
        <ChatMessageActions
          message={selectedMessage}
          currentUserId={currentUserId}
          open={isActionSheetOpen}
          onOpenChange={handleActionSheetOpenChange}
          onDelete={handleDeleteMessage}
          onEdit={handleEditMessage}
          onReply={handleReplyToMessage}
          onToggleReaction={handleToggleReaction}
        />
      ) : null}
    </div>
  )
}
