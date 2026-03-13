'use client'

import Link from 'next/link'
import Image from 'next/image'
import { memo, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceKm, formatRunTimestampLabel } from '@/lib/format'
import RunLikeControl from '@/components/RunLikeControl'

type WorkoutFeedCardProps = {
  runId?: string
  rawTitle: string | null
  externalSource?: string | null
  distanceKm?: number | null
  pace?: string | number | null
  movingTime?: string | null
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

function StravaIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="block h-[18px] w-[18px] shrink-0 text-[#FC4C02]"
    >
      <path d="M15.39 1.5 9.45 13.17h3.51l2.43-4.79 2.43 4.79h3.5L15.39 1.5Z" />
      <path d="M10 14.95 7.57 19.73h3.51L10 17.62l-1.08 2.11h3.51L10 14.95Z" />
    </svg>
  )
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

function buildDisplayTitle(rawTitle: string | null) {
  return (rawTitle?.trim() || 'Тренировка').replace(/(\d+)\.0(\s*км\b)/g, '$1$2')
}

function WorkoutFeedCard({
  runId = '',
  rawTitle,
  externalSource = null,
  distanceKm,
  pace,
  movingTime = null,
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
  const router = useRouter()
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)
  const [showStravaHint, setShowStravaHint] = useState(false)
  const avatarSrc = avatarUrl?.trim() ? avatarUrl : null
  const showAvatarImage = Boolean(avatarSrc) && failedAvatarUrl !== avatarSrc
  const displayTitle = buildDisplayTitle(rawTitle)
  const displayUserName = displayName.trim() || 'Бегун'
  const distanceLabel = typeof distanceKm === 'number' && Number.isFinite(distanceKm) && distanceKm > 0
    ? `${formatDistanceLabel(distanceKm)} км`
    : '—'
  const paceLabel = normalizePaceLabel(pace)
  const paceWithUnit = paceLabel ? `${paceLabel} /км` : '—'
  const movingTimeLabel = movingTime?.trim() || '—'

  useEffect(() => {
    if (!showStravaHint) {
      return
    }

    const timer = window.setTimeout(() => {
      setShowStravaHint(false)
    }, 2200)

    return () => {
      window.clearTimeout(timer)
    }
  }, [showStravaHint])

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
    <div
      className="app-card relative cursor-pointer overflow-hidden rounded-2xl px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-shadow duration-200 ease-in-out hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] ring-1 ring-black/5 dark:ring-white/10"
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if (!runId) return
        const target = event.target as HTMLElement
        if (target.closest('a,button')) return
        router.push(`/runs/${runId}`)
      }}
      onKeyDown={(event) => {
        if (!runId) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        const target = event.target as HTMLElement
        if (target.closest('a,button')) return
        event.preventDefault()
        router.push(`/runs/${runId}`)
      }}
    >
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
        <p className="app-text-secondary max-w-[6.5rem] shrink-0 text-right text-xs sm:max-w-none sm:text-sm">
          {formatRunTimestampLabel(createdAt, externalSource)}
        </p>
      </div>

      <div className="mt-3">
        <p className="app-text-primary break-words whitespace-pre-wrap text-[15px] font-semibold leading-5">
          {displayTitle}
        </p>
      </div>

      <div className="app-text-primary mt-4 flex items-center gap-2 whitespace-nowrap text-base font-semibold leading-tight">
        <span className="font-semibold">{distanceLabel}</span>
        <span className="app-text-secondary">•</span>
        <span className="font-semibold">{paceWithUnit}</span>
        <span className="app-text-secondary">•</span>
        <span className="font-semibold">{movingTimeLabel}</span>
      </div>

      <div className="app-text-secondary mt-4 text-sm">
        <RunLikeControl
          likesCount={likesCount}
          likedByMe={likedByMe}
          pending={pending}
          onToggle={() => onToggleLike(runId)}
          summaryPrefix={`⚡ +${xp} XP`}
          variant="inline"
        />
      </div>
      {externalSource === 'strava' ? (
        <>
          {showStravaHint ? (
            <div className="app-text-secondary absolute bottom-12 right-4 z-10 rounded-full border bg-white/95 px-3 py-1.5 text-xs shadow-sm dark:bg-black/90">
              Импортировано из Strava
            </div>
          ) : null}
          <button
            type="button"
            aria-label="Показать источник Strava"
            onClick={() => setShowStravaHint((current) => !current)}
            className="absolute bottom-4 right-4 inline-flex h-6 w-6 items-center justify-center rounded-full border bg-white/80 dark:bg-black/20"
          >
            <StravaIcon />
          </button>
        </>
      ) : null}
    </div>
  )
}

export default memo(WorkoutFeedCard)
