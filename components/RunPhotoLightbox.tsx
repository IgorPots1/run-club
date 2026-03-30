'use client'

import { useEffect } from 'react'
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
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, selectedIndex])

  if (selectedIndex == null || selectedIndex < 0 || selectedIndex >= photos.length) {
    return null
  }

  const selectedPhoto = photos[selectedIndex]
  const selectedPhotoNumber = selectedIndex + 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр фото тренировки"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors active:scale-[0.98]"
        aria-label="Закрыть фото"
      >
        <X className="h-5 w-5" strokeWidth={2} />
      </button>

      {photos.length > 1 ? (
        <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-black/45 px-3 py-1.5 text-sm font-medium text-white backdrop-blur-sm">
          {selectedPhotoNumber} / {photos.length}
        </div>
      ) : null}

      <div
        className="flex max-h-full w-full items-center justify-center"
        onClick={(event) => event.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={selectedPhoto.public_url}
          alt={getAlt ? getAlt(selectedIndex) : `Фото тренировки ${selectedPhotoNumber}`}
          className="max-h-[calc(100vh-5rem)] w-auto max-w-full rounded-2xl object-contain shadow-2xl"
          decoding="async"
          draggable={false}
        />
      </div>
    </div>
  )
}
