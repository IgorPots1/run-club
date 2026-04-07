'use client'

import { memo, useMemo, useRef, useState, type ReactNode } from 'react'
import { Heart, MessageCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import ParticipantIdentity from '@/components/ParticipantIdentity'
import RunPhotoLightbox from '@/components/RunPhotoLightbox'
import { buildWorkoutMedia, type WorkoutMediaPhoto } from '@/lib/buildWorkoutMedia'
import { formatDistanceKm, formatRunTimestampLabel } from '@/lib/format'
import { getStaticMapUrl } from '@/lib/getStaticMapUrl'

type WorkoutFeedCardMediaSlide =
  | {
      type: 'map'
      key: string
      src: string
    }
  | {
      type: 'photo'
      key: string
      src: string
      photoIndex: number
    }

type WorkoutFeedCardProps = {
  runId?: string
  rawTitle: string | null
  city?: string | null
  country?: string | null
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
  commentsCount?: number
  likedByMe: boolean
  isOwnRun?: boolean
  isLikeInFlight?: boolean
  onToggleLike: (runId: string) => void
  onOpenLikes?: () => void
  onCommentClick?: (runId: string) => void
  profileHref?: string | null
  photos?: WorkoutMediaPhoto[]
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

type FeedActionButtonProps = {
  count: number
  icon: ReactNode
  onClick: () => void
  onCountClick?: () => void
  active?: boolean
  disabled?: boolean
  actionDisabled?: boolean
}

function FeedActionButton({
  count,
  icon,
  onClick,
  onCountClick,
  active = false,
  disabled = false,
  actionDisabled = false,
}: FeedActionButtonProps) {
  const isActionBlocked = disabled || actionDisabled

  return (
    <div
      className={`inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-full px-1 py-1 text-sm leading-none ${
        active ? 'text-[var(--like-active)]' : 'text-[var(--text-secondary)]'
      }`}
    >
      <button
        type="button"
        onClick={() => {
          if (isActionBlocked) {
            return
          }

          onClick()
        }}
        disabled={disabled}
        aria-disabled={isActionBlocked ? true : undefined}
        className={`inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-full px-2 transition-colors active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${
          actionDisabled && !disabled ? 'cursor-not-allowed' : ''
        }`}
      >
        <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
          {icon}
        </span>
      </button>
      <button
        type="button"
        onClick={onCountClick ?? onClick}
        disabled={disabled}
        className="inline-flex min-h-9 min-w-0 items-center justify-center rounded-full px-2 text-sm font-semibold transition-colors active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {count}
      </button>
    </div>
  )
}

function WorkoutFeedCard({
  runId = '',
  rawTitle,
  city = null,
  country = null,
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
  commentsCount = 0,
  likedByMe,
  isOwnRun = false,
  isLikeInFlight = false,
  onToggleLike,
  onOpenLikes,
  onCommentClick,
  profileHref = null,
  photos = [],
}: WorkoutFeedCardProps) {
  const router = useRouter()
  const [failedMapPreviewUrl, setFailedMapPreviewUrl] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null)
  const [activeMediaIndex, setActiveMediaIndex] = useState(0)
  const mediaScrollRef = useRef<HTMLDivElement | null>(null)
  const displayTitle = buildDisplayTitle(rawTitle)
  const normalizedDescription = toNullableTrimmedText(description)
  const previewPhoto = photos[0] ?? null
  const additionalPhotosCount = Math.max(0, photos.length - 1)
  const mapPreviewUrl = mapPolyline ? getStaticMapUrl(mapPolyline) : null
  const showMapPreview = Boolean(mapPreviewUrl) && failedMapPreviewUrl !== mapPreviewUrl
  const locationLabel = city && country
    ? `${city}, ${country}`
    : city ?? country ?? null
  const orderedMedia = useMemo(
    () => buildWorkoutMedia({ mapPolyline, photos }),
    [mapPolyline, photos]
  )
  const mediaSlides = useMemo<WorkoutFeedCardMediaSlide[]>(() => {
    const slides: WorkoutFeedCardMediaSlide[] = []

    orderedMedia.forEach((mediaItem) => {
      if (mediaItem.type === 'map') {
        if (!showMapPreview || !mapPreviewUrl) {
          return
        }

        slides.push({
          type: 'map',
          key: `map-${runId || mapPreviewUrl}`,
          src: mapPreviewUrl,
        })
        return
      }

      const photoIndex = photos.findIndex((photo) => photo.id === mediaItem.photo.id)
      if (photoIndex < 0) {
        return
      }

      slides.push({
        type: 'photo',
        key: mediaItem.photo.id,
        src: mediaItem.photo.thumbnail_url ?? mediaItem.photo.public_url,
        photoIndex,
      })
    })

    return slides
  }, [mapPreviewUrl, orderedMedia, photos, runId, showMapPreview])
  const shouldRenderMediaCarousel = mediaSlides.length > 1 && mediaSlides[0]?.type === 'map'
  const totalMediaSlides = mediaSlides.length
  const currentMediaIndex = Math.max(0, Math.min(activeMediaIndex, totalMediaSlides - 1))
  const distanceLabel = typeof distanceKm === 'number' && Number.isFinite(distanceKm) && distanceKm > 0
    ? `${formatDistanceLabel(distanceKm)} км`
    : '—'
  const paceLabel = normalizePaceLabel(pace)
  const paceWithUnit = paceLabel ? `${paceLabel} /км` : '—'
  const movingTimeLabel = movingTime?.trim() || '—'
  const isHeartActive = isOwnRun ? likesCount > 0 : likedByMe

  function handleMediaScroll(event: React.UIEvent<HTMLDivElement>) {
    const container = event.currentTarget

    if (container.clientWidth <= 0) {
      return
    }

    const nextIndex = Math.round(container.scrollLeft / container.clientWidth)
    setActiveMediaIndex(Math.max(0, Math.min(nextIndex, totalMediaSlides - 1)))
  }

  function scrollToMediaSlide(index: number) {
    const container = mediaScrollRef.current

    if (!container) {
      return
    }

    const boundedIndex = Math.max(0, Math.min(index, totalMediaSlides - 1))

    container.scrollTo({
      left: container.clientWidth * boundedIndex,
      behavior: 'smooth',
    })
    setActiveMediaIndex(boundedIndex)
  }

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <ParticipantIdentity
            avatarUrl={avatarUrl}
            displayName={displayName}
            level={level}
            href={profileHref}
            size="sm"
          />
        </div>
        <p className="app-text-secondary min-w-0 text-left text-xs sm:w-auto sm:text-right sm:text-sm">
          {formatRunTimestampLabel(createdAt, externalSource)}
        </p>
      </div>

      <div className="mt-3">
        <p className="app-text-primary break-words whitespace-pre-wrap text-[15px] font-semibold leading-5">
          {displayTitle}
        </p>
        {locationLabel ? (
          <p className="app-text-secondary mt-1 break-words text-sm">
            {locationLabel}
          </p>
        ) : null}
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
              className="app-text-muted mt-0.5 text-xs font-medium"
            >
              {expanded ? 'Скрыть' : 'Читать'}
            </button>
          </div>
        ) : null}
      </div>

      {!showMapPreview ? (
        <div className="app-text-primary mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold leading-tight">
          <span className="font-semibold">{distanceLabel}</span>
          <span className="app-text-secondary">•</span>
          <span className="font-semibold">{paceWithUnit}</span>
          <span className="app-text-secondary">•</span>
          <span className="font-semibold">{movingTimeLabel}</span>
        </div>
      ) : null}

      {shouldRenderMediaCarousel && mapPreviewUrl ? (
        <div className="mt-2" onClick={(event) => event.stopPropagation()}>
          <div
            ref={mediaScrollRef}
            className="overflow-x-auto overflow-y-hidden snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            onScroll={handleMediaScroll}
          >
            <div className="grid grid-flow-col auto-cols-[100%]">
              {mediaSlides.map((slide) => (
                <div key={slide.key} className="snap-start">
                  {slide.type === 'map' ? (
                    <div className="overflow-hidden rounded-2xl bg-[var(--surface-muted)] shadow-sm ring-1 ring-black/5 dark:ring-white/10">
                      <div className="relative aspect-[2.15/1] w-full">
                        <img
                          src={slide.src}
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
                    <button
                      type="button"
                      onClick={() => setSelectedPhotoIndex(slide.photoIndex)}
                      className="block w-full"
                      aria-label={`Открыть фото тренировки ${slide.photoIndex + 1}`}
                    >
                      <div className="overflow-hidden rounded-2xl bg-[var(--surface-muted)] shadow-sm ring-1 ring-black/5 dark:ring-white/10">
                        <div className="relative aspect-[2.15/1] w-full">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={slide.src}
                            alt={`Фото тренировки ${displayTitle}`}
                            className="h-full w-full object-cover"
                            loading="lazy"
                            decoding="async"
                            draggable={false}
                          />
                        </div>
                      </div>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-2 flex items-center justify-center gap-2">
            {Array.from({ length: totalMediaSlides }, (_, index) => (
              <button
                key={`media-dot-${index}`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  scrollToMediaSlide(index)
                }}
                className={`h-1.5 rounded-full transition-all ${
                  index === currentMediaIndex ? 'w-4 bg-[var(--text-primary)]' : 'w-1.5 bg-black/20 dark:bg-white/25'
                }`}
                aria-label={`Открыть слайд ${index + 1}`}
              />
            ))}
          </div>
        </div>
      ) : showMapPreview && mapPreviewUrl ? (
        <div className="mt-2 overflow-hidden rounded-2xl bg-[var(--surface-muted)] shadow-sm ring-1 ring-black/5 dark:ring-white/10">
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
      ) : previewPhoto ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setSelectedPhotoIndex(0)
          }}
          className="mt-2 block overflow-hidden rounded-2xl bg-[var(--surface-muted)] text-left shadow-sm ring-1 ring-black/5 dark:ring-white/10"
          aria-label="Открыть фото тренировки"
        >
          <div className="relative aspect-[2.15/1] w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewPhoto.thumbnail_url ?? previewPhoto.public_url}
              alt={`Фото тренировки ${displayTitle}`}
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
              draggable={false}
            />
            {additionalPhotosCount > 0 ? (
              <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                +{additionalPhotosCount}
              </div>
            ) : null}
          </div>
        </button>
      ) : null}

      <div className="mt-4 border-t border-black/5 pt-3.5 dark:border-white/10">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-4">
            <FeedActionButton
              count={likesCount}
              active={isHeartActive}
              disabled={!runId}
              actionDisabled={isOwnRun || isLikeInFlight}
              onClick={() => onToggleLike(runId)}
              onCountClick={() => onOpenLikes?.()}
              icon={
                <Heart className="h-4 w-4" strokeWidth={1.9} fill={isHeartActive ? 'currentColor' : 'none'} />
              }
            />
            <FeedActionButton
              count={commentsCount}
              disabled={!runId}
              onClick={() => onCommentClick?.(runId)}
              icon={<MessageCircle className="h-4 w-4" strokeWidth={1.9} />}
            />
          </div>
          <p className="app-text-secondary min-w-0 flex-1 overflow-hidden text-right text-xs font-medium [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:1]">
            ⚡ +{xp} XP
          </p>
        </div>
      </div>

      <RunPhotoLightbox
        key={selectedPhotoIndex ?? 'closed'}
        photos={photos}
        selectedIndex={selectedPhotoIndex}
        onClose={() => setSelectedPhotoIndex(null)}
      />
    </div>
  )
}

export default memo(WorkoutFeedCard)
