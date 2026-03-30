'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

export type RunPhotoLightboxPhoto = {
  public_url: string
}

type RunPhotoLightboxProps = {
  photos: RunPhotoLightboxPhoto[]
  selectedIndex: number | null
  onClose: () => void
  getAlt?: (index: number) => string
}

export default function RunPhotoLightbox({
  photos,
  selectedIndex,
  onClose,
  getAlt,
}: RunPhotoLightboxProps) {
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, Math.min(selectedIndex ?? 0, photos.length - 1))
  )
  const activeIndexRef = useRef(activeIndex)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  const scrollToPhoto = useCallback(
    (index: number, behavior: ScrollBehavior) => {
      const scrollContainer = scrollContainerRef.current

      if (!scrollContainer) {
        return
      }

      const boundedIndex = Math.max(0, Math.min(index, photos.length - 1))

      scrollContainer.scrollTo({
        left: scrollContainer.clientWidth * boundedIndex,
        behavior,
      })
    },
    [photos.length]
  )

  const navigateToIndex = useCallback(
    (nextIndex: number) => {
      const boundedIndex = Math.max(0, Math.min(nextIndex, photos.length - 1))

      if (boundedIndex === activeIndexRef.current) {
        return
      }

      setActiveIndex(boundedIndex)
      scrollToPhoto(boundedIndex, 'smooth')
    },
    [photos.length, scrollToPhoto]
  )

  useEffect(() => {
    if (selectedIndex == null) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [selectedIndex])

  useEffect(() => {
    if (selectedIndex == null) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }

      if (event.key === 'ArrowLeft') {
        navigateToIndex(activeIndexRef.current - 1)
        return
      }

      if (event.key === 'ArrowRight') {
        navigateToIndex(activeIndexRef.current + 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [navigateToIndex, onClose, selectedIndex])

  useEffect(() => {
    if (selectedIndex == null) {
      return
    }

    const boundedIndex = Math.max(0, Math.min(selectedIndex, photos.length - 1))

    const animationFrameId = window.requestAnimationFrame(() => {
      scrollToPhoto(boundedIndex, 'auto')
    })

    const handleResize = () => {
      scrollToPhoto(activeIndexRef.current, 'auto')
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', handleResize)
    }
  }, [photos.length, scrollToPhoto, selectedIndex])

  useEffect(() => {
    activeIndexRef.current = activeIndex
  }, [activeIndex])

  function handleScroll() {
    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer || scrollContainer.clientWidth <= 0) {
      return
    }

    const nextIndex = Math.round(scrollContainer.scrollLeft / scrollContainer.clientWidth)
    const boundedIndex = Math.max(0, Math.min(nextIndex, photos.length - 1))

    setActiveIndex((currentIndex) => (currentIndex === boundedIndex ? currentIndex : boundedIndex))
  }

  if (selectedIndex == null || selectedIndex < 0 || selectedIndex >= photos.length) {
    return null
  }

  const activePhotoNumber = activeIndex + 1
  const canGoToPreviousPhoto = activeIndex > 0
  const canGoToNextPhoto = activeIndex < photos.length - 1

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Просмотр фото тренировки">
      <button
        type="button"
        className="absolute inset-0 bg-black/95"
        aria-label="Закрыть просмотр фото"
        onClick={onClose}
      />

      <div className="relative z-10 flex h-full w-full items-center justify-center">
        <div className="pointer-events-none absolute left-4 top-4 z-20 rounded-full bg-black/45 px-3 py-1.5 text-sm font-medium text-white backdrop-blur-sm">
          {activePhotoNumber} / {photos.length}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors active:scale-[0.98]"
          aria-label="Закрыть фото"
        >
          <X className="h-5 w-5" strokeWidth={2} />
        </button>

        <button
          type="button"
          onClick={() => navigateToIndex(activeIndexRef.current - 1)}
          aria-label="Предыдущее фото"
          aria-disabled={!canGoToPreviousPhoto}
          className="absolute inset-y-0 left-0 z-10 w-[24vw] min-w-16 max-w-24 bg-transparent transition-colors active:bg-white/5"
        />

        <button
          type="button"
          onClick={() => navigateToIndex(activeIndexRef.current + 1)}
          aria-label="Следующее фото"
          aria-disabled={!canGoToNextPhoto}
          className="absolute inset-y-0 right-0 z-10 w-[24vw] min-w-16 max-w-24 bg-transparent transition-colors active:bg-white/5"
        />

        <div
          ref={scrollContainerRef}
          className="h-full w-full overflow-x-auto overflow-y-hidden overscroll-x-contain overscroll-y-none snap-x snap-mandatory touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          onScroll={handleScroll}
        >
          <div className="grid h-full grid-flow-col auto-cols-[100%]">
            {photos.map((photo, index) => (
              <div key={`${photo.public_url}-${index}`} className="flex h-full w-full snap-center items-center justify-center px-4 py-20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.public_url}
                  alt={getAlt ? getAlt(index) : `Фото тренировки ${index + 1}`}
                  className="block max-h-full max-w-full rounded-2xl object-contain shadow-2xl"
                  decoding="async"
                  draggable={false}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
