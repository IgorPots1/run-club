'use client'

import { memo, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ParticipantIdentity from '@/components/ParticipantIdentity'
import { formatDistanceKm, formatRunTimestampLabel } from '@/lib/format'
import { getStaticMapUrl } from '@/lib/getStaticMapUrl'
import RunLikeControl from '@/components/RunLikeControl'

type WorkoutFeedCardProps = {
  runId?: string
  rawTitle: string | null
  description?: string | null
  externalSource?: string | null
  distanceKm?: number | null
  pace?: string | number | null
  movingTime?: string | null
  mapPolyline?: string | null
  xp: number
  createdAt: string
  displayName: string
  avatarUrl: string | null
  level: number
  likesCount: number
  likedByMe: boolean
  pending: boolean
  onToggleLike: (runId: string) => void
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

function toNullableTrimmedText(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

function WorkoutFeedCard({
  runId = '',
  rawTitle,
  description = null,
  externalSource = null,
  distanceKm,
  pace,
  movingTime = null,
  mapPolyline = null,
  xp,
  createdAt,
  displayName,
  avatarUrl,
  level,
  likesCount,
  likedByMe,
  pending,
  onToggleLike,
  profileHref = null,
}: WorkoutFeedCardProps) {
  const router = useRouter()
  const [failedMapPreviewUrl, setFailedMapPreviewUrl] = useState<string | null>(null)
  const [showStravaHint, setShowStravaHint] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const displayTitle = buildDisplayTitle(rawTitle)
  const normalizedDescription = toNullableTrimmedText(description)
  const mapPreviewUrl = mapPolyline ? getStaticMapUrl(mapPolyline) : null
  const showMapPreview = Boolean(mapPreviewUrl) && failedMapPreviewUrl !== mapPreviewUrl
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
        <ParticipantIdentity
          avatarUrl={avatarUrl}
          displayName={displayName}
          level={level}
          href={profileHref}
          size="sm"
        />
        <p className="app-text-secondary max-w-[6.5rem] shrink-0 text-right text-xs sm:max-w-none sm:text-sm">
          {formatRunTimestampLabel(createdAt, externalSource)}
        </p>
      </div>

      <div className="mt-3">
        <p className="app-text-primary break-words whitespace-pre-wrap text-[15px] font-semibold leading-5">
          {displayTitle}
        </p>
        {normalizedDescription ? (
          <div className="mt-1">
            <p
              className={`app-text-secondary break-words text-sm leading-5 ${
                expanded ? '' : 'line-clamp-2'
              }`}
            >
              {normalizedDescription}
            </p>

            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="app-text-muted mt-1 text-xs"
            >
              {expanded ? 'Скрыть' : 'Читать'}
            </button>
          </div>
        ) : null}
      </div>

      {showMapPreview && mapPreviewUrl ? (
        <div className="mt-3.5 overflow-hidden rounded-2xl bg-[var(--surface-muted)] shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <div className="relative aspect-[2.15/1] w-full">
            <img
              src={mapPreviewUrl}
              alt="Предпросмотр маршрута"
              className="h-full w-full rounded-xl object-cover"
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => setFailedMapPreviewUrl(mapPreviewUrl)}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-t from-black/60 via-black/18 to-transparent"
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-3.5 pt-8">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] sm:text-base">
                <span>{distanceLabel}</span>
                <span className="text-white/75">•</span>
                <span>{paceWithUnit}</span>
                <span className="text-white/75">•</span>
                <span>{movingTimeLabel}</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="app-text-primary mt-4 flex items-center gap-2 whitespace-nowrap text-base font-semibold leading-tight">
          <span className="font-semibold">{distanceLabel}</span>
          <span className="app-text-secondary">•</span>
          <span className="font-semibold">{paceWithUnit}</span>
          <span className="app-text-secondary">•</span>
          <span className="font-semibold">{movingTimeLabel}</span>
        </div>
      )}

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
