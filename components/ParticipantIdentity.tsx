'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'

type ParticipantIdentityProps = {
  avatarUrl: string | null
  displayName: string
  level: number
  href?: string | null
  size: 'sm' | 'md'
  nameWeightClass?: 'font-medium' | 'font-semibold' | 'font-bold'
  nameSizeClass?: string
  levelClassName?: string
}

function AvatarFallback({ size }: { size: 'sm' | 'md' }) {
  const sizeClass = size === 'md' ? 'h-11 w-11' : 'h-10 w-10'
  const iconClass = size === 'md' ? 'h-6 w-6' : 'h-5 w-5'

  return (
    <span className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700`}>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className={iconClass}
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

export default function ParticipantIdentity({
  avatarUrl,
  displayName,
  level,
  href = null,
  size,
  nameWeightClass = 'font-semibold',
  nameSizeClass,
  levelClassName,
}: ParticipantIdentityProps) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)
  const avatarSrc = avatarUrl?.trim() ? avatarUrl : null
  const showAvatarImage = Boolean(avatarSrc) && failedAvatarUrl !== avatarSrc
  const avatarSizeClass = size === 'md' ? 'h-11 w-11' : 'h-10 w-10'
  const nameClass = nameSizeClass ?? (size === 'md' ? 'text-[15px]' : '')
  const levelClass = levelClassName ?? 'app-text-secondary break-words text-sm'
  const content = (
    <>
      {showAvatarImage && avatarSrc ? (
        <Image
          src={avatarSrc}
          alt=""
          width={size === 'md' ? 44 : 40}
          height={size === 'md' ? 44 : 40}
          className={`${avatarSizeClass} rounded-full object-cover`}
          onError={() => setFailedAvatarUrl(avatarSrc)}
        />
      ) : (
        <AvatarFallback size={size} />
      )}
      <div className="min-w-0">
        <p className={`app-text-primary break-words ${nameWeightClass} ${nameClass}`.trim()}>
          {displayName.trim() || 'Бегун'}
        </p>
        <p className={levelClass}>{`Уровень ${level}`}</p>
      </div>
    </>
  )

  if (href) {
    return (
      <Link href={href} className="flex min-w-0 items-center gap-3">
        {content}
      </Link>
    )
  }

  return <div className="flex min-w-0 items-center gap-3">{content}</div>
}
