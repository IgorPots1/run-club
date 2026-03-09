'use client'

import Image from 'next/image'
import { useState } from 'react'
import RunLikeControl from '@/components/RunLikeControl'

type WorkoutFeedCardProps = {
  rawTitle: string | null
  xp: number
  createdAt: string
  displayName: string
  avatarUrl: string | null
  likesCount: number
  likedByMe: boolean
  pending: boolean
  onToggleLike: () => void
  subtitle?: string | null
}

function formatRunDate(date: string) {
  const parsedDate = new Date(date)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Дата неизвестна'
  }

  return parsedDate.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  })
}

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

export default function WorkoutFeedCard({
  rawTitle,
  xp,
  createdAt,
  displayName,
  avatarUrl,
  likesCount,
  likedByMe,
  pending,
  onToggleLike,
  subtitle,
}: WorkoutFeedCardProps) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)
  const avatarSrc = avatarUrl?.trim() ? avatarUrl : null
  const showAvatarImage = Boolean(avatarSrc) && failedAvatarUrl !== avatarSrc
  const displayTitle = rawTitle?.trim() || 'Тренировка'
  const displayUserName = displayName.trim() || 'Бегун'

  return (
    <div className="app-card overflow-hidden rounded-2xl px-4 py-3.5 shadow-sm shadow-black/5 ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {showAvatarImage && avatarSrc ? (
            <Image
              src={avatarSrc}
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 rounded-full object-cover"
              onError={() => setFailedAvatarUrl(avatarSrc)}
            />
          ) : (
            <AvatarFallback />
          )}
          <div className="min-w-0">
            <p className="app-text-primary truncate font-semibold">{displayUserName}</p>
            {subtitle ? <p className="app-text-secondary truncate text-sm">{subtitle}</p> : null}
          </div>
        </div>
        <p className="app-text-secondary max-w-[6.5rem] shrink-0 text-right text-xs sm:max-w-none sm:text-sm">{formatRunDate(createdAt)}</p>
      </div>

      <div className="mt-2.5">
        <p className="app-text-primary break-words whitespace-pre-wrap text-[15px] font-semibold leading-5">
          {displayTitle}
        </p>
      </div>

      <div className="mt-2">
        <p className="text-sm font-medium text-amber-500/90">⚡ +{xp} XP</p>
      </div>

      <div className="mt-2.5">
        <RunLikeControl
          likesCount={likesCount}
          likedByMe={likedByMe}
          pending={pending}
          onToggle={onToggleLike}
        />
      </div>
    </div>
  )
}
