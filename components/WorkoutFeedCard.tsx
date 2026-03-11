'use client'

import Link from 'next/link'
import Image from 'next/image'
import { memo, useState } from 'react'
import { formatDistanceKm } from '@/lib/format'
import RunLikeControl from '@/components/RunLikeControl'

type WorkoutFeedCardProps = {
  runId?: string
  rawTitle: string | null
  distanceKm?: number | null
  pace?: string | number | null
  xp: number
  createdAt: string
  displayName: string
  avatarUrl: string | null
  likesCount: number
  likedByMe: boolean
  pending: boolean
  onToggleLike: (runId: string) => void
  subtitle?: string | null
  profileHref?: string | null
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

function formatDistanceLabel(distanceKm: number) {
  return formatDistanceKm(distanceKm)
}

function normalizePaceLabel(pace: string | number | null | undefined) {
  if (pace == null) return ''

  const paceLabel = String(pace).trim()
  if (!paceLabel) return ''

  return paceLabel.endsWith('/км') ? paceLabel.slice(0, -3) : paceLabel
}

function buildDisplayTitle(rawTitle: string | null, distanceKm?: number | null, pace?: string | number | null) {
  const baseTitle = (rawTitle?.trim() || 'Тренировка').replace(/(\d+)\.0(\s*км\b)/g, '$1$2')
  const paceLabel = normalizePaceLabel(pace)

  if (!paceLabel) {
    return baseTitle
  }

  if (typeof distanceKm === 'number' && Number.isFinite(distanceKm) && distanceKm > 0) {
    const distanceLabel = `${formatDistanceLabel(distanceKm)} км`

    if (baseTitle.includes(distanceLabel)) {
      return `${baseTitle} • ${paceLabel}/км`
    }

    return `${baseTitle} - ${distanceLabel} • ${paceLabel}/км`
  }

  return `${baseTitle} • ${paceLabel}/км`
}

function WorkoutFeedCard({
  runId = '',
  rawTitle,
  distanceKm,
  pace,
  xp,
  createdAt,
  displayName,
  avatarUrl,
  likesCount,
  likedByMe,
  pending,
  onToggleLike,
  subtitle,
  profileHref = null,
}: WorkoutFeedCardProps) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)
  const avatarSrc = avatarUrl?.trim() ? avatarUrl : null
  const showAvatarImage = Boolean(avatarSrc) && failedAvatarUrl !== avatarSrc
  const displayTitle = buildDisplayTitle(rawTitle, distanceKm, pace)
  const displayUserName = displayName.trim() || 'Бегун'
  const profileIdentity = (
    <>
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
    </>
  )

  return (
    <div className="app-card overflow-hidden rounded-2xl px-4 py-4 shadow-sm shadow-black/5 ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-start justify-between gap-3">
        {profileHref ? (
          <Link href={profileHref} className="flex min-w-0 items-center gap-3">
            {profileIdentity}
          </Link>
        ) : (
          <div className="flex min-w-0 items-center gap-3">
            {profileIdentity}
          </div>
        )}
        <p className="app-text-secondary max-w-[6.5rem] shrink-0 text-right text-xs sm:max-w-none sm:text-sm">{formatRunDate(createdAt)}</p>
      </div>

      <div className="mt-3">
        <p className="app-text-primary break-words whitespace-pre-wrap text-[15px] font-semibold leading-5">
          {displayTitle}
        </p>
      </div>

      <div className="mt-3">
        <RunLikeControl
          likesCount={likesCount}
          likedByMe={likedByMe}
          pending={pending}
          onToggle={() => onToggleLike(runId)}
          summaryPrefix={`⚡ +${xp} XP`}
          variant="inline"
        />
      </div>
    </div>
  )
}

export default memo(WorkoutFeedCard)
