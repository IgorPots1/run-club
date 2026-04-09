'use client'

import { memo, useCallback, useMemo, useRef, useState, type ReactNode, type SyntheticEvent, type UIEvent } from 'react'
import RunRouteMapPreview from '@/components/RunRouteMapPreview'
import { buildWorkoutMedia, type WorkoutMediaPhoto } from '@/lib/buildWorkoutMedia'

const DEFAULT_PHOTO_OBJECT_POSITION = '50% 50%'
const PORTRAIT_PHOTO_OBJECT_POSITION = '50% 30%'
const PORTRAIT_HEIGHT_OVER_WIDTH_THRESHOLD = 1.1
const SLIDE_SURFACE_CLASS_NAME =
  'overflow-hidden rounded-2xl bg-[var(--surface-muted)] shadow-sm ring-1 ring-black/5 dark:ring-white/10'
const SLIDE_VIEWPORT_CLASS_NAME = 'relative aspect-[2.15/1] w-full'
const MAP_SLIDE_OVERLAY_CLASS_NAME =
  'pointer-events-none absolute inset-x-0 bottom-0 h-[34%] bg-gradient-to-t from-black/10 via-black/[0.035] to-transparent dark:from-black/16 dark:via-black/[0.055]'

type WorkoutMediaCarouselProps = {
  mapPolyline?: string | null
  photos?: WorkoutMediaPhoto[]
  mapPreviewUrl?: string | null
  mapAlt?: string
  photoAlt?: (photoIndex: number) => string
  onOpenPhoto?: (photoIndex: number) => void
  mapOverlay?: ReactNode
  className?: string
  allowSwipeMode?: 'always' | 'map-first'
  showDots?: boolean
  showAdditionalPhotoCountBadge?: boolean
  enableMapFallbackPreview?: boolean
}

type WorkoutMediaSlide =
  | {
      type: 'map'
      key: string
      mapPolyline: string
      usesStaticPreview: boolean
    }
  | {
      type: 'photo'
      key: string
      src: string
      photoIndex: number
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

type WorkoutMediaPhotoImageProps = {
  src: string
  alt: string
}

const WorkoutMediaPhotoImage = memo(function WorkoutMediaPhotoImage({
  src,
  alt,
}: WorkoutMediaPhotoImageProps) {
  const [objectPosition, setObjectPosition] = useState(DEFAULT_PHOTO_OBJECT_POSITION)

  const handleLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
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

export default function WorkoutMediaCarousel({
  mapPolyline = null,
  photos = [],
  mapPreviewUrl = null,
  mapAlt = 'Маршрут тренировки',
  photoAlt = (photoIndex) => `Фото тренировки ${photoIndex + 1}`,
  onOpenPhoto,
  mapOverlay = null,
  className = '',
  allowSwipeMode = 'always',
  showDots = true,
  showAdditionalPhotoCountBadge = false,
  enableMapFallbackPreview = false,
}: WorkoutMediaCarouselProps) {
  const [failedMapPreviewUrl, setFailedMapPreviewUrl] = useState<string | null>(null)
  const [activeMediaIndex, setActiveMediaIndex] = useState(0)
  const mediaScrollRef = useRef<HTMLDivElement | null>(null)
  const orderedMedia = useMemo(
    () => buildWorkoutMedia({ mapPolyline, photos }),
    [mapPolyline, photos]
  )
  const canUseStaticMapPreview = Boolean(mapPreviewUrl) && failedMapPreviewUrl !== mapPreviewUrl
  const mediaSlides = useMemo<WorkoutMediaSlide[]>(() => (
    orderedMedia.flatMap((mediaItem): WorkoutMediaSlide[] => {
      if (mediaItem.type === 'map') {
        if (canUseStaticMapPreview && mapPreviewUrl) {
          return [{
            type: 'map' as const,
            key: `map-static-${mapPreviewUrl}`,
            mapPolyline: mediaItem.mapPolyline,
            usesStaticPreview: true,
          }]
        }

        if (!enableMapFallbackPreview) {
          return []
        }

        return [{
          type: 'map' as const,
          key: `map-fallback-${mediaItem.mapPolyline}`,
          mapPolyline: mediaItem.mapPolyline,
          usesStaticPreview: false,
        }]
      }

      const photoIndex = photos.findIndex((photo) => photo.id === mediaItem.photo.id)
      if (photoIndex < 0) {
        return []
      }

      return [{
        type: 'photo' as const,
        key: mediaItem.photo.id,
        src: mediaItem.photo.thumbnail_url ?? mediaItem.photo.public_url,
        photoIndex,
      }]
    })
  ), [canUseStaticMapPreview, enableMapFallbackPreview, mapPreviewUrl, orderedMedia, photos])

  const totalMediaSlides = mediaSlides.length
  const shouldRenderCarousel = totalMediaSlides > 1 && (
    allowSwipeMode === 'always' || mediaSlides[0]?.type === 'map'
  )
  const currentMediaIndex = Math.max(0, Math.min(activeMediaIndex, totalMediaSlides - 1))
  const additionalPhotosCount = Math.max(0, photos.length - 1)
  const rootClassName = className.trim()

  function handleMediaScroll(event: UIEvent<HTMLDivElement>) {
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

  function renderMapSlide(slide: Extract<WorkoutMediaSlide, { type: 'map' }>) {
    return (
      <div className={SLIDE_SURFACE_CLASS_NAME}>
        <div className={SLIDE_VIEWPORT_CLASS_NAME}>
          {slide.usesStaticPreview && mapPreviewUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mapPreviewUrl}
                alt={mapAlt}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
                draggable={false}
                onError={() => setFailedMapPreviewUrl(mapPreviewUrl)}
              />
            </>
          ) : (
            <RunRouteMapPreview polyline={slide.mapPolyline} className="h-full w-full" />
          )}
          <div aria-hidden="true" className={MAP_SLIDE_OVERLAY_CLASS_NAME} />
          {mapOverlay}
        </div>
      </div>
    )
  }

  function renderPhotoSlide(slide: Extract<WorkoutMediaSlide, { type: 'photo' }>, showBadge: boolean) {
    const photoContent = (
      <div className={SLIDE_SURFACE_CLASS_NAME}>
        <div className={SLIDE_VIEWPORT_CLASS_NAME}>
          <WorkoutMediaPhotoImage
            src={slide.src}
            alt={photoAlt(slide.photoIndex)}
          />
          {showBadge ? (
            <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
              +{additionalPhotosCount}
            </div>
          ) : null}
        </div>
      </div>
    )

    if (!onOpenPhoto) {
      return photoContent
    }

    return (
      <button
        type="button"
        onClick={() => onOpenPhoto(slide.photoIndex)}
        className="block w-full"
        aria-label={`Открыть фото тренировки ${slide.photoIndex + 1}`}
      >
        {photoContent}
      </button>
    )
  }

  if (totalMediaSlides === 0) {
    return null
  }

  if (!shouldRenderCarousel) {
    const primarySlide = mediaSlides[0]
    const content = primarySlide.type === 'map'
      ? renderMapSlide(primarySlide)
      : renderPhotoSlide(primarySlide, showAdditionalPhotoCountBadge && additionalPhotosCount > 0)

    return rootClassName ? <div className={rootClassName}>{content}</div> : content
  }

  const carouselContent = (
    <>
      <div
        ref={mediaScrollRef}
        className="overflow-x-auto overflow-y-hidden snap-x snap-mandatory overscroll-x-contain [scrollbar-width:none] [-ms-overflow-style:none] [-webkit-overflow-scrolling:touch] touch-pan-x [&::-webkit-scrollbar]:hidden"
        onScroll={handleMediaScroll}
      >
        <div className="grid grid-flow-col auto-cols-[100%]">
          {mediaSlides.map((slide) => (
            <div key={slide.key} className="snap-start">
              {slide.type === 'map'
                ? renderMapSlide(slide)
                : renderPhotoSlide(slide, false)}
            </div>
          ))}
        </div>
      </div>

      {showDots ? (
        <div className="mt-2 flex items-center justify-center gap-2">
          {Array.from({ length: totalMediaSlides }, (_, index) => (
            <button
              key={`media-dot-${index}`}
              type="button"
              onClick={() => scrollToMediaSlide(index)}
              className={`h-1.5 rounded-full transition-all ${
                index === currentMediaIndex ? 'w-4 bg-[var(--text-primary)]' : 'w-1.5 bg-black/20 dark:bg-white/25'
              }`}
              aria-label={`Открыть слайд ${index + 1}`}
            />
          ))}
        </div>
      ) : null}
    </>
  )

  return rootClassName ? <div className={rootClassName}>{carouselContent}</div> : carouselContent
}
