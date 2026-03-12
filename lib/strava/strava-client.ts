import 'server-only'

import type { StravaActivitySummary, StravaTokenExchangeResponse } from './strava-types'

const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize'
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token'
const STRAVA_ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities'
const STRAVA_ACTIVITY_URL = 'https://www.strava.com/api/v3/activities'
const STRAVA_MVP_SCOPE = 'read,activity:read_all'

function getRequiredEnv(
  name:
    | 'STRAVA_CLIENT_ID'
    | 'STRAVA_CLIENT_SECRET'
    | 'NEXT_PUBLIC_APP_URL'
    | 'STRAVA_WEBHOOK_VERIFY_TOKEN'
) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

export function getStravaCallbackUrl() {
  return new URL('/api/strava/callback', getRequiredEnv('NEXT_PUBLIC_APP_URL')).toString()
}

export function buildStravaAuthorizeUrl(state: string) {
  const params = new URLSearchParams({
    client_id: getRequiredEnv('STRAVA_CLIENT_ID'),
    redirect_uri: getStravaCallbackUrl(),
    response_type: 'code',
    approval_prompt: 'auto',
    scope: STRAVA_MVP_SCOPE,
    state,
  })

  return `${STRAVA_AUTHORIZE_URL}?${params.toString()}`
}

export async function exchangeStravaCodeForToken(code: string): Promise<StravaTokenExchangeResponse> {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: getRequiredEnv('STRAVA_CLIENT_ID'),
      client_secret: getRequiredEnv('STRAVA_CLIENT_SECRET'),
      code,
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Strava token exchange failed with status ${response.status}`)
  }

  return response.json() as Promise<StravaTokenExchangeResponse>
}

export async function refreshStravaAccessToken(refreshToken: string): Promise<StravaTokenExchangeResponse> {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: getRequiredEnv('STRAVA_CLIENT_ID'),
      client_secret: getRequiredEnv('STRAVA_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Strava token refresh failed with status ${response.status}`)
  }

  return response.json() as Promise<StravaTokenExchangeResponse>
}

export function getStravaWebhookVerifyToken() {
  return getRequiredEnv('STRAVA_WEBHOOK_VERIFY_TOKEN')
}

export async function fetchStravaActivities(
  accessToken: string,
  afterUnixSeconds: number
): Promise<StravaActivitySummary[]> {
  const params = new URLSearchParams({
    after: String(afterUnixSeconds),
    per_page: '200',
  })

  const response = await fetch(`${STRAVA_ACTIVITIES_URL}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Strava activities fetch failed with status ${response.status}`)
  }

  const responseText = new TextDecoder('utf-8').decode(await response.arrayBuffer())

  return JSON.parse(responseText) as StravaActivitySummary[]
}

export async function fetchStravaActivityById(
  accessToken: string,
  activityId: number | string
): Promise<StravaActivitySummary> {
  const response = await fetch(`${STRAVA_ACTIVITY_URL}/${activityId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Strava activity fetch failed with status ${response.status}`)
  }

  const responseText = new TextDecoder('utf-8').decode(await response.arrayBuffer())

  return JSON.parse(responseText) as StravaActivitySummary
}
