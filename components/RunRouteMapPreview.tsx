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

  const width = 100
  const height = 60
  const padding = 4
  const latRange = Math.max(maxLat - minLat, 0.00001)
  const lngRange = Math.max(maxLng - minLng, 0.00001)

  const normalized = points.map((point) => {
    const x = padding + ((point.lng - minLng) / lngRange) * (width - padding * 2)
    const y = padding + ((maxLat - point.lat) / latRange) * (height - padding * 2)
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
      <svg viewBox="0 0 100 60" className="h-full w-full rounded-xl" role="img" aria-label="Маршрут тренировки">
        <rect x="0" y="0" width="100" height="60" className="fill-[var(--surface-muted)]" />
        <path
          d={routePath.d}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[var(--accent)]"
        />
        <circle cx={routePath.start.x} cy={routePath.start.y} r="1.8" className="fill-emerald-500" />
        <circle cx={routePath.end.x} cy={routePath.end.y} r="1.8" className="fill-rose-500" />
      </svg>
    </div>
  )
}
