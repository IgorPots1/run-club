const MAPBOX_STYLE = 'mapbox/light-v11'
const MAPBOX_IMAGE_SIZE = '600x300@2x'
const MAPBOX_ROUTE_STYLE = 'path-5+2563eb-0.9'

type PolylineEndpoints = {
  start: { lat: number; lng: number }
  finish: { lat: number; lng: number }
}

function getPolylineEndpoints(encoded: string): PolylineEndpoints | null {
  let index = 0
  let pointCount = 0
  let lat = 0
  let lng = 0
  let start: PolylineEndpoints['start'] | null = null
  let finish: PolylineEndpoints['finish'] | null = null

  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte = 0

    do {
      if (index >= encoded.length) {
        return null
      }

      byte = encoded.charCodeAt(index) - 63
      if (byte < 0) {
        return null
      }

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
        return null
      }

      byte = encoded.charCodeAt(index) - 63
      if (byte < 0) {
        return null
      }

      index += 1
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    const deltaLng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1
    lng += deltaLng

    const point = {
      lat: lat / 1e5,
      lng: lng / 1e5,
    }

    if (!start) {
      start = point
    }

    finish = point
    pointCount += 1
  }

  if (pointCount < 2 || !start || !finish) {
    return null
  }

  return { start, finish }
}

export function getStaticMapUrl(polyline: string): string | null {
  const trimmedPolyline = polyline.trim()
  const accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim()
  const endpoints = getPolylineEndpoints(trimmedPolyline)

  if (!trimmedPolyline || !accessToken || !endpoints) {
    return null
  }

  const encodedPolyline = encodeURIComponent(trimmedPolyline)
  const startMarker = `pin-s+22c55e(${endpoints.start.lng},${endpoints.start.lat})`
  const finishMarker = `pin-s+ef4444(${endpoints.finish.lng},${endpoints.finish.lat})`
  return `https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/static/${startMarker},${finishMarker},${MAPBOX_ROUTE_STYLE}(${encodedPolyline})/auto/${MAPBOX_IMAGE_SIZE}?padding=80&logo=false&attribution=false&access_token=${accessToken}`
}
