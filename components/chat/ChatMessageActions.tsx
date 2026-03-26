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
      <div className="chat-no-select app-card relative w-full rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 shadow-xl md:max-w-md md:rounded-3xl md:pb-4">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200 dark:bg-gray-700 md:hidden" />
        <div className="mb-4 flex items-center justify-between gap-2">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleQuickReaction(emoji)}
              className="app-button-secondary flex h-14 w-14 items-center justify-center rounded-2xl border text-2xl transition-transform duration-150 active:scale-90"
              aria-label={`Реакция ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="chat-no-select mb-4">
          <p className="app-text-primary text-base font-semibold">Действия</p>
          <p className="chat-no-select app-text-secondary mt-1 truncate text-sm">&quot;{messagePreview}&quot;</p>
        </div>
        <div className="space-y-1.5">
          {canEditMessage ? (
            <button
              type="button"
              onClick={handleEdit}
              className="app-text-primary min-h-11 w-full rounded-xl px-4 py-3 text-left text-[15px] font-medium"
            >
              Редактировать
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void handleCopy()
            }}
            className="app-text-primary min-h-11 w-full rounded-xl px-4 py-3 text-left text-[15px] font-medium"
          >
            Копировать
          </button>
          <button
            type="button"
            onClick={handleReply}
            className="app-text-primary min-h-11 w-full rounded-xl px-4 py-3 text-left text-[15px] font-medium"
          >
            Ответить
          </button>
          {isOwnMessage ? (
            <button
              type="button"
              onClick={() => {
                void handleDelete()
              }}
              className="min-h-11 w-full rounded-xl px-4 py-3 text-left text-[15px] font-medium text-red-500"
            >
              Удалить
            </button>
          ) : (
            <button
              type="button"
              onClick={handleOpenProfile}
              className="app-text-primary min-h-11 w-full rounded-xl px-4 py-3 text-left text-[15px] font-medium"
            >
              Открыть профиль
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="app-text-secondary min-h-11 w-full rounded-xl px-4 py-3 text-left text-[15px] font-medium"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}
