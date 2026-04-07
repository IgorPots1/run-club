'use client'

import { formatDistanceKm } from '@/lib/format'

type ShareRaceResultCardInput = {
  raceName: string
  resultTime: string | null
  distanceLabel: string | null
  isPersonalRecord: boolean
  displayName: string
  avatarUrl: string | null
}

const CARD_WIDTH = 1080
const CARD_HEIGHT = 1350
const OUTPUT_TYPE = 'image/png'

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }

      reject(new Error('Не удалось подготовить изображение'))
    }, type, quality)
  })
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Не удалось загрузить изображение'))
    image.src = src
  })
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.trim().split(/\s+/).filter(Boolean)

  if (words.length === 0) {
    return ['']
  }

  const lines: string[] = []
  let currentLine = words[0] ?? ''

  for (const word of words.slice(1)) {
    const nextLine = `${currentLine} ${word}`
    if (context.measureText(nextLine).width <= maxWidth) {
      currentLine = nextLine
      continue
    }

    lines.push(currentLine)
    currentLine = word
  }

  lines.push(currentLine)
  return lines
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.lineTo(x + width - radius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + radius)
  context.lineTo(x + width, y + height - radius)
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  context.lineTo(x + radius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - radius)
  context.lineTo(x, y + radius)
  context.quadraticCurveTo(x, y, x + radius, y)
  context.closePath()
}

function formatInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  if (parts.length === 0) {
    return 'RC'
  }

  return parts.map((part) => part.charAt(0).toUpperCase()).join('')
}

function sanitizeFilePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function getRaceDistanceLabel(distanceMeters: number | null | undefined) {
  if (!Number.isFinite(distanceMeters) || (distanceMeters ?? 0) <= 0) {
    return null
  }

  const distanceKm = Number(distanceMeters ?? 0) / 1000
  return `${formatDistanceKm(distanceKm)} км`
}

export async function renderRaceResultShareCard(input: ShareRaceResultCardInput) {
  if (typeof document === 'undefined') {
    throw new Error('share_unavailable')
  }

  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('share_context_unavailable')
  }

  context.fillStyle = '#f5f7fb'
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  const gradient = context.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT)
  gradient.addColorStop(0, '#ffffff')
  gradient.addColorStop(1, '#eef2ff')
  context.fillStyle = gradient
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  drawRoundedRect(context, 72, 72, CARD_WIDTH - 144, CARD_HEIGHT - 144, 40)
  context.save()
  context.shadowColor = 'rgba(15, 23, 42, 0.08)'
  context.shadowBlur = 30
  context.shadowOffsetY = 10
  context.fillStyle = '#ffffff'
  context.fill()
  context.restore()

  context.fillStyle = '#0f172a'
  context.font = '600 34px Inter, system-ui, sans-serif'
  context.fillText('Run Club', 120, 148)

  let currentY = 244

  if (input.isPersonalRecord) {
    drawRoundedRect(context, 120, currentY - 46, 132, 52, 26)
    context.fillStyle = '#facc15'
    context.fill()
    context.fillStyle = '#111827'
    context.font = '700 24px Inter, system-ui, sans-serif'
    context.fillText('PR', 170, currentY - 13)
    currentY += 44
  }

  context.fillStyle = '#475569'
  context.font = '500 28px Inter, system-ui, sans-serif'
  context.fillText('Результат старта', 120, currentY)
  currentY += 48

  context.fillStyle = '#0f172a'
  context.font = '700 58px Inter, system-ui, sans-serif'
  const raceNameLines = wrapText(context, input.raceName, CARD_WIDTH - 240)

  for (const line of raceNameLines.slice(0, 3)) {
    context.fillText(line, 120, currentY)
    currentY += 68
  }

  currentY += 32

  context.fillStyle = '#111827'
  context.font = '700 132px Inter, system-ui, sans-serif'
  const resultText = input.resultTime ?? 'Без результата'
  context.fillText(resultText, 120, currentY + 120)

  currentY += 210

  context.fillStyle = '#64748b'
  context.font = '500 30px Inter, system-ui, sans-serif'
  context.fillText('Дистанция', 120, currentY)
  currentY += 54

  context.fillStyle = '#0f172a'
  context.font = '600 52px Inter, system-ui, sans-serif'
  context.fillText(input.distanceLabel ?? 'Не указана', 120, currentY)

  const footerY = CARD_HEIGHT - 240
  const avatarSize = 112
  const avatarX = 120
  const avatarY = footerY

  context.save()
  context.beginPath()
  context.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
  context.closePath()
  context.clip()

  if (input.avatarUrl) {
    try {
      const avatarImage = await loadImage(input.avatarUrl)
      context.drawImage(avatarImage, avatarX, avatarY, avatarSize, avatarSize)
    } catch {
      context.fillStyle = '#cbd5e1'
      context.fillRect(avatarX, avatarY, avatarSize, avatarSize)
      context.fillStyle = '#0f172a'
      context.font = '700 38px Inter, system-ui, sans-serif'
      context.textAlign = 'center'
      context.fillText(formatInitials(input.displayName), avatarX + avatarSize / 2, avatarY + 66)
      context.textAlign = 'start'
    }
  } else {
    context.fillStyle = '#cbd5e1'
    context.fillRect(avatarX, avatarY, avatarSize, avatarSize)
    context.fillStyle = '#0f172a'
    context.font = '700 38px Inter, system-ui, sans-serif'
    context.textAlign = 'center'
    context.fillText(formatInitials(input.displayName), avatarX + avatarSize / 2, avatarY + 66)
    context.textAlign = 'start'
  }
  context.restore()

  context.fillStyle = '#0f172a'
  context.font = '600 42px Inter, system-ui, sans-serif'
  context.fillText(input.displayName, 264, footerY + 46)
  context.fillStyle = '#64748b'
  context.font = '500 28px Inter, system-ui, sans-serif'
  context.fillText('runclub.app', 264, footerY + 92)

  const blob = await canvasToBlob(canvas, OUTPUT_TYPE)
  const filenameBase = sanitizeFilePart(input.raceName) || 'race-result'

  return {
    blob,
    fileName: `${filenameBase}.png`,
  }
}
