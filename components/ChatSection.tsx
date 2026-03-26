'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react'
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
import { getVoiceStream, scheduleVoiceStreamStop } from '@/lib/voice/voiceStream'

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
const VOICE_PLAYBACK_SPEEDS = [1, 1.5, 2] as const
const REPLY_TARGET_HIGHLIGHT_CLASSES = [
  'bg-yellow-100',
  'dark:bg-yellow-500/20',
  'ring-2',
  'ring-yellow-300',
  'dark:ring-yellow-400/40',
]

let activeVoiceMessageAudio: HTMLAudioElement | null = null

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
    typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : resolvedDurationSeconds
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
  }, [currentTimeSeconds, isPlaying])

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
      if (audio.paused) {
        if (activeVoiceMessageAudio && activeVoiceMessageAudio !== audio) {
          activeVoiceMessageAudio.pause()
        }

        activeVoiceMessageAudio = audio
        await audio.play()
        setIsPlaying(true)
        return
      }

      audio.pause()
      setIsPlaying(false)
    } catch (error) {
      console.error('Failed to toggle voice message playback', error)
      setLoadError(true)
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

    if (!audio || !effectiveDurationSeconds || effectiveDurationSeconds <= 0) {
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    const clickOffsetX = event.clientX - bounds.left
    const nextProgress = bounds.width > 0 ? Math.min(1, Math.max(0, clickOffsetX / bounds.width)) : 0
    const nextTimeSeconds = nextProgress * effectiveDurationSeconds

    audio.currentTime = nextTimeSeconds
    setCurrentTimeSeconds(nextTimeSeconds)
    setDisplayedCurrentTimeSeconds(nextTimeSeconds)
  }

  if (loadError) {
    return <p className="mt-1 text-sm text-red-600">Не удалось загрузить голосовое сообщение</p>
  }

  if (!signedUrl) {
    return <p className="mt-1 text-sm app-text-secondary">Загрузка аудио...</p>
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
        src={signedUrl}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) => {
          const nextDurationSeconds = event.currentTarget.duration

          if (
            (!(typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0)) &&
            Number.isFinite(nextDurationSeconds) &&
            nextDurationSeconds > 0
          ) {
            setResolvedDurationSeconds(nextDurationSeconds)
          }
        }}
        onTimeUpdate={(event) => {
          setCurrentTimeSeconds(event.currentTarget.currentTime)
        }}
        onPause={(event) => {
          if (activeVoiceMessageAudio === event.currentTarget) {
            activeVoiceMessageAudio = null
          }
          setCurrentTimeSeconds(event.currentTarget.currentTime)
          setDisplayedCurrentTimeSeconds(event.currentTarget.currentTime)
          setIsPlaying(false)
        }}
        onPlay={() => {
          activeVoiceMessageAudio = audioRef.current
          setDisplayedCurrentTimeSeconds(audioRef.current?.currentTime ?? currentTimeSeconds)
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

  return (
    <>
      {showSenderName ? (
        <p
          className={`truncate ${
            compactPreview ? 'text-[10px]' : 'text-[10px]'
          } ${
            isOwnMessage ? 'app-text-secondary text-right opacity-80' : 'app-text-secondary opacity-85'
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
          className={`mt-1 block overflow-hidden rounded-2xl ${
            compactPreview ? 'max-w-[62%]' : 'max-w-[70%]'
          } ${
            isOwnMessage ? 'ml-auto' : ''
          }`}
          aria-label="Открыть изображение"
        >
          <img
            src={message.imageUrl}
            alt="Вложение"
            className={`w-auto rounded-2xl object-cover ${
              compactPreview ? 'max-h-40' : 'max-h-80'
            }`}
          />
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
            message.replyTo || message.imageUrl || hasVoiceAttachment ? 'mt-1' : showSenderName ? 'mt-px' : ''
          } ${
            compactPreview ? 'leading-5' : 'leading-[1.42]'
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
      <p className={`app-text-secondary ${compactPreview ? 'mt-0.5 text-[11px]' : 'mt-1.5 text-[10px] opacity-70'} ${compactPreview ? '' : isOwnMessage ? 'text-right' : ''}`}>
        {message.createdAtLabel}
        {message.editedAt ? ' • изменено' : ''}
      </p>
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
  const chunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const isStoppingVoiceRecordingRef = useRef(false)
  const shouldCancelVoiceRecordingRef = useRef(false)
  const hasHandledVoiceRecordingStopRef = useRef(false)
  const isSendingVoiceMessageRef = useRef(false)
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
  const [isSendingVoice, setIsSendingVoice] = useState(false)
  const [isStartingVoiceRecording, setIsStartingVoiceRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)
  const [selectedMessage, setSelectedMessage] = useState<ChatMessageItem | null>(null)
  const [selectedMessageAnchorRect, setSelectedMessageAnchorRect] = useState<DOMRect | null>(null)
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false)
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
  const selectedReactionMessage = selectedReactionDetails
    ? messages.find((message) => message.id === selectedReactionDetails.messageId) ?? null
    : null
  const selectedReaction = selectedReactionMessage && selectedReactionDetails
    ? selectedReactionMessage.reactions.find((reaction) => reaction.emoji === selectedReactionDetails.emoji) ?? null
    : null
  const isCurrentUserSelectedInReaction = Boolean(
    currentUserId && selectedReaction?.userIds.includes(currentUserId)
  )
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
    if (!selectedReactionDetails) {
      return
    }

    const nextMessage = messages.find((message) => message.id === selectedReactionDetails.messageId) ?? null
    const nextReaction = nextMessage?.reactions.find((reaction) => reaction.emoji === selectedReactionDetails.emoji) ?? null

    if (!nextReaction || nextReaction.count <= 1) {
      setSelectedReactionDetails(null)
    }
  }, [messages, selectedReactionDetails])

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

      if (timerRef.current !== null) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }

      mediaRecorderRef.current = null
    }
  }, [])

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

  function getReactionProfileForUser(userId: string) {
    const matchingMessage = messagesRef.current.find((message) => message.userId === userId) ?? null

    return {
      displayName: matchingMessage?.displayName ?? (userId === currentUserId ? 'Вы' : 'Бегун'),
      avatarUrl: matchingMessage?.avatarUrl ?? null,
    }
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
              <div className="flex items-end gap-1.5">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={submitting || uploadingImage || uploadingVoice || Boolean(editingMessageId)}
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
            <div className="pointer-events-none absolute bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-3 z-20 md:bottom-20 md:right-4">
              <button
                type="button"
                onClick={() => {
                  setPendingNewMessagesCount(0)
                  scrollPageToBottom('smooth')
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
            <div className="flex min-h-full flex-col">
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
                <section className="flex flex-1 flex-col px-0 pb-3 pt-1">
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
                          <div className={`relative min-w-0 w-full max-w-[78%] ${isOwnMessage ? 'ml-auto' : ''}`}>
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
                              className={`chat-no-select relative z-[2] min-w-0 w-full rounded-[18px] px-3 py-1.5 shadow-none ${
                                isOwnMessage
                                  ? 'bg-[#DCF8C6] dark:bg-green-900/40'
                                  : 'bg-black/[0.04] dark:bg-white/[0.07]'
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
                                onReactionDetailsOpen={(targetMessage, reaction) => {
                                  if (reaction.count > 1) {
                                    setSelectedReactionDetails({
                                      messageId: targetMessage.id,
                                      emoji: reaction.emoji,
                                    })
                                  }
                                }}
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
    </div>
  )
}
