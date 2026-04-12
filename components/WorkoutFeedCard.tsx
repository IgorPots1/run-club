'use client'

import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { Heart, MapPin, MessageCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import FeedActionButton from '@/components/FeedActionButton'
import ParticipantIdentity from '@/components/ParticipantIdentity'
import RunPhotoLightbox from '@/components/RunPhotoLightbox'
import { buildWorkoutMedia, type WorkoutMediaPhoto } from '@/lib/buildWorkoutMedia'
import type { FeedRunInsight } from '@/lib/dashboard'
import { formatDistanceKm, formatRunTimestampLabel } from '@/lib/format'
import { getStaticMapUrl } from '@/lib/getStaticMapUrl'
import type { RunXpBreakdownRow } from '@/lib/run-xp-presentation'

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
  shoeId?: string | null
  city?: string | null
  country?: string | null
  description?: string | null
  externalSource?: string | null
  distanceKm?: number | null
  pace?: string | number | null
  movingTime?: string | null
  mapPolyline?: string | null
  xp: number
  xpBreakdownRows?: RunXpBreakdownRow[]
  createdAt: string
  displayName: string
  avatarUrl: string | null
  level: number
  likesCount: number
  commentsCount?: number
  likedByMe: boolean
  insight?: FeedRunInsight | null
  isOwnRun?: boolean
  isLikeInFlight?: boolean
  onToggleLike: (runId: string) => void
  onOpenLikes?: () => void
  onOpenLikesPreview?: () => void
  onCommentClick?: (runId: string) => void
  onNavigateToRun?: (runId: string) => void
  profileHref?: string | null
  onNavigateToProfile?: (href: string) => void
  photos?: WorkoutMediaPhoto[]
  onOpenXpBreakdown?: () => void
}

const DEFAULT_PHOTO_OBJECT_POSITION = '50% 50%'
const PORTRAIT_PHOTO_OBJECT_POSITION = '50% 30%'
const PORTRAIT_HEIGHT_OVER_WIDTH_THRESHOLD = 1.1

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

function getPhotoObjectPosition(naturalWidth: number, naturalHeight: number) {
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return DEFAULT_PHOTO_OBJECT_POSITION
  }

  const heightOverWidth = naturalHeight / naturalWidth
  return heightOverWidth > PORTRAIT_HEIGHT_OVER_WIDTH_THRESHOLD
    ? PORTRAIT_PHOTO_OBJECT_POSITION
    : DEFAULT_PHOTO_OBJECT_POSITION
}

type WorkoutFeedPhotoPreviewImageProps = {
  src: string
  alt: string
}

const WorkoutFeedPhotoPreviewImage = memo(function WorkoutFeedPhotoPreviewImage({
  src,
  alt,
}: WorkoutFeedPhotoPreviewImageProps) {
  const [objectPosition, setObjectPosition] = useState(DEFAULT_PHOTO_OBJECT_POSITION)

  const handleLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const nextObjectPosition = getPhotoObjectPosition(
      event.currentTarget.naturalWidth,
      event.currentTarget.naturalHeight
    )

    setObjectPosition((currentValue) => (
      currentValue === nextObjectPosition ? currentValue : nextObjectPosition
    ))
  }, [])

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="h-full w-full object-cover"
      style={{ objectPosition }}
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={handleLoad}
    />
  )
})

function WorkoutFeedCard({
  runId = '',
  rawTitle,
  shoeId = null,
  city = null,
  country = null,
  description = null,
  externalSource = null,
  distanceKm,
  pace,
  movingTime = null,
  mapPolyline = null,
  xp,
  xpBreakdownRows = [],
  createdAt,
  displayName,
  avatarUrl,
  level,
  likesCount,
  commentsCount = 0,
  likedByMe,
  insight = null,
  isOwnRun = false,
  isLikeInFlight = false,
  onToggleLike,
  onOpenLikes,
  onOpenLikesPreview,
  onCommentClick,
  onNavigateToRun,
  profileHref = null,
  onNavigateToProfile,
  photos = [],
  onOpenXpBreakdown,
}: WorkoutFeedCardProps) {
  const router = useRouter()
  const [failedMapPreviewUrl, setFailedMapPreviewUrl] = useState<string | null>(null)
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null)
  const [activeMediaIndex, setActiveMediaIndex] = useState(0)
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const mediaScrollRef = useRef<HTMLDivElement | null>(null)
  const displayTitle = buildDisplayTitle(rawTitle)
  const trimmedDescription = description?.trim() || ''
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
    : ''
  const paceLabel = normalizePaceLabel(pace)
  const paceWithUnit = paceLabel ? `${paceLabel} /км` : ''
  const movingTimeLabel = movingTime?.trim() || ''
  const hasMediaContent = shouldRenderMediaCarousel || (showMapPreview && Boolean(mapPreviewUrl)) || Boolean(previewPhoto)
  const isNoMediaWorkout = !hasMediaContent
  const shouldRenderInlineMetrics = !hasMediaContent && Boolean(distanceLabel || paceWithUnit || movingTimeLabel)
  const isHeartActive = isOwnRun ? likesCount > 0 : likedByMe
  const hasXpBreakdown = xpBreakdownRows.length > 0
  void shoeId

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

  function openRunDetail() {
    if (!runId) {
      return
    }

    if (onNavigateToRun) {
      onNavigateToRun(runId)
      return
    }

    router.push(`/runs/${runId}`)
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
        openRunDetail()
      }}
      onKeyDown={(event) => {
        if (!runId) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        const target = event.target as HTMLElement
        if (target.closest('a,button')) return
        event.preventDefault()
        openRunDetail()
      }}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <ParticipantIdentity
            avatarUrl={avatarUrl}
            displayName={displayName}
            level={level}
            href={profileHref}
            onNavigate={onNavigateToProfile}
            size="sm"
            nameWeightClass="font-medium"
            nameSizeClass="text-[15px]"
            levelClassName="app-text-muted break-words text-[13px]"
          />
        </div>
        <p className="app-text-secondary ml-auto shrink-0 pt-0.5 text-xs whitespace-nowrap">
          {formatRunTimestampLabel(createdAt, externalSource)}
        </p>
      </div>

      <div className="mt-3">
        <p className="app-text-primary text-[22px] font-bold leading-7 break-words whitespace-pre-wrap">
          {displayTitle}
        </p>
        {trimmedDescription ? (
          <div className="mt-1.5">
            <p
              className={`break-words whitespace-pre-wrap text-sm leading-5 app-text-muted ${
                descriptionExpanded ? '' : 'line-clamp-2'
              }`}
            >
              {trimmedDescription}
            </p>
            {trimmedDescription.length > 90 ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  setDescriptionExpanded((currentValue) => !currentValue)
                }}
                className="app-text-muted mt-0.5 text-xs font-medium"
              >
                {descriptionExpanded ? 'Скрыть' : 'Читать'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {insight || locationLabel ? (
        <div className="mt-2 space-y-1.5">
          {insight ? (
            <div>
              <span className="app-text-secondary inline-flex max-w-full items-center rounded-full border border-black/[0.07] bg-black/[0.03] px-2.5 py-1 text-[11px] font-medium leading-none dark:border-white/[0.09] dark:bg-white/[0.04]">
                <span className="truncate">{insight.label}</span>
              </span>
            </div>
          ) : null}
          {locationLabel ? (
            <div className="app-text-muted inline-flex max-w-full items-start gap-1.5 text-xs">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
              <p className="min-w-0 break-words leading-4">
                {locationLabel}
              </p>
            </div>
          ) : null}
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
                          className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-t from-black/72 via-black/24 to-transparent"
                        />
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-3.5 pt-8">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)] sm:text-sm">
                            <span>{distanceLabel}</span>
                            <span className="text-white/80">•</span>
                            <span>{paceWithUnit}</span>
                            <span className="text-white/80">•</span>
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
                          <WorkoutFeedPhotoPreviewImage
                            src={slide.src}
                            alt={`Фото тренировки ${displayTitle}`}
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
              className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-t from-black/72 via-black/24 to-transparent"
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-3.5 pt-8">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)] sm:text-sm">
                <span>{distanceLabel}</span>
                <span className="text-white/80">•</span>
                <span>{paceWithUnit}</span>
                <span className="text-white/80">•</span>
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
            <WorkoutFeedPhotoPreviewImage
              src={previewPhoto.thumbnail_url ?? previewPhoto.public_url}
              alt={`Фото тренировки ${displayTitle}`}
            />
            {additionalPhotosCount > 0 ? (
              <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                +{additionalPhotosCount}
              </div>
            ) : null}
          </div>
        </button>
      ) : null}
      {shouldRenderInlineMetrics ? (
        <div
          className={`mt-2 flex flex-wrap items-center gap-1.5 ${
            isNoMediaWorkout
              ? 'app-text-primary text-[18px] font-bold'
              : 'app-text-secondary text-[16px] font-medium'
          }`}
        >
          {distanceLabel ? <span>{distanceLabel}</span> : null}
          {distanceLabel && paceWithUnit ? (
            <span aria-hidden="true" className={isNoMediaWorkout ? 'app-text-secondary' : 'app-text-muted'}>•</span>
          ) : null}
          {paceWithUnit ? <span>{paceWithUnit}</span> : null}
          {(distanceLabel || paceWithUnit) && movingTimeLabel ? (
            <span aria-hidden="true" className={isNoMediaWorkout ? 'app-text-secondary' : 'app-text-muted'}>•</span>
          ) : null}
          {movingTimeLabel ? <span>{movingTimeLabel}</span> : null}
        </div>
      ) : null}

      <div className="mt-4 border-t border-black/5 pt-3.5 dark:border-white/10">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 shrink items-center gap-1 sm:gap-3">
            <FeedActionButton
              count={likesCount}
              active={isHeartActive}
              disabled={!runId}
              actionDisabled={isOwnRun || isLikeInFlight}
              onClick={() => onToggleLike(runId)}
              onCountClick={() => onOpenLikes?.()}
              onInteractionStart={() => {
                if (likesCount > 0) {
                  onOpenLikesPreview?.()
                }
              }}
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
          <button
            type="button"
            disabled={!hasXpBreakdown}
            onClick={(event) => {
              event.stopPropagation()
              onOpenXpBreakdown?.()
            }}
            className="app-text-muted ml-3 inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-medium sm:text-xs disabled:opacity-100"
            aria-label={hasXpBreakdown ? 'Показать разбивку XP' : 'XP'}
          >
            <span aria-hidden="true" className="text-[10px] leading-none opacity-80">⚡</span>
            <span>+{xp} XP</span>
          </button>
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
