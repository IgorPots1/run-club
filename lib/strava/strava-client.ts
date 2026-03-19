import 'server-only'

import type { StravaActivityStreams, StravaActivitySummary, StravaTokenExchangeResponse } from './strava-types'

const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize'
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token'
const STRAVA_ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities'
const STRAVA_ACTIVITY_URL = 'https://www.strava.com/api/v3/activities'
const STRAVA_ACTIVITY_STREAM_KEYS = 'time,distance,heartrate,velocity_smooth'
const STRAVA_MVP_SCOPE = 'read,activity:read_all'

type StravaActivityStreamEnvelope = {
  data?: unknown
}

export class StravaApiError extends Error {
  status: number
  responseBody: string | null
  authFailure: boolean

  constructor(message: string, status: number, responseBody: string | null, authFailure: boolean) {
    super(message)
    this.name = 'StravaApiError'
    this.status = status
    this.responseBody = responseBody
    this.authFailure = authFailure
  }
}

function detectStravaAuthFailure(status: number, responseBody: string | null) {
  if (status === 401) {
    return true
  }

  if (!responseBody) {
    return false
  }

  return /invalid_grant|unauthorized|invalid token/i.test(responseBody)
}

function buildStravaApiError(messagePrefix: string, status: number, responseBody: string | null) {
  const authFailure = detectStravaAuthFailure(status, responseBody)
  return new StravaApiError(`${messagePrefix} with status ${status}`, status, responseBody, authFailure)
}

async function readErrorBody(response: Response) {
  try {
    return await response.text()
  } catch {
    return null
  }
}

export function isStravaAuthError(error: unknown): error is StravaApiError {
  return error instanceof StravaApiError && error.authFailure
}

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
    throw buildStravaApiError('Strava token exchange failed', response.status, await readErrorBody(response))
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
    throw buildStravaApiError('Strava token refresh failed', response.status, await readErrorBody(response))
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
    throw buildStravaApiError('Strava activities fetch failed', response.status, await readErrorBody(response))
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
    throw buildStravaApiError('Strava activity fetch failed', response.status, await readErrorBody(response))
  }

  const responseText = new TextDecoder('utf-8').decode(await response.arrayBuffer())

  return JSON.parse(responseText) as StravaActivitySummary
}

export async function fetchActivityStreams(
  activityId: number,
  accessToken: string
): Promise<StravaActivityStreams> {
  const params = new URLSearchParams({
    keys: STRAVA_ACTIVITY_STREAM_KEYS,
    key_by_type: 'true',
  })

  const response = await fetch(`${STRAVA_ACTIVITY_URL}/${activityId}/streams?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw buildStravaApiError('Strava activity streams fetch failed', response.status, await readErrorBody(response))
  }

  const responseText = new TextDecoder('utf-8').decode(await response.arrayBuffer())
  const parsed = JSON.parse(responseText) as Record<string, StravaActivityStreamEnvelope> | null

  const streams: StravaActivityStreams = {
    time: Array.isArray(parsed?.time?.data) ? parsed.time.data.filter((value): value is number => typeof value === 'number') : undefined,
    distance: Array.isArray(parsed?.distance?.data) ? parsed.distance.data.filter((value): value is number => typeof value === 'number') : undefined,
    heartrate: Array.isArray(parsed?.heartrate?.data) ? parsed.heartrate.data.filter((value): value is number => typeof value === 'number') : undefined,
    velocity_smooth: Array.isArray(parsed?.velocity_smooth?.data)
      ? parsed.velocity_smooth.data.filter((value): value is number => typeof value === 'number')
      : undefined,
  }

  const receivedStreams = Object.entries(streams)
    .filter(([, values]) => Array.isArray(values) && values.length > 0)
    .map(([key]) => key)

  console.info('Strava activity streams received', {
    activityId,
    streams: receivedStreams,
  })

  return streams
}
