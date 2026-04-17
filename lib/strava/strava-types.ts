import type { XpBreakdownItem } from '@/lib/xp'

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
  sport_type?: string | null
  distance: number
  moving_time: number
  elapsed_time: number
  total_elevation_gain: number
  start_date: string
  description?: string | null
  achievement_count?: number | null
  photo_count?: number | null
  total_photo_count?: number | null
  location_city?: string | null
  location_state?: string | null
  location_country?: string | null
  start_latlng?: [number, number] | null
  end_latlng?: [number, number] | null
  average_heartrate?: number | null
  max_heartrate?: number | null
  calories?: number | null
  average_cadence?: number | null
  photos?: {
    count?: number | null
    primary?: Record<string, unknown> | null
  } | null
  map?: {
    id?: string | null
    summary_polyline?: string | null
    polyline?: string | null
  } | null
  laps?: StravaLapSummary[] | null
}

export type StravaActivityPhoto = {
  id?: number | null
  unique_id?: string | null
  activity_id?: number | null
  resource_state?: number | null
  ref?: string | null
  uid?: string | null
  caption?: string | null
  type?: string | null
  source?: number | null
  uploaded_at?: string | null
  created_at?: string | null
  location?: [number, number] | null
  urls?: Record<string, string> | null
}

export type StravaLapSummary = {
  id?: number
  name?: string | null
  elapsed_time?: number | null
  moving_time?: number | null
  distance?: number | null
  average_speed?: number | null
  max_speed?: number | null
  average_heartrate?: number | null
  max_heartrate?: number | null
  total_elevation_gain?: number | null
  start_date?: string | null
  start_index?: number | null
  end_index?: number | null
  lap_index?: number | null
}

export type StravaActivityStreams = {
  time?: number[]
  distance?: number[]
  heartrate?: number[]
  cadence?: number[]
  altitude?: number[]
  velocity_smooth?: number[]
}

export type StravaSyncDebugInfo = {
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
  targetedRunId?: string | null
  targetedActivityId?: number | null
  targetedSyncAttempted?: boolean
  targetedSyncSucceeded?: boolean
  targetedOwnerMismatch?: boolean
  targetedRunOwnerUserId?: string | null
  targetedLapsFetchedCount?: number
  targetedLapsSavedCount?: number
  targetedLapsStatus?: 'fetched_and_saved' | 'fetched_but_not_saved' | 'no_laps_returned' | 'laps_fetch_failed'
  targetedLapsErrorMessage?: string | null
  targetedLapsHttpStatus?: number | null
  detailedActivityDebug?: {
    id: number | null
    type: string | null
    sport_type: string | null
    description: string | null
    location_city: string | null
    location_state: string | null
    location_country: string | null
    start_latlng: number[] | null
    end_latlng: number[] | null
  } | null
}

export type StravaInitialSyncFailureStep =
  | 'missing_connection'
  | 'reconnect_required'
  | 'rate_limited'

export type StravaInitialSyncResult =
  | {
      ok: true
      imported: number
      updated: number
      skipped: number
      failed: number
      totalRunsFetched: number
      xpGained?: number
      breakdown?: XpBreakdownItem[]
      levelUp?: boolean
      newLevel?: number | null
      errors: Array<{
        activityId: string
        field?: string
        value?: number | string | null
        error: string
      }>
      debug?: StravaSyncDebugInfo
    }
  | {
      ok: false
      step: StravaInitialSyncFailureStep
      debug?: StravaSyncDebugInfo
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
