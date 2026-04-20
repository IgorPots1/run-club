'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
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
const SAFE_PADDING = 12
const REACTION_BAR_HEIGHT = 44
const REACTION_BAR_WIDTH = 288
const ACTION_CARD_WIDTH = 228
const ACTION_ROW_HEIGHT = 36
const FLOATING_GROUP_GAP = 8
const FLOATING_GROUP_OFFSET = 8
const ACTION_ANIMATION_DURATION_MS = 170
const ACTION_ANIMATION_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
const SWIPE_DISMISS_THRESHOLD_PX = 60

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
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
  const [isVisible, setIsVisible] = useState(false)
  const [dragOffsetY, setDragOffsetY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const backdropPointerStartYRef = useRef<number | null>(null)
  const backdropPointerMovedRef = useRef(false)
  const closeTimeoutRef = useRef<number | null>(null)
  const enterAnimationFrameRef = useRef<number | null>(null)

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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (!open || !anchorRect) {
      setIsVisible(false)
      setDragOffsetY(0)
      setIsDragging(false)
      return
    }

    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }

    setIsVisible(false)
    setDragOffsetY(0)
    setIsDragging(false)
    enterAnimationFrameRef.current = window.requestAnimationFrame(() => {
      setIsVisible(true)
      enterAnimationFrameRef.current = null
    })

    return () => {
      if (enterAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(enterAnimationFrameRef.current)
        enterAnimationFrameRef.current = null
      }
    }
  }, [open, anchorRect])

  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') {
        return
      }

      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current)
      }

      if (enterAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(enterAnimationFrameRef.current)
      }
    }
  }, [])

  if (!open || !anchorRect) {
    return null
  }

  const viewportWidth = viewportSize.width
  const viewportHeight = viewportSize.height
  const reactionBarWidth = Math.min(REACTION_BAR_WIDTH, viewportWidth - (SAFE_PADDING * 2))
  const actionCardWidth = Math.min(ACTION_CARD_WIDTH, viewportWidth - (SAFE_PADDING * 2))
  const estimatedCardHeight = actionCount * ACTION_ROW_HEIGHT + 10
  const totalFloatingGroupHeight = reactionBarHeight > 0
    ? reactionBarHeight + FLOATING_GROUP_GAP + estimatedCardHeight
    : estimatedCardHeight
  const hasSpaceAbove = anchorRect.top >= totalFloatingGroupHeight + SAFE_PADDING + FLOATING_GROUP_OFFSET
  const preferredGroupTop = hasSpaceAbove
    ? anchorRect.top - totalFloatingGroupHeight - FLOATING_GROUP_OFFSET
    : anchorRect.bottom + FLOATING_GROUP_OFFSET
  const groupTop = clamp(
    preferredGroupTop,
    SAFE_PADDING,
    viewportHeight - totalFloatingGroupHeight - SAFE_PADDING
  )
  const reactionBarTop = groupTop
  const actionCardTop = groupTop + (reactionBarHeight > 0 ? REACTION_BAR_HEIGHT + FLOATING_GROUP_GAP : 0)
  const reactionBarLeft = clamp(
    anchorRect.left + anchorRect.width / 2 - reactionBarWidth / 2,
    SAFE_PADDING,
    viewportWidth - reactionBarWidth - SAFE_PADDING
  )
  const actionCardLeft = clamp(
    isOwnMessage ? anchorRect.right - actionCardWidth : anchorRect.left,
    SAFE_PADDING,
    viewportWidth - actionCardWidth - SAFE_PADDING
  )
  const availableActionCardHeight = Math.max(0, viewportHeight - actionCardTop - SAFE_PADDING)
  const dragOpacity = Math.max(0.35, 1 - dragOffsetY / 200)
  const floatingGroupStyle = {
    opacity: isVisible ? dragOpacity : 0,
    transform: isVisible
      ? `scale(1) translateY(${dragOffsetY}px)`
      : `scale(0.96) translateY(${dragOffsetY + 6}px)`,
    transformOrigin: `${anchorRect.left + (anchorRect.width / 2)}px ${hasSpaceAbove ? anchorRect.top : anchorRect.bottom}px`,
    transition: isDragging
      ? 'none'
      : `transform ${ACTION_ANIMATION_DURATION_MS}ms ${ACTION_ANIMATION_EASING}, opacity ${ACTION_ANIMATION_DURATION_MS}ms ${ACTION_ANIMATION_EASING}`,
    willChange: 'transform, opacity',
  } satisfies CSSProperties

  function requestCloseWithAnimation() {
    if (closeTimeoutRef.current !== null) {
      return
    }

    setIsDragging(false)
    setDragOffsetY(0)
    setIsVisible(false)
    closeTimeoutRef.current = window.setTimeout(() => {
      closeTimeoutRef.current = null
      onOpenChange(false)
    }, ACTION_ANIMATION_DURATION_MS)
  }

  function handleBackdropPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (closeTimeoutRef.current !== null) {
      return
    }

    backdropPointerStartYRef.current = event.clientY
    backdropPointerMovedRef.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleBackdropPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const startY = backdropPointerStartYRef.current

    if (startY === null) {
      return
    }

    const nextDeltaY = Math.max(0, event.clientY - startY)
    backdropPointerMovedRef.current = backdropPointerMovedRef.current || nextDeltaY > 3
    setIsDragging(nextDeltaY > 0)
    setDragOffsetY(nextDeltaY)
  }

  function handleBackdropPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    const startY = backdropPointerStartYRef.current
    backdropPointerStartYRef.current = null

    if (startY === null) {
      return
    }

    const deltaY = Math.max(0, event.clientY - startY)
    setIsDragging(false)

    if (deltaY > SWIPE_DISMISS_THRESHOLD_PX) {
      setDragOffsetY(deltaY)
      requestCloseWithAnimation()
      return
    }

    setDragOffsetY(0)
  }

  function handleBackdropPointerCancel() {
    backdropPointerStartYRef.current = null
    backdropPointerMovedRef.current = false
    setIsDragging(false)
    setDragOffsetY(0)
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
    <div className="chat-no-select fixed inset-0 z-50" data-chat-overlay-root="true">
      <button
        type="button"
        aria-label="Закрыть действия сообщения"
        className="chat-no-select absolute inset-0 bg-black/10"
        onPointerDown={handleBackdropPointerDown}
        onPointerMove={handleBackdropPointerMove}
        onPointerUp={handleBackdropPointerUp}
        onPointerCancel={handleBackdropPointerCancel}
        onClick={() => {
          if (backdropPointerMovedRef.current) {
            backdropPointerMovedRef.current = false
            return
          }

          requestCloseWithAnimation()
        }}
      />
      <div className="pointer-events-none absolute inset-0" style={floatingGroupStyle}>
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
            <div className="overflow-y-auto overscroll-contain p-1">
              {canEditMessage ? (
                <button
                  type="button"
                  onClick={handleEdit}
                  className="app-text-primary flex min-h-9 w-full items-center rounded-xl px-2.5 py-1.5 text-left text-sm font-medium"
                >
                  Редактировать
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  void handleCopy()
                }}
                className="app-text-primary flex min-h-9 w-full items-center rounded-xl px-2.5 py-1.5 text-left text-sm font-medium"
              >
                Копировать
              </button>
              {canReply ? (
                <button
                  type="button"
                  onClick={handleReply}
                  className="app-text-primary flex min-h-9 w-full items-center rounded-xl px-2.5 py-1.5 text-left text-sm font-medium"
                >
                  Ответить
                </button>
              ) : null}
              {canViewReaders ? (
                <button
                  type="button"
                  onClick={handleViewReaders}
                  className="app-text-primary flex min-h-9 w-full items-center rounded-xl px-2.5 py-1.5 text-left text-sm font-medium"
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
                  className="flex min-h-9 w-full items-center rounded-xl px-2.5 py-1.5 text-left text-sm font-medium text-red-500"
                >
                  Удалить
                </button>
              ) : canOpenProfile ? (
                <button
                  type="button"
                  onClick={handleOpenProfile}
                  className="app-text-primary flex min-h-9 w-full items-center rounded-xl px-2.5 py-1.5 text-left text-sm font-medium"
                >
                  Открыть профиль
                </button>
              ) : null}
              <button
                type="button"
                onClick={requestCloseWithAnimation}
                className="app-text-secondary flex min-h-9 w-full items-center rounded-xl px-2.5 py-1.5 text-left text-sm font-medium"
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
