'use client'

import { useRouter } from 'next/navigation'
import type { ChatMessageItem } from '@/lib/chat'

type ChatMessageActionsProps = {
  message: ChatMessageItem
  currentUserId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: (message: ChatMessageItem) => Promise<void> | void
  onReply: (message: ChatMessageItem) => void
}

export default function ChatMessageActions({
  message,
  currentUserId,
  open,
  onOpenChange,
  onDelete,
  onReply,
}: ChatMessageActionsProps) {
  const router = useRouter()

  const isOwnMessage = currentUserId === message.userId
  const messagePreview = message.text.trim()

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

  function handleOpenProfile() {
    onOpenChange(false)
    router.push(`/users/${message.userId}`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/30 md:items-center md:justify-center md:p-4">
      <button
        type="button"
        aria-label="Закрыть действия сообщения"
        className="absolute inset-0"
        onClick={() => onOpenChange(false)}
      />
      <div className="app-card relative w-full rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 shadow-xl md:max-w-md md:rounded-3xl md:pb-4">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200 dark:bg-gray-700 md:hidden" />
        <div className="mb-4">
          <p className="app-text-primary text-base font-semibold">Действия</p>
          <p className="app-text-secondary mt-1 truncate text-sm">&quot;{messagePreview}&quot;</p>
        </div>
        <div className="space-y-1.5">
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
