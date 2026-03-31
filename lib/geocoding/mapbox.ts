import 'server-only'

const MAPBOX_REVERSE_GEOCODE_TIMEOUT_MS = 3000
const MAPBOX_GEOCODING_BASE_URL = 'https://api.mapbox.com/geocoding/v5/mapbox.places'

type ReverseGeocodeResult = {
  city: string | null
  region: string | null
  country: string | null
}

type MapboxFeature = {
  place_type?: string[]
  text?: string | null
}

type MapboxReverseGeocodeResponse = {
  features?: MapboxFeature[] | null
}

function getMapboxToken() {
  const token = process.env.MAPBOX_TOKEN?.trim() || process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim()
  return token && token.length > 0 ? token : null
}

function toNullableTrimmedText(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

function getFeatureTextByPlaceType(
  features: MapboxFeature[] | null | undefined,
  placeType: 'place' | 'region' | 'country'
) {
  const matchedFeature = (features ?? []).find((feature) => feature.place_type?.includes(placeType))
  return toNullableTrimmedText(matchedFeature?.text)
}

export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }

  const accessToken = getMapboxToken()

  if (!accessToken) {
    return null
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), MAPBOX_REVERSE_GEOCODE_TIMEOUT_MS)

  try {
    const params = new URLSearchParams({
      access_token: accessToken,
      types: 'place,region,country',
      limit: '5',
    })
    const response = await fetch(
      `${MAPBOX_GEOCODING_BASE_URL}/${encodeURIComponent(String(lng))},${encodeURIComponent(String(lat))}.json?${params.toString()}`,
      {
        cache: 'no-store',
        signal: controller.signal,
      }
    )

    if (!response.ok) {
      return null
    }

    const data = await response.json() as MapboxReverseGeocodeResponse
    const city = getFeatureTextByPlaceType(data.features, 'place')
    const region = getFeatureTextByPlaceType(data.features, 'region')
    const country = getFeatureTextByPlaceType(data.features, 'country')

    if (!city && !region && !country) {
      return null
    }

    return { city, region, country }
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}
