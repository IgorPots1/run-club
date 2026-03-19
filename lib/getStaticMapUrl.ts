const MAPBOX_STYLE = 'mapbox/light-v11'
const MAPBOX_IMAGE_SIZE = '600x300@2x'
const MAPBOX_ROUTE_STYLE = 'path-5+2563eb-0.9'

function hasRenderablePolyline(encoded: string) {
  let index = 0
  let pointCount = 0

  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte = 0

    do {
      if (index >= encoded.length) {
        return false
      }

      byte = encoded.charCodeAt(index) - 63
      if (byte < 0) {
        return false
      }

      index += 1
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    shift = 0
    result = 0

    do {
      if (index >= encoded.length) {
        return false
      }

      byte = encoded.charCodeAt(index) - 63
      if (byte < 0) {
        return false
      }

      index += 1
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    pointCount += 1
  }

  return pointCount >= 2
}

export function getStaticMapUrl(polyline: string): string | null {
  const trimmedPolyline = polyline.trim()
  const accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim()

  if (!trimmedPolyline || !accessToken || !hasRenderablePolyline(trimmedPolyline)) {
    return null
  }

  const encodedPolyline = encodeURIComponent(trimmedPolyline)
  return `https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/static/${MAPBOX_ROUTE_STYLE}(${encodedPolyline})/auto/${MAPBOX_IMAGE_SIZE}?padding=80&logo=false&attribution=false&access_token=${accessToken}`
}
