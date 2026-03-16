'use client'

import { useCallback, useEffect, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'

type AvatarCropModalProps = {
  imageSrc: string
  loading?: boolean
  onCancel: () => void
  onConfirm: (blob: Blob) => Promise<void> | void
}

const OUTPUT_SIZE = 512
const OUTPUT_TYPE = 'image/jpeg'
const OUTPUT_QUALITY = 0.8

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Не удалось загрузить изображение'))
    image.src = src
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }

      reject(new Error('Не удалось сохранить аватар'))
    }, type, quality)
  })
}

async function normalizeImageSource(imageSrc: string) {
  if (typeof window === 'undefined' || typeof createImageBitmap !== 'function') {
    return imageSrc
  }

  const response = await fetch(imageSrc)
  const sourceBlob = await response.blob()
  const bitmap = await createImageBitmap(sourceBlob, { imageOrientation: 'from-image' })

  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('Не удалось подготовить аватар')
    }

    canvas.width = bitmap.width
    canvas.height = bitmap.height
    context.drawImage(bitmap, 0, 0)

    const normalizedBlob = await canvasToBlob(canvas, OUTPUT_TYPE, 0.92)
    return URL.createObjectURL(normalizedBlob)
  } finally {
    bitmap.close()
  }
}

async function createCroppedAvatar(imageSrc: string, croppedAreaPixels: Area) {
  const image = await loadImage(imageSrc)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Не удалось подготовить аватар')
  }

  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE

  context.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.save()
  context.beginPath()
  context.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2)
  context.closePath()
  context.clip()
  context.drawImage(
    image,
    croppedAreaPixels.x,
    croppedAreaPixels.y,
    croppedAreaPixels.width,
    croppedAreaPixels.height,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE
  )
  context.restore()

  return canvasToBlob(canvas, OUTPUT_TYPE, OUTPUT_QUALITY)
}

export default function AvatarCropModal({
  imageSrc,
  loading = false,
  onCancel,
  onConfirm,
}: AvatarCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [normalizedImageSrc, setNormalizedImageSrc] = useState<string | null>(null)
  const [preparingImage, setPreparingImage] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let isActive = true
    let normalizedObjectUrl: string | null = null

    setPreparingImage(true)
    setNormalizedImageSrc(null)
    setCroppedAreaPixels(null)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setError('')

    void (async () => {
      try {
        const preparedImageSrc = await normalizeImageSource(imageSrc)

        if (!isActive) {
          if (preparedImageSrc !== imageSrc) {
            URL.revokeObjectURL(preparedImageSrc)
          }
          return
        }

        if (preparedImageSrc !== imageSrc) {
          normalizedObjectUrl = preparedImageSrc
        }

        setNormalizedImageSrc(preparedImageSrc)
      } catch {
        if (!isActive) {
          return
        }

        setNormalizedImageSrc(imageSrc)
      } finally {
        if (isActive) {
          setPreparingImage(false)
        }
      }
    })()

    return () => {
      isActive = false

      if (normalizedObjectUrl) {
        URL.revokeObjectURL(normalizedObjectUrl)
      }
    }
  }, [imageSrc])

  const handleCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setError('')
    setCroppedAreaPixels(croppedPixels)
  }, [])

  async function handleConfirm() {
    if (!croppedAreaPixels || loading || preparingImage || !normalizedImageSrc) return

    setError('')

    try {
      const blob = await createCroppedAvatar(normalizedImageSrc, croppedAreaPixels)
      await onConfirm(blob)
    } catch {
      setError('Не удалось подготовить аватар')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black text-white">
      <div className="flex h-full flex-col">
        <div className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Обрезать аватар</h2>
              <p className="mt-1 text-sm text-white/70">Подвинь фото и выбери масштаб.</p>
            </div>
          </div>
        </div>

        <div className="relative mt-4 flex-1">
          {normalizedImageSrc ? (
            <Cropper
              image={normalizedImageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              objectFit="cover"
              onCropChange={setCrop}
              onCropComplete={handleCropComplete}
              onZoomChange={setZoom}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-sm text-white/70">
              Подготавливаем фото...
            </div>
          )}
        </div>

        <div className="bg-black/90 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          {error ? <p className="mb-3 text-sm text-red-300">{error}</p> : null}
          <label htmlFor="avatar-zoom" className="block text-sm text-white/80">
            Масштаб
          </label>
          <input
            id="avatar-zoom"
            type="range"
            min="1"
            max="3"
            step="0.1"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            disabled={loading}
            className="mt-3 w-full"
          />

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="flex-1 rounded-xl border border-white/20 bg-white/10 py-3 text-sm font-medium text-white"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={loading || preparingImage || !croppedAreaPixels || !normalizedImageSrc}
              className="flex-1 rounded-xl bg-white py-3 text-sm font-medium text-black disabled:opacity-60"
            >
              {loading ? 'Сохраняем...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
