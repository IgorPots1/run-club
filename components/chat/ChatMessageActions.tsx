'use client'

import { useRouter } from 'next/navigation'
import type { ChatMessageItem } from '@/lib/chat'

type ChatMessageActionsProps = {
  message: ChatMessageItem
  currentUserId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: (message: ChatMessageItem) => Promise<void> | void
  onEdit: (message: ChatMessageItem) => void
  onReply: (message: ChatMessageItem) => void
  onToggleReaction: (messageId: string, emoji: string) => Promise<void> | void
}

const QUICK_REACTIONS = ['👍', '❤️', '🔥', '😂'] as const

export default function ChatMessageActions({
  message,
  currentUserId,
  open,
  onOpenChange,
  onDelete,
  onEdit,
  onReply,
  onToggleReaction,
}: ChatMessageActionsProps) {
  const router = useRouter()

  const isOwnMessage = currentUserId === message.userId
  const canEditMessage = isOwnMessage && message.messageType === 'text'
  const messagePreview = message.previewText

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.text)
    } catch {
      // Ignore clipboard failures to keep the sheet lightweight.
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
    <div className="chat-no-select fixed inset-0 z-50 flex items-end bg-black/30 md:items-center md:justify-center md:p-4">
      <button
        type="button"
        aria-label="Закрыть действия сообщения"
        className="chat-no-select absolute inset-0"
        onClick={() => onOpenChange(false)}
      />
      <div className="chat-no-select app-card relative w-full rounded-t-[26px] px-4 pb-[calc(0.875rem+env(safe-area-inset-bottom))] pt-3.5 shadow-lg md:max-w-md md:rounded-[26px] md:pb-4">
        <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-gray-200 dark:bg-gray-700 md:hidden" />
        <div className="mb-3 flex items-center justify-between gap-1.5">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleQuickReaction(emoji)}
              className="app-button-secondary flex h-11 w-11 items-center justify-center rounded-xl border text-[22px] shadow-none transition-transform duration-150 active:scale-90"
              aria-label={`Реакция ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="chat-no-select mb-2.5">
          <p className="app-text-primary text-sm font-semibold">Действия</p>
          <p
            className="chat-no-select app-text-secondary mt-0.5 text-[13px] leading-5"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            &quot;{messagePreview}&quot;
          </p>
        </div>
        <div className="space-y-1">
          {canEditMessage ? (
            <button
              type="button"
              onClick={handleEdit}
              className="app-text-primary min-h-[42px] w-full rounded-xl px-4 py-2.5 text-left text-[15px] font-medium"
            >
              Редактировать
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void handleCopy()
            }}
            className="app-text-primary min-h-[42px] w-full rounded-xl px-4 py-2.5 text-left text-[15px] font-medium"
          >
            Копировать
          </button>
          <button
            type="button"
            onClick={handleReply}
            className="app-text-primary min-h-[42px] w-full rounded-xl px-4 py-2.5 text-left text-[15px] font-medium"
          >
            Ответить
          </button>
          {isOwnMessage ? (
            <button
              type="button"
              onClick={() => {
                void handleDelete()
              }}
              className="min-h-[42px] w-full rounded-xl px-4 py-2.5 text-left text-[15px] font-medium text-red-500"
            >
              Удалить
            </button>
          ) : (
            <button
              type="button"
              onClick={handleOpenProfile}
              className="app-text-primary min-h-[42px] w-full rounded-xl px-4 py-2.5 text-left text-[15px] font-medium"
            >
              Открыть профиль
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="app-text-secondary min-h-[42px] w-full rounded-xl px-4 py-2.5 text-left text-[15px] font-medium"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}
