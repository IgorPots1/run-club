'use client'

import type { TouchEvent as ReactTouchEvent } from 'react'
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

type DragGestureAxis = 'undetermined' | 'horizontal' | 'vertical'

const DRAG_CLOSE_THRESHOLD_PX = 140
const DRAG_DIRECTION_THRESHOLD_PX = 10

export default function RunPhotoLightbox({
  photos,
  selectedIndex,
  onClose,
  getAlt,
}: RunPhotoLightboxProps) {
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, Math.min(selectedIndex ?? 0, photos.length - 1))
  )
  const [dragOffsetY, setDragOffsetY] = useState(0)
  const [isVerticalDragging, setIsVerticalDragging] = useState(false)
  const activeIndexRef = useRef(activeIndex)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const dragGestureRef = useRef({
    startX: 0,
    startY: 0,
    axis: 'undetermined' as DragGestureAxis,
    isActive: false,
  })

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

  function handleTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1) {
      return
    }

    const touch = event.touches[0]
    dragGestureRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      axis: 'undetermined',
      isActive: true,
    }
    setIsVerticalDragging(false)
  }

  function handleTouchMove(event: ReactTouchEvent<HTMLDivElement>) {
    if (!dragGestureRef.current.isActive || event.touches.length !== 1) {
      return
    }

    const touch = event.touches[0]
    const deltaX = touch.clientX - dragGestureRef.current.startX
    const deltaY = touch.clientY - dragGestureRef.current.startY
    const absoluteDeltaX = Math.abs(deltaX)
    const absoluteDeltaY = Math.abs(deltaY)

    if (dragGestureRef.current.axis === 'undetermined') {
      if (
        absoluteDeltaX < DRAG_DIRECTION_THRESHOLD_PX &&
        absoluteDeltaY < DRAG_DIRECTION_THRESHOLD_PX
      ) {
        return
      }

      dragGestureRef.current.axis =
        deltaY > 0 && absoluteDeltaY > absoluteDeltaX ? 'vertical' : 'horizontal'
    }

    if (dragGestureRef.current.axis !== 'vertical') {
      return
    }

    event.preventDefault()

    const nextDragOffset = Math.max(0, deltaY)

    setIsVerticalDragging(true)
    setDragOffsetY(nextDragOffset)
  }

  function resetVerticalDrag() {
    dragGestureRef.current = {
      startX: 0,
      startY: 0,
      axis: 'undetermined',
      isActive: false,
    }
    setIsVerticalDragging(false)
  }

  function handleTouchEnd() {
    if (!dragGestureRef.current.isActive) {
      return
    }

    const shouldClose = dragGestureRef.current.axis === 'vertical' && dragOffsetY >= DRAG_CLOSE_THRESHOLD_PX

    resetVerticalDrag()

    if (shouldClose) {
      onClose()
      return
    }

    setDragOffsetY(0)
  }

  function handleTouchCancel() {
    if (!dragGestureRef.current.isActive) {
      return
    }

    resetVerticalDrag()
    setDragOffsetY(0)
  }

  if (selectedIndex == null || selectedIndex < 0 || selectedIndex >= photos.length) {
    return null
  }

  const activePhotoNumber = activeIndex + 1
  const canGoToPreviousPhoto = activeIndex > 0
  const canGoToNextPhoto = activeIndex < photos.length - 1
  const backdropOpacity = Math.max(0.55, 0.95 - Math.min(dragOffsetY / 320, 0.4))
  const viewerTransform = dragOffsetY > 0 ? `translateY(${dragOffsetY}px)` : undefined

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Просмотр фото тренировки">
      <button
        type="button"
        className="absolute inset-0 bg-black transition-opacity duration-200"
        aria-label="Закрыть просмотр фото"
        onClick={onClose}
        style={{ opacity: backdropOpacity }}
      />

      <div
        className={`relative z-10 flex h-full w-full items-center justify-center ${
          isVerticalDragging ? '' : 'transition-transform duration-200 ease-out'
        }`}
        style={{ transform: viewerTransform }}
      >
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
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
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
