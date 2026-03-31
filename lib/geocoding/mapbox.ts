import 'server-only'

const MAPBOX_REVERSE_GEOCODE_TIMEOUT_MS = 3000
const MAPBOX_GEOCODING_BASE_URL = 'https://api.mapbox.com/geocoding/v5/mapbox.places'

type ReverseGeocodeResult = {
  city: string | null
  region: string | null
  country: string | null
}

type MapboxFeature = {
  id?: string | null
  place_type?: string[]
  text?: string | null
  context?: MapboxFeature[] | null
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

function getContextTextByPrefix(
  features: MapboxFeature[] | null | undefined,
  prefix: 'place' | 'region' | 'country'
) {
  const matchedFeature = (features ?? []).find((feature) => feature.id?.startsWith(prefix))
  return toNullableTrimmedText(matchedFeature?.text)
}

export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    console.info('[mapbox-geocode-debug] skipped_invalid_coordinates', {
      lat,
      lng,
    })
    return null
  }

  const accessToken = getMapboxToken()

  if (!accessToken) {
    console.info('[mapbox-geocode-debug] missing_token', {
      lat,
      lng,
      hasToken: false,
    })
    return null
  }

  const params = new URLSearchParams({
    limit: '1',
    access_token: accessToken,
  })
  const requestUrl = `${MAPBOX_GEOCODING_BASE_URL}/${encodeURIComponent(String(lng))},${encodeURIComponent(String(lat))}.json?${params.toString()}`
  const loggedRequestUrl = `${MAPBOX_GEOCODING_BASE_URL}/${encodeURIComponent(String(lng))},${encodeURIComponent(String(lat))}.json?limit=1&access_token=[redacted]`

  console.info('[mapbox-geocode-debug] request_prepared', {
    lat,
    lng,
    hasToken: true,
    requestUrl: loggedRequestUrl,
  })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), MAPBOX_REVERSE_GEOCODE_TIMEOUT_MS)

  try {
    const response = await fetch(requestUrl, {
      cache: 'no-store',
      signal: controller.signal,
    })

    console.info('[mapbox-geocode-debug] response_received', {
      lat,
      lng,
      status: response.status,
      ok: response.ok,
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json() as MapboxReverseGeocodeResponse
    const feature = data.features?.[0] ?? null
    console.info('[mapbox-geocode-debug] response_parsed', {
      lat,
      lng,
      featuresCount: Array.isArray(data.features) ? data.features.length : 0,
      featurePlaceTypes: (data.features ?? []).slice(0, 5).map((feature) => feature.place_type ?? []),
      featureTexts: (data.features ?? []).slice(0, 5).map((feature) => feature.text ?? null),
    })
    const context = feature?.context ?? []
    const city =
      getContextTextByPrefix(context, 'place') ??
      (feature?.place_type?.includes('place') ? toNullableTrimmedText(feature.text) : null)
    const region = getContextTextByPrefix(context, 'region')
    const country = getContextTextByPrefix(context, 'country')

    console.info('[mapbox-geocode-debug] values_extracted', {
      lat,
      lng,
      city,
      region,
      country,
    })

    if (!city && !region && !country) {
      return null
    }

    return { city, region, country }
  } catch (caughtError) {
    console.warn('[mapbox-geocode-debug] request_failed', {
      lat,
      lng,
      error: caughtError instanceof Error ? caughtError.message : 'Unknown reverse geocode error',
    })
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}
