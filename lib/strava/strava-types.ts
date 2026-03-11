export type StravaConnectionStatus = 'connected' | 'disconnected' | 'error'

export type StravaActivityType = 'Run'

export type StravaAthleteSummary = {
  id: number
  username?: string | null
  firstname?: string | null
  lastname?: string | null
}

export type StravaTokenExchangeResponse = {
  token_type: string
  access_token: string
  refresh_token: string
  expires_at: number
  expires_in: number
  athlete: StravaAthleteSummary
}

export type StravaWebhookEvent = {
  aspect_type: string
  event_time: number
  object_id: number
  object_type: string
  owner_id: number
  subscription_id: number
  updates?: Record<string, string>
}
