'use client'

type RunRouteMapPreviewProps = {
  polyline: string
  className?: string
}

type Point = {
  lat: number
  lng: number
}

function decodePolyline(encoded: string): Point[] {
  const points: Point[] = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte: number

    do {
      if (index >= encoded.length) {
        return points
      }
      byte = encoded.charCodeAt(index) - 63
      index += 1
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1
    lat += deltaLat

    shift = 0
    result = 0

    do {
      if (index >= encoded.length) {
        return points
      }
      byte = encoded.charCodeAt(index) - 63
      index += 1
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    const deltaLng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1
    lng += deltaLng

    points.push({
      lat: lat / 1e5,
      lng: lng / 1e5,
    })
  }

  return points
}

function buildPathD(points: Point[]) {
  if (points.length < 2) {
    return null
  }

  let minLat = points[0].lat
  let maxLat = points[0].lat
  let minLng = points[0].lng
  let maxLng = points[0].lng

  for (const point of points) {
    minLat = Math.min(minLat, point.lat)
    maxLat = Math.max(maxLat, point.lat)
    minLng = Math.min(minLng, point.lng)
    maxLng = Math.max(maxLng, point.lng)
  }

  const width = 300
  const height = 180
  const padding = 40
  const safeLatRange = Math.max(maxLat - minLat, 0.00001)
  const safeLngRange = Math.max(maxLng - minLng, 0.00001)
  const drawableWidth = Math.max(1, width - padding * 2)
  const drawableHeight = Math.max(1, height - padding * 2)
  const uniformScale = Math.min(drawableWidth / safeLngRange, drawableHeight / safeLatRange)
  const routeWidth = safeLngRange * uniformScale
  const routeHeight = safeLatRange * uniformScale
  const offsetX = padding + (drawableWidth - routeWidth) / 2
  const offsetY = padding + (drawableHeight - routeHeight) / 2

  const normalized = points.map((point) => {
    const x = offsetX + (point.lng - minLng) * uniformScale
    const y = offsetY + (maxLat - point.lat) * uniformScale
    return { x, y }
  })

  const first = normalized[0]
  const path = [`M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`]

  for (let index = 1; index < normalized.length; index += 1) {
    const point = normalized[index]
    path.push(`L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
  }

  return {
    d: path.join(' '),
    start: normalized[0],
    end: normalized[normalized.length - 1],
  }
}

export function hasRenderableRoutePolyline(polyline: string) {
  const trimmedPolyline = polyline.trim()
  if (!trimmedPolyline) {
    return false
  }

  const decodedPoints = decodePolyline(trimmedPolyline)
  return Boolean(buildPathD(decodedPoints))
}

export default function RunRouteMapPreview({ polyline, className }: RunRouteMapPreviewProps) {
  const trimmedPolyline = polyline.trim()
  if (!trimmedPolyline) {
    return null
  }

  const decodedPoints = decodePolyline(trimmedPolyline)
  const routePath = buildPathD(decodedPoints)

  if (!routePath) {
    return null
  }

  return (
    <div className={className}>
      <svg viewBox="0 0 300 180" className="h-full w-full rounded-xl" role="img" aria-label="Маршрут тренировки">
        <defs>
          <pattern id="route-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="currentColor"
              opacity="0.04"
              className="text-black dark:text-white"
              strokeWidth="1"
            />
          </pattern>
        </defs>

        <rect x="0" y="0" width="300" height="180" className="fill-[var(--surface-muted)]" />
        <rect x="0" y="0" width="300" height="180" fill="url(#route-grid)" />
        <path
          d={routePath.d}
          fill="none"
          stroke="#FFFFFF"
          opacity="0.6"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={routePath.d}
          fill="none"
          stroke="#111827"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={routePath.start.x} cy={routePath.start.y} r="3.2" className="fill-white/85 dark:fill-black/55" />
        <circle cx={routePath.start.x} cy={routePath.start.y} r="2" className="fill-emerald-500" />
        <circle cx={routePath.end.x} cy={routePath.end.y} r="3.2" className="fill-white/85 dark:fill-black/55" />
        <circle cx={routePath.end.x} cy={routePath.end.y} r="2" className="fill-rose-500" />
      </svg>
    </div>
  )
}
