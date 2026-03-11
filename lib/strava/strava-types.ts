export type StravaConnectionStatus = 'connected' | 'disconnected' | 'error'

export type StravaActivityType = 'Run'

export type StravaWebhookEvent = {
  aspect_type: string
  event_time: number
  object_id: number
  object_type: string
  owner_id: number
  subscription_id: number
  updates?: Record<string, string>
}
