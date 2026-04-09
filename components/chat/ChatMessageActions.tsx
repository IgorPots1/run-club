'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ChatMessageItem } from '@/lib/chat'

type ChatMessageActionsProps = {
  message: ChatMessageItem
  anchorRect: DOMRect | null
  currentUserId: string | null
  isAnnouncementChannel?: boolean
  isReadOnlyAnnouncement?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: (message: ChatMessageItem) => Promise<void> | void
  onEdit: (message: ChatMessageItem) => void
  onReply: (message: ChatMessageItem) => void
  onViewReaders: (message: ChatMessageItem) => void
  onToggleReaction: (messageId: string, emoji: string) => Promise<void> | void
}

const QUICK_REACTIONS = ['👍', '❤️', '🔥', '😂', '👏', '😢', '😮'] as const
const VIEWPORT_PADDING = 12
const REACTION_BAR_HEIGHT = 44
const REACTION_BAR_WIDTH = 288
const ACTION_CARD_WIDTH = 228
const PREVIEW_HEIGHT = 68
const ACTION_ROW_HEIGHT = 40
const FLOATING_GROUP_GAP = 8
const FLOATING_GROUP_OFFSET = 8
const SWIPE_DISMISS_THRESHOLD_PX = 60

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function AvatarFallback() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-4 w-4"
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

export default function ChatMessageActions({
  message,
  anchorRect,
  currentUserId,
  isAnnouncementChannel = false,
  isReadOnlyAnnouncement = false,
  open,
  onOpenChange,
  onDelete,
  onEdit,
  onReply,
  onViewReaders,
  onToggleReaction,
}: ChatMessageActionsProps) {
  const router = useRouter()
  const [viewportSize, setViewportSize] = useState({ width: 390, height: 844 })
  const backdropPointerStartYRef = useRef<number | null>(null)

  const isOwnMessage = currentUserId === message.userId
  const canModerateAnnouncementChannel = isAnnouncementChannel && !isReadOnlyAnnouncement
  const canManageMessage = canModerateAnnouncementChannel || (!isReadOnlyAnnouncement && isOwnMessage)
  const canReact = !isReadOnlyAnnouncement
  const canReply = !isReadOnlyAnnouncement
  const canEditMessage = message.messageType === 'text' && canManageMessage
  const canDeleteMessage = canManageMessage
  const canOpenProfile = !canDeleteMessage && !isOwnMessage
  const canViewReaders = !message.isDeleted
  const actionCount = [
    canEditMessage,
    true,
    canReply,
    canViewReaders,
    canDeleteMessage || canOpenProfile,
    true,
  ].filter(Boolean).length
  const reactionBarHeight = canReact ? REACTION_BAR_HEIGHT : 0

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (!open || !anchorRect) {
      return
    }

    function updateViewportSize() {
      const visualViewport = window.visualViewport
      setViewportSize({
        width: visualViewport?.width ?? window.innerWidth,
        height: visualViewport?.height ?? window.innerHeight,
      })
    }

    updateViewportSize()
    window.addEventListener('resize', updateViewportSize)
    window.visualViewport?.addEventListener('resize', updateViewportSize)

    return () => {
      window.removeEventListener('resize', updateViewportSize)
      window.visualViewport?.removeEventListener('resize', updateViewportSize)
    }
  }, [open, anchorRect])

  if (!open || !anchorRect) {
    return null
  }

  const viewportWidth = viewportSize.width
  const viewportHeight = viewportSize.height
  const previewText = message.previewText || message.text || 'Сообщение'
  const reactionBarWidth = Math.min(REACTION_BAR_WIDTH, viewportWidth - (VIEWPORT_PADDING * 2))
  const actionCardWidth = Math.min(ACTION_CARD_WIDTH, viewportWidth - (VIEWPORT_PADDING * 2))
  const estimatedCardHeight = PREVIEW_HEIGHT + actionCount * ACTION_ROW_HEIGHT + 12
  const totalFloatingGroupHeight = reactionBarHeight > 0
    ? reactionBarHeight + FLOATING_GROUP_GAP + estimatedCardHeight
    : estimatedCardHeight
  const hasSpaceAbove = anchorRect.top >= totalFloatingGroupHeight + VIEWPORT_PADDING + FLOATING_GROUP_OFFSET
  const preferredGroupTop = hasSpaceAbove
    ? anchorRect.top - totalFloatingGroupHeight - FLOATING_GROUP_OFFSET
    : anchorRect.bottom + FLOATING_GROUP_OFFSET
  const groupTop = clamp(
    preferredGroupTop,
    VIEWPORT_PADDING,
    viewportHeight - totalFloatingGroupHeight - VIEWPORT_PADDING
  )
  const reactionBarTop = groupTop
  const actionCardTop = groupTop + (reactionBarHeight > 0 ? REACTION_BAR_HEIGHT + FLOATING_GROUP_GAP : 0)
  const reactionBarLeft = clamp(
    anchorRect.left + anchorRect.width / 2 - reactionBarWidth / 2,
    VIEWPORT_PADDING,
    viewportWidth - reactionBarWidth - VIEWPORT_PADDING
  )
  const actionCardLeft = clamp(
    isOwnMessage ? anchorRect.right - actionCardWidth : anchorRect.left,
    VIEWPORT_PADDING,
    viewportWidth - actionCardWidth - VIEWPORT_PADDING
  )
  const availableActionCardHeight = viewportHeight - actionCardTop - VIEWPORT_PADDING

  function handleBackdropPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    backdropPointerStartYRef.current = event.clientY
  }

  function handleBackdropPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    const startY = backdropPointerStartYRef.current
    backdropPointerStartYRef.current = null

    if (startY === null) {
      return
    }

    if (event.clientY - startY > SWIPE_DISMISS_THRESHOLD_PX) {
      onOpenChange(false)
    }
  }

  function handleBackdropPointerCancel() {
    backdropPointerStartYRef.current = null
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.text)
    } catch {
      // Ignore clipboard failures to keep the action UI lightweight.
    } finally {
      onOpenChange(false)
    }
  }

  async function handleDelete() {
    onOpenChange(false)
    await onDelete(message)
  }

  function handleReply() {
    onOpenChange(false)
    onReply(message)
  }

  function handleViewReaders() {
    onOpenChange(false)
    onViewReaders(message)
  }

  function handleEdit() {
    onOpenChange(false)
    onEdit(message)
  }

  function handleOpenProfile() {
    onOpenChange(false)
    router.push(`/users/${message.userId}`)
  }

  function handleQuickReaction(emoji: string) {
    onOpenChange(false)
    void onToggleReaction(message.id, emoji)
  }

  return (
    <div className="chat-no-select fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Закрыть действия сообщения"
        className="chat-no-select absolute inset-0 bg-black/10"
        onPointerDown={handleBackdropPointerDown}
        onPointerUp={handleBackdropPointerUp}
        onPointerCancel={handleBackdropPointerCancel}
        onClick={() => onOpenChange(false)}
      />
      <div className="pointer-events-none absolute inset-0">
        {canReact ? (
          <div
            className="pointer-events-auto absolute"
            style={{
              top: `${reactionBarTop}px`,
              left: `${reactionBarLeft}px`,
              width: `${reactionBarWidth}px`,
            }}
          >
            <div className="app-card flex flex-wrap items-center justify-center gap-1 rounded-[22px] border border-black/[0.05] px-2 py-1.5 shadow-sm dark:border-white/10">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleQuickReaction(emoji)}
                  className="flex min-h-8 min-w-8 items-center justify-center rounded-full text-[18px] transition-transform duration-150 active:scale-90"
                  aria-label={`Реакция ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div
          className="pointer-events-auto absolute"
          style={{
            top: `${actionCardTop}px`,
            left: `${actionCardLeft}px`,
            width: `${actionCardWidth}px`,
            maxHeight: `${availableActionCardHeight}px`,
          }}
        >
          <div className="app-card flex max-h-full flex-col overflow-hidden rounded-[18px] border border-black/[0.05] shadow-sm dark:border-white/10">
            <div className="flex items-start gap-2 border-b border-black/[0.05] px-2.5 py-2 dark:border-white/10">
              {message.avatarUrl ? (
                <Image
                  src={message.avatarUrl}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 shrink-0 rounded-full object-cover"
                />
              ) : (
                <AvatarFallback />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                  <p className="app-text-primary min-w-0 break-words text-sm font-semibold">{message.displayName}</p>
                  <p className="app-text-secondary text-xs">{message.createdAtLabel}</p>
                </div>
                <p
                  className="app-text-secondary mt-0.5 text-sm leading-5"
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {previewText}
                </p>
              </div>
            </div>
            <div className="overflow-y-auto p-1">
              {canEditMessage ? (
                <button
                  type="button"
                  onClick={handleEdit}
                  className="app-text-primary flex min-h-11 w-full items-center rounded-xl px-2.5 py-2.5 text-left text-sm font-medium"
                >
                  Редактировать
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  void handleCopy()
                }}
                className="app-text-primary flex min-h-11 w-full items-center rounded-xl px-2.5 py-2.5 text-left text-sm font-medium"
              >
                Копировать
              </button>
              {canReply ? (
                <button
                  type="button"
                  onClick={handleReply}
                  className="app-text-primary flex min-h-11 w-full items-center rounded-xl px-2.5 py-2.5 text-left text-sm font-medium"
                >
                  Ответить
                </button>
              ) : null}
              {canViewReaders ? (
                <button
                  type="button"
                  onClick={handleViewReaders}
                  className="app-text-primary flex min-h-11 w-full items-center rounded-xl px-2.5 py-2.5 text-left text-sm font-medium"
                >
                  Просмотрели
                </button>
              ) : null}
              {canDeleteMessage ? (
                <button
                  type="button"
                  onClick={() => {
                    void handleDelete()
                  }}
                  className="flex min-h-11 w-full items-center rounded-xl px-2.5 py-2.5 text-left text-sm font-medium text-red-500"
                >
                  Удалить
                </button>
              ) : canOpenProfile ? (
                <button
                  type="button"
                  onClick={handleOpenProfile}
                  className="app-text-primary flex min-h-11 w-full items-center rounded-xl px-2.5 py-2.5 text-left text-sm font-medium"
                >
                  Открыть профиль
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="app-text-secondary flex min-h-11 w-full items-center rounded-xl px-2.5 py-2.5 text-left text-sm font-medium"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
