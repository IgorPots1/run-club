'use client'

import Image from 'next/image'
import Link from 'next/link'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react'
import ConfirmActionSheet from '@/components/ConfirmActionSheet'
import ChatMessageActions from '@/components/chat/ChatMessageActions'
import {
  CHAT_OPEN_DEBUG,
  CHAT_OPEN_DEBUG_EVENT,
  getChatOpenDebugEntries,
  pushChatOpenDebug,
  type ChatOpenDebugOverlayEntry,
} from '@/lib/chatOpenDebug'
import { updatePrefetchedMessagesListThreadLastMessage } from '@/lib/chat/messagesListPrefetch'
import type { ChatThreadLastMessage } from '@/lib/chat/threads'
import {
  CHAT_MESSAGE_MAX_LENGTH,
  createChatMessage,
  createVoiceChatMessage,
  getCachedRecentChatMessages,
  getPrefetchedRecentChatMessages,
  loadChatMessageById,
  loadChatMessageItem,
  loadOlderChatMessages,
  loadRecentChatMessages,
  setCachedRecentChatMessages,
  softDeleteChatMessage,
  toggleChatMessageReaction,
  type ChatMessageItem,
  updateChatMessage,
  uploadChatImage,
} from '@/lib/chat'
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

function ChatOpenDebugOverlay() {
  const [entries, setEntries] = useState<ChatOpenDebugOverlayEntry[]>([])

  useEffect(() => {
    if (!CHAT_OPEN_DEBUG || typeof window === 'undefined') {
      return
    }

    setEntries(getChatOpenDebugEntries())

    function handleDebugEvent(event: Event) {
      const detail = (event as CustomEvent<ChatOpenDebugOverlayEntry[]>).detail
      setEntries(detail ?? [])
    }

    window.addEventListener(CHAT_OPEN_DEBUG_EVENT, handleDebugEvent as EventListener)

    return () => {
      window.removeEventListener(CHAT_OPEN_DEBUG_EVENT, handleDebugEvent as EventListener)
    }
  }, [])

  if (!CHAT_OPEN_DEBUG || entries.length === 0) {
    return null
  }

  return (
    <div className="pointer-events-none fixed inset-x-2 bottom-2 z-[90] rounded-xl bg-black/70 px-2 py-1.5 text-[10px] leading-4 text-white shadow-lg backdrop-blur-sm">
      {entries.map((entry) => (
        <div key={entry.id} className="truncate">
          {entry.now} {entry.label}
        </div>
      ))}
    </div>
  )
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

function createOptimisticMessageId(prefix: 'text' | 'image') {
  return `temp-${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function findMatchingOptimisticTextOrImageMessage(
  messages: ChatMessageItem[],
  nextMessage: ChatMessageItem
) {
  if (nextMessage.messageType === 'voice') {
    return null
  }

  const nextMessageCreatedAtMs = new Date(nextMessage.createdAt).getTime()
  const matchingOptimisticMessages = messages.filter((message) => {
    if (!message.isOptimistic) {
      return false
    }

    if (message.messageType === 'voice' || nextMessage.messageType === 'voice') {
      return false
    }

    const messageCreatedAtMs = new Date(message.createdAt).getTime()

    return (
      message.userId === nextMessage.userId &&
      message.text === nextMessage.text &&
      message.imageUrl === nextMessage.imageUrl &&
      message.replyToId === nextMessage.replyToId &&
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
  imageUrl,
  onClose,
}: {
  imageUrl: string
  onClose: () => void
}) {
  const [isVisible, setIsVisible] = useState(false)
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
  })
  const lastTapRef = useRef<{ time: number }>({ time: 0 })

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
      setDismissTranslateY(Math.max(0, gestureState.startDismissTranslateY + deltaY))
    }
  }

  function handleImageTouchEnd() {
    const gestureState = gestureStateRef.current
    const dismissThreshold = 120

    if (gestureState.mode === 'dismiss') {
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
          src={imageUrl}
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
  onImageClick?: (imageUrl: string) => void
  onImageLoad?: () => void
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
  const isImageOnlyMessage = Boolean(message.imageUrl && !message.text && !message.replyTo && !hasVoiceAttachment)
  const isPendingMessage = message.isOptimistic && message.optimisticStatus === 'sending'
  const isFailedMessage = message.isOptimistic && message.optimisticStatus === 'failed'

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
      {message.imageUrl ? (
        <button
          type="button"
          onClick={() => onImageClick?.(message.imageUrl!)}
          className={`relative mt-1 block overflow-hidden rounded-2xl ${
            compactPreview ? 'max-w-[62%]' : 'max-w-[72%]'
          } ${
            isImageOnlyMessage
              ? isOwnMessage
                ? 'ml-auto mr-1.5'
                : ''
              : isOwnMessage
                ? 'ml-auto'
                : ''
          }`}
          aria-label="Открыть изображение"
        >
          <img
            src={message.imageUrl}
            alt="Вложение"
            onLoad={onImageLoad}
            className={`w-auto rounded-2xl object-cover ${
              compactPreview ? 'max-h-40' : 'max-h-80'
            }`}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/55 via-black/15 to-transparent"
          />
          <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/38 px-1.5 py-0.5 text-[11px] font-medium leading-none text-white backdrop-blur-[2px]">
            {message.createdAtLabel}
          </span>
        </button>
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
            message.replyTo || message.imageUrl || hasVoiceAttachment ? 'mt-1' : showSenderName ? 'mt-0.5' : ''
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
        <p className={`${isFailedMessage ? 'text-red-600' : 'app-text-secondary'} ${compactPreview ? 'mt-0.5 text-[11px]' : 'mt-1 text-[9px] opacity-60'} ${compactPreview ? '' : isOwnMessage ? 'text-right' : ''}`}>
          {message.createdAtLabel}
          {message.editedAt ? ' • изменено' : ''}
          {isPendingMessage ? ' • Отправка...' : ''}
          {isFailedMessage ? ' • Не отправлено' : ''}
        </p>
      ) : isPendingMessage || isFailedMessage ? (
        <p className={`mt-1 text-[11px] ${isOwnMessage ? 'text-right' : ''} ${isFailedMessage ? 'text-red-600' : 'app-text-secondary opacity-70'}`}>
          {isPendingMessage ? 'Отправка...' : 'Не отправлено'}
        </p>
      ) : null}
      {isFailedMessage && onRetryFailedMessage ? (
        <div className={`mt-1 flex ${isOwnMessage ? 'justify-end' : ''}`}>
          <button
            type="button"
            onClick={() => onRetryFailedMessage(message)}
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
  onImageClick: (imageUrl: string) => void
  onImageLoad: () => void
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
          const isImageOnlyMessage = Boolean(message.imageUrl && !message.text && !message.replyTo && message.messageType !== 'voice')
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
  const [loading, setLoading] = useState(true)
  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const [pendingInitialScroll, setPendingInitialScroll] = useState(false)
  const [hasDeferredInitialSettle, setHasDeferredInitialSettle] = useState(false)
  const [isInitialBottomLockActive, setIsInitialBottomLockActive] = useState(false)
  const [pendingNewMessagesCount, setPendingNewMessagesCount] = useState(0)
  const [hasMoreOlderMessages, setHasMoreOlderMessages] = useState(true)
  const [error, setError] = useState('')
  const [draftMessage, setDraftMessage] = useState('')
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadingVoice, setUploadingVoice] = useState(false)
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [isSendingVoice, setIsSendingVoice] = useState(false)
  const [isStartingVoiceRecording, setIsStartingVoiceRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)
  const [selectedMessage, setSelectedMessage] = useState<ChatMessageItem | null>(null)
  const [selectedMessageAnchorRect, setSelectedMessageAnchorRect] = useState<DOMRect | null>(null)
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false)
  const [deleteConfirmationMessage, setDeleteConfirmationMessage] = useState<ChatMessageItem | null>(null)
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessageItem | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [selectedViewerImageUrl, setSelectedViewerImageUrl] = useState<string | null>(null)
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
  const chatOpenDebugStateRef = useRef({
    threadId: threadId || null,
    pendingInitialScroll,
    hasDeferredInitialSettle,
    isInitialBottomLockActive,
    isThreadLayoutReady,
    showScrollToBottomButton,
    messageCount: messages.length,
  })
  chatOpenDebugStateRef.current = {
    threadId: threadId || null,
    pendingInitialScroll,
    hasDeferredInitialSettle,
    isInitialBottomLockActive,
    isThreadLayoutReady,
    showScrollToBottomButton,
    messageCount: messages.length,
  }

  const logChatOpenDebug = useCallback((event: string, extra?: Record<string, unknown>) => {
    if (!CHAT_OPEN_DEBUG || typeof window === 'undefined') {
      return
    }

    const snapshotState = chatOpenDebugStateRef.current
    const scrollContainer = scrollContainerRef.current
    const scrollContent = scrollContentRef.current
    const composerWrapper = composerWrapperRef.current
    const scrollTop = scrollContainer?.scrollTop ?? null
    const scrollHeight = scrollContainer?.scrollHeight ?? null
    const clientHeight = scrollContainer?.clientHeight ?? null
    const distanceFromBottom =
      scrollTop === null || scrollHeight === null || clientHeight === null
        ? null
        : scrollHeight - (scrollTop + clientHeight)

    pushChatOpenDebug({
      now: Math.round(performance.now()),
      scope: 'chat-section',
      event,
      threadId: snapshotState.threadId,
      scrollTop,
      scrollHeight,
      clientHeight,
      distanceFromBottom,
      pendingInitialScroll: snapshotState.pendingInitialScroll,
      hasDeferredInitialSettle: snapshotState.hasDeferredInitialSettle,
      isInitialBottomLockActive: snapshotState.isInitialBottomLockActive,
      isThreadLayoutReady: snapshotState.isThreadLayoutReady,
      showScrollToBottomButton: snapshotState.showScrollToBottomButton,
      messageCount: snapshotState.messageCount,
      contentHeight: scrollContent ? Math.round(scrollContent.getBoundingClientRect().height) : null,
      composerHeight: composerWrapper ? Math.round(composerWrapper.getBoundingClientRect().height) : null,
      ...extra,
    })
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

    logChatOpenDebug('bottom-lock-deactivate', {
      reason,
      preserveUserCancelled,
    })
    setIsInitialBottomLockActive(false)
  }, [clearInitialBottomLockFrames, clearInitialBottomLockSafetyTimeout, logChatOpenDebug])

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
      logChatOpenDebug('scroll-to-bottom-skipped', { source, behavior, reason: 'missing-scroll-container' })
      return
    }

    logChatOpenDebug('scroll-to-bottom', { source, behavior })
    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior,
    })
  }, [logChatOpenDebug])

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
        logChatOpenDebug('bottom-lock-stability-reset', {
          source,
          stableSampleCount: 0,
          observedScrollHeight: geometry.scrollHeight,
          observedClientHeight: geometry.clientHeight,
        })
        scheduleInitialBottomLockStabilityCheck('geometry-changed')
        return
      }

      initialBottomLockStableSampleCountRef.current += 1
      logChatOpenDebug('bottom-lock-stability-sample', {
        source,
        stableSampleCount: initialBottomLockStableSampleCountRef.current,
        observedScrollHeight: geometry.scrollHeight,
        observedClientHeight: geometry.clientHeight,
      })

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
    logChatOpenDebug,
  ])

  const keepInitialBottomLockAnchored = useCallback((source = 'unspecified') => {
    if (initialBottomLockUserCancelledRef.current) {
      logChatOpenDebug('bottom-lock-reanchor-skipped', { source, reason: 'user-cancelled' })
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
      logChatOpenDebug('bottom-lock-geometry-changed', {
        source,
        observedScrollHeight: geometry?.scrollHeight ?? null,
        observedClientHeight: geometry?.clientHeight ?? null,
      })
    }

    clearInitialBottomLockFrames()
    initialBottomLockProgrammaticFrameRef.current = window.requestAnimationFrame(() => {
      initialBottomLockProgrammaticFrameRef.current = null
      logChatOpenDebug('bottom-lock-reanchor', { source })
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
    logChatOpenDebug,
    scheduleInitialBottomLockSafetyTimeout,
    scheduleInitialBottomLockStabilityCheck,
    scrollPageToBottom,
  ])

  const handleMessageImageLoad = useCallback(() => {
    logChatOpenDebug('image-load')

    if (!isThreadLayoutReady && hasDeferredInitialSettle) {
      logChatOpenDebug('image-load-deferred-for-thread-layout')
      return
    }

    if (isInitialBottomLockActive) {
      keepInitialBottomLockAnchored('image-load')
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
    logChatOpenDebug,
    keepInitialBottomLockAnchored,
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
    messagesRef.current = messages
  }, [messages])

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
    const cachedRecentMessages = currentUserId
      ? getCachedRecentChatMessages(threadId)
      : null

    logChatOpenDebug('thread-reset', {
      cachedMessageCount: cachedRecentMessages?.messages.length ?? 0,
      nextPendingInitialScroll: Boolean(cachedRecentMessages?.messages.length),
    })
    deactivateInitialBottomLock('thread-reset')
    pendingDeletedMessageIdsRef.current.clear()
    messagesRef.current = []
    setMessages(cachedRecentMessages?.messages ?? [])
    setPendingInitialScroll(false)
    setHasDeferredInitialSettle(Boolean(cachedRecentMessages?.messages.length))
    setPendingNewMessagesCount(0)
    setHasMoreOlderMessages(cachedRecentMessages?.hasMoreOlderMessages ?? true)
    setError('')
    setDraftMessage('')
    setSubmitError('')
    setReplyingToMessage(null)
    setEditingMessageId(null)
    setSelectedMessage(null)
    setIsActionSheetOpen(false)
    setLoading(!cachedRecentMessages)
  }, [currentUserId, deactivateInitialBottomLock, logChatOpenDebug, threadId])

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
  }, [deactivateInitialBottomLock])

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
    logChatOpenDebug('scroll-to-bottom-button-visibility')
  }, [logChatOpenDebug, showScrollToBottomButton])

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

        const initialMessages =
          cachedRecentMessages?.messages ??
          (await getPrefetchedRecentChatMessages(INITIAL_CHAT_MESSAGE_LIMIT, threadId)) ??
          await loadRecentChatMessages(INITIAL_CHAT_MESSAGE_LIMIT, threadId)

        if (!isMounted) {
          return
        }

        logChatOpenDebug('initial-messages-ready', {
          initialMessageCount: initialMessages.length,
          hasCachedMessages,
        })
        setMessages(keepLatestRenderedMessages(initialMessages))
        setError('')
        setHasMoreOlderMessages(cachedRecentMessages?.hasMoreOlderMessages ?? (initialMessages.length === INITIAL_CHAT_MESSAGE_LIMIT))
        if (!hasCachedMessages) {
          logChatOpenDebug('initial-settle-requested', {
            nextHasDeferredInitialSettle: initialMessages.length > 0,
          })
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
  }, [currentUserId, keepLatestRenderedMessages, logChatOpenDebug, threadId])

  useEffect(() => {
    if (loading || !isThreadLayoutReady || !hasDeferredInitialSettle) {
      return
    }

    if (messages.length === 0) {
      return
    }

    logChatOpenDebug('pending-initial-scroll-set', {
      source: 'thread-layout-ready',
    })
    setPendingInitialScroll(true)
    setHasDeferredInitialSettle(false)
  }, [
    hasDeferredInitialSettle,
    isThreadLayoutReady,
    loading,
    logChatOpenDebug,
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
      logChatOpenDebug('initial-open-waiting-for-thread-layout')
      return
    }

    initialBottomLockUserCancelledRef.current = false
    initialBottomLockNextSourceRef.current = 'initial-open'
    initialBottomLockLastGeometryRef.current = getInitialBottomLockGeometry()
    initialBottomLockStableSampleCountRef.current = 0
    logChatOpenDebug('bottom-lock-activate', { source: 'initial-open' })
    setIsInitialBottomLockActive(true)
    setPendingInitialScroll(false)
  }, [
    getInitialBottomLockGeometry,
    isThreadLayoutReady,
    loading,
    logChatOpenDebug,
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
      logChatOpenDebug('layout-change', { source })
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

        logChatOpenDebug('resize-observer', {
          source,
          entryHeight: Math.round(entry.contentRect.height),
        })
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
  }, [isInitialBottomLockActive, keepInitialBottomLockAnchored, logChatOpenDebug])

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
      logChatOpenDebug('manual-scroll-detected')
      deactivateInitialBottomLock('user-scroll-away', true)
    }

    function markUserScrollIntent() {
      initialBottomLockUserScrollIntentRef.current = true
      logChatOpenDebug('user-scroll-intent')
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
  }, [deactivateInitialBottomLock, isInitialBottomLockActive, isNearBottom, logChatOpenDebug])

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
          const nextMessageId = String((payload.new as { id?: string } | null)?.id ?? '')
          const shouldAutoScroll = isNearBottom()
          const optimisticServerMatch = messagesRef.current.find((message) =>
            message.isOptimistic &&
            message.optimisticStatus === 'sending' &&
            message.optimisticServerMessageId === nextMessageId
          ) ?? null

          if (!nextMessageId) {
            return
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
            const nextMessage = await loadChatMessageItem(nextMessageId, threadId)

            if (!nextMessage) {
              return
            }

            const optimisticVoiceMatch = messagesRef.current.find((message) =>
              message.isOptimistic &&
              message.messageType === 'voice' &&
              nextMessage.messageType === 'voice' &&
              message.userId === nextMessage.userId &&
              message.mediaUrl === nextMessage.mediaUrl
            )

            if (optimisticVoiceMatch) {
              revokeOptimisticVoiceObjectUrl(optimisticVoiceMatch)
              setMessages((currentMessages) =>
                keepLatestRenderedMessages(
                  replaceMessageById(currentMessages, optimisticVoiceMatch.id, nextMessage),
                  {
                    preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
                  }
                )
              )
              return
            }

            const optimisticTextOrImageMatch =
              optimisticServerMatch ??
              findMatchingOptimisticTextOrImageMessage(messagesRef.current, nextMessage)

            if (optimisticTextOrImageMatch) {
              setMessages((currentMessages) =>
                keepLatestRenderedMessages(
                  replaceMessageById(currentMessages, optimisticTextOrImageMatch.id, nextMessage),
                  {
                    preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
                  }
                )
              )
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
  }, [currentUserId, isNearBottom, keepLatestRenderedMessages, loading, refreshMessages, threadId])

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
        const optimisticMessage = createOptimisticTextOrImageMessage({
          userId: currentUserId,
          text: trimmedDraftMessage,
          imageUrl: pendingImageUrl,
        })

        setDraftMessage('')
        clearSelectedImage()
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
        clearSelectedImage()
        setReplyingToMessage(null)
        setEditingMessageId(null)
        window.requestAnimationFrame(() => {
          resizeComposerTextarea()
        })
      }
    } catch {
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
    if (
      !currentUserId ||
      message.userId !== currentUserId ||
      !message.isOptimistic ||
      message.optimisticStatus !== 'failed' ||
      message.messageType === 'voice'
    ) {
      return
    }

    setSubmitError('')
    setError('')

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

  function createOptimisticTextOrImageMessage({
    userId,
    text,
    imageUrl,
  }: {
    userId: string
    text: string
    imageUrl: string | null
  }): ChatMessageItem {
    const createdAt = new Date().toISOString()
    const messageType = imageUrl ? 'image' : 'text'
    const previewText = text.trim() || (imageUrl ? 'Фото' : '')

    return {
      id: createOptimisticMessageId(messageType),
      userId,
      text,
      messageType,
      imageUrl,
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
      isOptimistic: true,
      optimisticStatus: 'sending',
      optimisticServerMessageId: null,
      optimisticLocalObjectUrl: null,
    }
  }

  async function reconcileOptimisticMessageWithServerMessage(
    optimisticMessage: ChatMessageItem,
    messageId: string
  ) {
    try {
      const nextMessage = await loadChatMessageItem(messageId, threadId)

      if (!nextMessage) {
        throw new Error('chat_message_item_missing')
      }

      setMessages((currentMessages) =>
        keepLatestRenderedMessages(
          replaceMessageById(currentMessages, optimisticMessage.id, nextMessage),
          {
            preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
          }
        )
      )
    } catch {
      setMessages((currentMessages) =>
        keepLatestRenderedMessages(
          currentMessages.map((message) =>
            message.id === optimisticMessage.id
              ? {
                  ...message,
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

  async function sendOptimisticTextOrImageMessage(optimisticMessage: ChatMessageItem) {
    const shouldAutoScroll = isNearBottom()

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
                    ...optimisticMessage,
                    optimisticStatus: 'sending',
                    optimisticServerMessageId: null,
                  }
                : message
            )
          : insertMessageChronologically(currentMessages, optimisticMessage),
        {
          preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
        }
      )
    )

    const { error: insertError, messageId } = await createChatMessage(
      optimisticMessage.userId,
      optimisticMessage.text,
      optimisticMessage.replyToId ?? null,
      threadId,
      optimisticMessage.imageUrl
    )

    if (insertError) {
      setMessages((currentMessages) =>
        keepLatestRenderedMessages(
          currentMessages.map((message) =>
            message.id === optimisticMessage.id
              ? {
                  ...message,
                  optimisticStatus: 'failed',
                }
              : message
          ),
          {
            preserveExpandedHistory: currentMessages.length > MAX_RENDERED_CHAT_MESSAGES,
          }
        )
      )
      throw insertError
    }

    if (messageId) {
      await reconcileOptimisticMessageWithServerMessage(optimisticMessage, messageId)
    }
  }

  function createOptimisticVoiceMessage(file: File, userId: string, durationSeconds: number | null): ChatMessageItem {
    const createdAt = new Date().toISOString()
    const localObjectUrl = URL.createObjectURL(file)

    return {
      id: `temp-${Date.now()}`,
      userId,
      text: '',
      messageType: 'voice',
      imageUrl: null,
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
      isOptimistic: true,
      optimisticStatus: 'sending',
      optimisticServerMessageId: null,
      optimisticLocalObjectUrl: localObjectUrl,
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
    const optimisticMessage = createOptimisticVoiceMessage(file, currentUserId, durationSeconds)
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

      const { error: insertError } = await createVoiceChatMessage(
        currentUserId,
        path,
        durationSeconds,
        replyingToMessage?.id ?? null,
        threadId
      )

      if (insertError) {
        throw new Error(`voice_insert_failed:${insertError.message}`)
      }

      setPendingNewMessagesCount(0)
      setReplyingToMessage(null)
      cleanupVoiceRecordingResources()
    } catch (error) {
      setMessages((currentMessages) => {
        const optimisticMatch = currentMessages.find((message) => message.id === optimisticMessage.id)

        if (optimisticMatch) {
          revokeOptimisticVoiceObjectUrl(optimisticMatch)
        }

        return removeMessageById(currentMessages, optimisticMessage.id)
      })
      const errorDetails = getErrorDetails(error)
      console.error('Failed to send voice message', errorDetails)
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

  function renderComposer() {
    return (
      <div>
        <section className="rounded-[26px] border border-black/[0.06] bg-[color:var(--background)]/90 px-3 py-2 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-[color:var(--background)]/86">
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
                  className="app-text-secondary mt-0.5 shrink-0 rounded-full p-1"
                  aria-label="Убрать изображение"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
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
                  disabled={submitting || uploadingImage || uploadingVoice || Boolean(editingMessageId)}
                  className="app-button-secondary flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-base font-medium shadow-none"
                  aria-label="Выбрать изображение"
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
                    placeholder={editingMessage ? 'Измените сообщение' : hasPendingImage ? 'Добавьте подпись' : 'Сообщение'}
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
                {trimmedDraftMessage.length}/{CHAT_MESSAGE_MAX_LENGTH}{hasPendingImage ? ' + фото' : ''}{isRecordingVoice || isStartingVoiceRecording ? ' + запись' : uploadingVoice ? ' + аудио' : ''}
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
          <div
            ref={scrollContainerRef}
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
                  onImageClick={setSelectedViewerImageUrl}
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
      {selectedViewerImageUrl ? (
        <FullscreenImageViewer
          imageUrl={selectedViewerImageUrl}
          onClose={() => setSelectedViewerImageUrl(null)}
        />
      ) : null}
      <ChatOpenDebugOverlay />
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
