'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { LikedUserListItem } from '@/lib/run-likes'

type RunLikesSheetProps = {
  open: boolean
  likesCount: number
  loading?: boolean
  error?: string
  users: LikedUserListItem[]
  onClose: () => void
  onRetry?: () => void
  onSelectUser?: (userId: string) => void
}

function AvatarFallback() {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700">
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

function getLikesLabel(likesCount: number) {
  if (likesCount === 1) {
    return 'лайк'
  }

  if (likesCount >= 2 && likesCount <= 4) {
    return 'лайка'
  }

  return 'лайков'
}

function LikesSheetRow({ user, onSelect }: { user: LikedUserListItem; onSelect: (userId: string) => void }) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)
  const avatarSrc = user.avatarUrl?.trim() ? user.avatarUrl : null
  const showAvatarImage = Boolean(avatarSrc) && failedAvatarUrl !== avatarSrc
  const secondaryLabel = user.nickname?.trim()
    ? `@${user.nickname.trim()}`
    : Number.isFinite(user.level)
      ? `Уровень ${Math.max(1, Math.round(user.level ?? 0))}`
      : null

  return (
    <button
      type="button"
      onClick={() => onSelect(user.userId)}
      className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-1 py-2 text-left"
    >
      {showAvatarImage && avatarSrc ? (
        <Image
          src={avatarSrc}
          alt=""
          width={44}
          height={44}
          className="h-11 w-11 shrink-0 rounded-full object-cover"
          onError={() => setFailedAvatarUrl(avatarSrc)}
        />
      ) : (
        <AvatarFallback />
      )}
      <div className="min-w-0">
        <p className="app-text-primary truncate text-sm font-semibold">{user.displayName}</p>
        {secondaryLabel ? (
          <p className="app-text-secondary truncate text-sm">{secondaryLabel}</p>
        ) : null}
      </div>
    </button>
  )
}

export default function RunLikesSheet({
  open,
  likesCount,
  loading = false,
  error = '',
  users,
  onClose,
  onRetry,
  onSelectUser,
}: RunLikesSheetProps) {
  const router = useRouter()

  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  if (!open) {
    return null
  }

  const likesSummaryLabel = `${likesCount} ${getLikesLabel(likesCount)}`
  const shouldWaitForFreshLikes = likesCount > 0 && users.length === 0 && !error

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 md:items-center md:justify-center md:p-4">
      <button
        type="button"
        aria-label="Закрыть список лайков"
        className="absolute inset-0"
        onClick={onClose}
      />
      <section className="app-card relative w-full rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 shadow-xl md:max-w-md md:rounded-3xl md:pb-4">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200 dark:bg-gray-700 md:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="app-text-primary text-base font-semibold">Лайки</h2>
            <p className="app-text-secondary mt-1 text-sm">{likesSummaryLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="app-text-secondary min-h-11 shrink-0 rounded-xl px-3 py-2 text-sm font-medium"
          >
            Закрыть
          </button>
        </div>

        <div className="mt-4 max-h-[min(60vh,28rem)] overflow-y-auto">
          {loading || shouldWaitForFreshLikes ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 shrink-0 rounded-full skeleton-line" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="skeleton-line h-4 w-28" />
                  <div className="skeleton-line h-4 w-20" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 shrink-0 rounded-full skeleton-line" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="skeleton-line h-4 w-32" />
                  <div className="skeleton-line h-4 w-24" />
                </div>
              </div>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-200/70 px-4 py-4 dark:border-red-900/60">
              <p className="text-sm text-red-600">{error}</p>
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="app-text-primary mt-3 min-h-11 rounded-xl border px-4 py-2 text-sm font-medium"
                >
                  Попробовать снова
                </button>
              ) : null}
            </div>
          ) : users.length === 0 ? (
            <div className="rounded-2xl border border-black/5 px-4 py-6 text-center dark:border-white/10">
              <p className="app-text-primary text-sm font-medium">Пока нет лайков</p>
              <p className="app-text-secondary mt-1 text-sm">Когда кто-то оценит тренировку, список появится здесь.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {users.map((user) => (
                <LikesSheetRow
                  key={user.userId}
                  user={user}
                  onSelect={(userId) => {
                    onClose()
                    if (onSelectUser) {
                      onSelectUser(userId)
                      return
                    }

                    router.push(`/users/${userId}`)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
