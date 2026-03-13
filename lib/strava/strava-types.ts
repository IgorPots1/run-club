export type StravaConnectionStatus = 'connected' | 'reconnect_required' | 'disconnected' | 'error'

export type StravaActivityType = 'Run' | 'TrailRun' | 'VirtualRun'

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

export type StravaActivitySummary = {
  id: number
  name: string
  type: string
  distance: number
  moving_time: number
  elapsed_time: number
  total_elevation_gain: number
  start_date: string
  average_heartrate?: number | null
  max_heartrate?: number | null
  calories?: number | null
  average_cadence?: number | null
  map?: {
    id?: string | null
    summary_polyline?: string | null
    polyline?: string | null
  } | null
}

export type StravaInitialSyncResult =
  | {
      ok: true
      imported: number
      skipped: number
      failed: number
      totalRunsFetched: number
      errors: Array<{
        activityId: string
        field?: string
        value?: number | string | null
        error: string
      }>
      debug?: {
        step: string
        userId: string
        athleteId: number | null
        connectionId: string | null
        totalActivitiesFetched: number
        firstFetchedActivityId: string | null
        firstFetchedActivityType: string | null
        runActivitiesCount: number
        imported: number
        skipped: number
        failed: number
        firstFailure: {
          activityId: string
          field?: string
          value?: number | string | null
          error: string
        } | null
        afterParamUsed: number | null
        latestExistingStravaRunAt: string | null
      }
    }
  | {
      ok: false
      step: 'missing_connection'
      debug?: {
        step: string
        userId: string
        athleteId: number | null
        connectionId: string | null
        totalActivitiesFetched: number
        firstFetchedActivityId: string | null
        firstFetchedActivityType: string | null
        runActivitiesCount: number
        imported: number
        skipped: number
        failed: number
        firstFailure: {
          activityId: string
          field?: string
          value?: number | string | null
          error: string
        } | null
        afterParamUsed: number | null
        latestExistingStravaRunAt: string | null
      }
    }
  | {
      ok: false
      step: 'reconnect_required'
      debug?: {
        step: string
        userId: string
        athleteId: number | null
        connectionId: string | null
        totalActivitiesFetched: number
        firstFetchedActivityId: string | null
        firstFetchedActivityType: string | null
        runActivitiesCount: number
        imported: number
        skipped: number
        failed: number
        firstFailure: {
          activityId: string
          field?: string
          value?: number | string | null
          error: string
        } | null
        afterParamUsed: number | null
        latestExistingStravaRunAt: string | null
      }
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
