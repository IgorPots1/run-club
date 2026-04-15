export type CoachLabFormValues = {
  userId: string
  weekStart: string
  planText: string
}

export type CoachLabParsedPlanDay = {
  line_number: number
  day_label: string | null
  source_text: string
  workout_type: string | null
  intensity: string | null
  target_distance_km: number | null
  target_duration_minutes: number | null
  notes: string | null
}

export type CoachLabActualRun = {
  id: string
  created_at: string
  title: string
  description: string | null
  distance_km: number | null
  duration_minutes: number | null
  moving_time_seconds: number | null
  elevation_gain_meters: number | null
  average_heartrate: number | null
  max_heartrate: number | null
  external_source: string | null
  external_id: string | null
}

export type CoachLabWeeklySummary = {
  range_start: string
  range_end_exclusive: string
  planned_lines_count: number
  planned_workouts_count: number
  planned_rest_days_count: number
  planned_known_distance_km: number | null
  actual_runs_count: number
  actual_distance_km: number
  actual_duration_minutes: number
  actual_active_days_count: number
  strava_runs_count: number
  manual_runs_count: number
}

export type CoachLabModelPayload = {
  selected_user_id: string
  selected_user_label: string
  week_start: string
  week_end_exclusive: string
  plan_text: string
  parsed_plan_days: CoachLabParsedPlanDay[]
  actual_runs: CoachLabActualRun[]
  weekly_summary: CoachLabWeeklySummary
}

export type CoachLabMatchedWorkout = {
  plan_reference: string
  actual_reference: string
  comparison_note: string
}

export type CoachLabMissedOrChangedWorkout = {
  plan_reference: string
  outcome: string
  details: string
}

export type CoachLabAiOutput = {
  summary: string
  matched_workouts: CoachLabMatchedWorkout[]
  missed_or_changed_workouts: CoachLabMissedOrChangedWorkout[]
  load_observations: string[]
  athlete_feedback: string[]
  coach_note: string
  confidence: 'low' | 'medium' | 'high'
  warnings: string[]
}

export type CoachLabResult = {
  userId: string
  userLabel: string
  weekStart: string
  weekEndExclusive: string
  parsedPlanDays: CoachLabParsedPlanDay[]
  actualRuns: CoachLabActualRun[]
  weeklySummary: CoachLabWeeklySummary
  aiOutput: CoachLabAiOutput | null
  analysisError: string | null
  debugPayload: {
    model: string
    payload: CoachLabModelPayload
  }
}

export type CoachLabState = {
  form: CoachLabFormValues
  result: CoachLabResult | null
  error: string | null
}

export type CoachLabUserOption = {
  id: string
  label: string
  appAccessStatus: 'active' | 'blocked'
}
