'use server'

import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type {
  CoachLabActualRun,
  CoachLabAiOutput,
  CoachLabFormValues,
  CoachLabModelPayload,
  CoachLabParsedPlanDay,
  CoachLabState,
  CoachLabWeeklySummary,
} from './types'

type RunRow = {
  id: string
  name: string | null
  title: string | null
  description: string | null
  distance_km: number | null
  duration_minutes: number | null
  duration_seconds: number | null
  moving_time_seconds: number | null
  elevation_gain_meters: number | null
  average_heartrate: number | null
  max_heartrate: number | null
  created_at: string
  external_source: string | null
  external_id: string | null
}

const DEFAULT_MODEL = 'gpt-4.1-mini'

const DAY_PATTERNS = [
  { label: 'Monday', regex: /\b(?:mon(?:day)?|пн|пон(?:едельник)?)\b/i },
  { label: 'Tuesday', regex: /\b(?:tue(?:s|sday)?|вт|вторник)\b/i },
  { label: 'Wednesday', regex: /\b(?:wed(?:nesday)?|ср|среда)\b/i },
  { label: 'Thursday', regex: /\b(?:thu(?:r|rs|rsday)?|чт|четверг)\b/i },
  { label: 'Friday', regex: /\b(?:fri(?:day)?|пт|пятница)\b/i },
  { label: 'Saturday', regex: /\b(?:sat(?:urday)?|сб|суббота)\b/i },
  { label: 'Sunday', regex: /\b(?:sun(?:day)?|вс|воскресенье)\b/i },
] as const

const OUTPUT_DAY_VALUES = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

const WEEKDAY_LABELS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const

const WORKOUT_KEYWORDS = [
  { type: 'rest', regex: /\b(?:rest|off|выходной|отдых)\b/i, intensity: 'rest' },
  { type: 'long run', regex: /\b(?:long\s*run|longrun|дл(?:инная)?|длительный)\b/i, intensity: 'steady' },
  { type: 'intervals', regex: /\b(?:interval|интервал)\w*/i, intensity: 'hard' },
  { type: 'tempo', regex: /\b(?:tempo|threshold|порог|темпо)\w*/i, intensity: 'moderate-hard' },
  { type: 'recovery', regex: /\b(?:recovery|recover|восстанов)\w*/i, intensity: 'easy' },
  { type: 'easy', regex: /\b(?:easy|легк)\w*/i, intensity: 'easy' },
  { type: 'race', regex: /\b(?:race|парkrun|забег|гонка|соревн)\w*/i, intensity: 'hard' },
  { type: 'strength', regex: /\b(?:strength|gym|силов)\w*/i, intensity: 'supporting' },
  { type: 'cross-training', regex: /\b(?:bike|ride|swim|cross|вел|плав)\w*/i, intensity: 'supporting' },
] as const

const MATCHED_WORKOUT_STATUSES = ['matched', 'partial', 'mismatch'] as const

const MISSED_WORKOUT_ISSUES = ['missed', 'shifted', 'different workout'] as const

const AI_OUTPUT_SCHEMA = {
  name: 'coach_lab_analysis',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      matched_workouts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            day: { type: 'string', enum: OUTPUT_DAY_VALUES },
            status: {
              type: 'string',
              enum: MATCHED_WORKOUT_STATUSES,
            },
            comment: { type: 'string' },
          },
          required: ['day', 'status', 'comment'],
        },
      },
      missed_or_changed_workouts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            day: { type: 'string', enum: OUTPUT_DAY_VALUES },
            issue: {
              type: 'string',
              enum: MISSED_WORKOUT_ISSUES,
            },
            comment: { type: 'string' },
          },
          required: ['day', 'issue', 'comment'],
        },
      },
      load_observations: {
        type: 'array',
        items: { type: 'string' },
      },
      athlete_feedback: { type: 'string' },
      coach_note: { type: 'string' },
      confidence: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
      },
      warnings: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: [
      'summary',
      'matched_workouts',
      'missed_or_changed_workouts',
      'load_observations',
      'athlete_feedback',
      'coach_note',
      'confidence',
      'warnings',
    ],
  },
} as const

function getFormString(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : ''
}

function normalizeFormValues(formData: FormData): CoachLabFormValues {
  const normalizedUserId = getFormString(formData.get('user_id'))
  const normalizedWeekStart = getFormString(formData.get('week_start'))
  const normalizedPlanText = getFormString(formData.get('plan_text'))

  return {
    userId: normalizedUserId.trim(),
    weekStart: normalizedWeekStart.trim(),
    planText: normalizedPlanText.replace(/\r\n?/g, '\n').trim(),
  }
}

function buildErrorState(form: CoachLabFormValues, error: string): CoachLabState {
  return {
    form,
    result: null,
    error,
  }
}

function parseIsoDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)

  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return date
}

function addDaysUtc(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function roundNumber(value: number, digits = 1) {
  if (!Number.isFinite(value)) {
    return 0
  }

  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function resolveDurationMinutes(run: Pick<RunRow, 'moving_time_seconds' | 'duration_seconds' | 'duration_minutes'>) {
  if (Number.isFinite(run.moving_time_seconds) && (run.moving_time_seconds ?? 0) > 0) {
    return roundNumber(Number(run.moving_time_seconds) / 60, 1)
  }

  if (Number.isFinite(run.duration_seconds) && (run.duration_seconds ?? 0) > 0) {
    return roundNumber(Number(run.duration_seconds) / 60, 1)
  }

  if (Number.isFinite(run.duration_minutes) && (run.duration_minutes ?? 0) > 0) {
    return roundNumber(Number(run.duration_minutes), 1)
  }

  return null
}

function getDayOfWeek(value: string): CoachLabActualRun['day_of_week'] {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'monday'
  }

  return WEEKDAY_LABELS[date.getUTCDay()]
}

function detectDayLabel(line: string) {
  const match = DAY_PATTERNS.find((item) => item.regex.test(line))
  return match?.label ?? null
}

function detectWorkoutType(line: string) {
  const match = WORKOUT_KEYWORDS.find((item) => item.regex.test(line))

  return {
    workoutType: match?.type ?? null,
    intensity: match?.intensity ?? null,
  }
}

function parseDistanceKm(line: string) {
  const match = /(\d+(?:[.,]\d+)?)\s*(?:km|км)\b/i.exec(line) ?? /\b(\d+(?:[.,]\d+)?)\s*k\b/i.exec(line)

  if (!match) {
    return null
  }

  const value = Number(match[1].replace(',', '.'))
  return Number.isFinite(value) ? roundNumber(value, 1) : null
}

function parseDurationMinutes(line: string) {
  const match =
    /(\d+(?:[.,]\d+)?)\s*(?:min|mins|minute|minutes|мин)\b/i.exec(line) ??
    /(\d+(?:[.,]\d+)?)\s*(?:hr|hrs|hour|hours|ч)\b/i.exec(line)

  if (!match) {
    return null
  }

  const value = Number(match[1].replace(',', '.'))

  if (!Number.isFinite(value)) {
    return null
  }

  const isHours = /(hr|hrs|hour|hours|ч)\b/i.test(match[0])
  return roundNumber(isHours ? value * 60 : value, 1)
}

function buildPlanNotes(line: string, dayLabel: string | null) {
  let normalized = line.trim()

  if (dayLabel) {
    normalized = normalized.replace(/^[\s\-*0-9.)/:]+/, '')
    normalized = normalized.replace(/^([A-Za-zА-Яа-я]+)\s*[:\-]?\s*/u, '')
  }

  return normalized.length > 0 ? normalized : null
}

function parsePlanDays(planText: string): CoachLabParsedPlanDay[] {
  return planText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const dayLabel = detectDayLabel(line)
      const workout = detectWorkoutType(line)

      return {
        line_number: index + 1,
        day_label: dayLabel,
        source_text: line,
        workout_type: workout.workoutType,
        intensity: workout.intensity,
        target_distance_km: parseDistanceKm(line),
        target_duration_minutes: parseDurationMinutes(line),
        notes: buildPlanNotes(line, dayLabel),
      }
    })
}

function normalizeActualRuns(data: RunRow[] | null): CoachLabActualRun[] {
  return (data ?? []).map((run) => ({
    id: run.id,
    created_at: run.created_at,
    day_of_week: getDayOfWeek(run.created_at),
    title: run.title?.trim() || run.name?.trim() || 'Untitled workout',
    description: run.description?.trim() || null,
    distance_km: Number.isFinite(run.distance_km) ? roundNumber(Number(run.distance_km), 2) : null,
    duration_minutes: resolveDurationMinutes(run),
    moving_time_seconds: Number.isFinite(run.moving_time_seconds) ? Math.round(Number(run.moving_time_seconds)) : null,
    elevation_gain_meters: Number.isFinite(run.elevation_gain_meters) ? Math.round(Number(run.elevation_gain_meters)) : null,
    average_heartrate: Number.isFinite(run.average_heartrate) ? Math.round(Number(run.average_heartrate)) : null,
    max_heartrate: Number.isFinite(run.max_heartrate) ? Math.round(Number(run.max_heartrate)) : null,
    external_source: run.external_source?.trim() || null,
    external_id: run.external_id?.trim() || null,
  }))
}

function buildWeeklySummary(
  weekStartIso: string,
  weekEndIso: string,
  parsedPlanDays: CoachLabParsedPlanDay[],
  actualRuns: CoachLabActualRun[]
): CoachLabWeeklySummary {
  const knownPlannedDistance = parsedPlanDays.reduce((sum, day) => {
    return sum + Number(day.target_distance_km ?? 0)
  }, 0)

  const actualDistanceKm = actualRuns.reduce((sum, run) => sum + Number(run.distance_km ?? 0), 0)
  const actualDurationMinutes = actualRuns.reduce((sum, run) => sum + Number(run.duration_minutes ?? 0), 0)
  const activeDays = new Set(actualRuns.map((run) => run.created_at.slice(0, 10)))
  const stravaRunsCount = actualRuns.filter((run) => run.external_source === 'strava').length

  return {
    range_start: weekStartIso,
    range_end_exclusive: weekEndIso,
    planned_lines_count: parsedPlanDays.length,
    planned_workouts_count: parsedPlanDays.filter((day) => day.workout_type !== 'rest').length,
    planned_rest_days_count: parsedPlanDays.filter((day) => day.workout_type === 'rest').length,
    planned_known_distance_km: knownPlannedDistance > 0 ? roundNumber(knownPlannedDistance, 1) : null,
    actual_runs_count: actualRuns.length,
    actual_distance_km: roundNumber(actualDistanceKm, 1),
    actual_duration_minutes: roundNumber(actualDurationMinutes, 1),
    actual_active_days_count: activeDays.size,
    strava_runs_count: stravaRunsCount,
    manual_runs_count: actualRuns.length - stravaRunsCount,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isOutputDay(value: string): value is (typeof OUTPUT_DAY_VALUES)[number] {
  return OUTPUT_DAY_VALUES.includes(value as (typeof OUTPUT_DAY_VALUES)[number])
}

function isMatchedWorkoutStatus(value: string): value is (typeof MATCHED_WORKOUT_STATUSES)[number] {
  return MATCHED_WORKOUT_STATUSES.includes(value as (typeof MATCHED_WORKOUT_STATUSES)[number])
}

function isMissedWorkoutIssue(value: string): value is (typeof MISSED_WORKOUT_ISSUES)[number] {
  return MISSED_WORKOUT_ISSUES.includes(value as (typeof MISSED_WORKOUT_ISSUES)[number])
}

function normalizeStructuredArray(
  value: unknown,
  requiredKeys: string[]
): Array<Record<string, string>> {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return []
    }

    const normalized = requiredKeys.reduce<Record<string, string>>((result, key) => {
      result[key] = normalizeString(item[key])
      return result
    }, {})

    return requiredKeys.every((key) => normalized[key].length > 0) ? [normalized] : []
  })
}

function normalizeAiOutput(value: unknown): CoachLabAiOutput | null {
  if (!isRecord(value)) {
    return null
  }

  const confidence = normalizeString(value.confidence)

  if (confidence !== 'low' && confidence !== 'medium' && confidence !== 'high') {
    return null
  }

  const matched = normalizeStructuredArray(value.matched_workouts, [
    'day',
    'status',
    'comment',
  ])
  const missed = normalizeStructuredArray(value.missed_or_changed_workouts, [
    'day',
    'issue',
    'comment',
  ])

  const summary = normalizeString(value.summary)
  const coachNote = normalizeString(value.coach_note)
  const loadObservations = isStringArray(value.load_observations) ? value.load_observations.map((item) => item.trim()).filter(Boolean) : []
  const athleteFeedback = normalizeString(value.athlete_feedback)
  const warnings = isStringArray(value.warnings) ? value.warnings.map((item) => item.trim()).filter(Boolean) : []

  if (!summary || !coachNote || !athleteFeedback) {
    return null
  }

  const normalizedMatched = matched.flatMap((item) => {
    if (!isOutputDay(item.day) || !isMatchedWorkoutStatus(item.status)) {
      return []
    }

    return [
      {
        day: item.day,
        status: item.status,
        comment: item.comment,
      },
    ]
  })
  const normalizedMissed = missed.flatMap((item) => {
    if (!isOutputDay(item.day) || !isMissedWorkoutIssue(item.issue)) {
      return []
    }

    return [
      {
        day: item.day,
        issue: item.issue,
        comment: item.comment,
      },
    ]
  })

  return {
    summary,
    matched_workouts: normalizedMatched,
    missed_or_changed_workouts: normalizedMissed,
    load_observations: loadObservations,
    athlete_feedback: athleteFeedback,
    coach_note: coachNote,
    confidence,
    warnings,
  }
}

async function callOpenAiAnalysis(payload: CoachLabModelPayload) {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('Missing required environment variable: OPENAI_API_KEY')
  }

  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: {
        type: 'json_schema',
        json_schema: AI_OUTPUT_SCHEMA,
      },
      messages: [
        {
          role: 'system',
          content:
            'You are an experienced running coach. Analyze a weekly training plan written in free text and compare it with actual completed runs. Do not rely on any pre-parsed structure alone: you must interpret the original plan_text yourself, and parsed_plan_days may be incomplete or wrong. Extract days of the week from the raw text, including Russian day names, group the plan by day, and mark uncertainty explicitly instead of guessing. Match workouts only by day of week; never match by duration alone, and a workout done on another day is not a match. Detect completed workouts, missed workouts, extra workouts, and shifted workouts. Evaluate adherence to weekly structure, not just total volume. If pace, splits, or intensity data are missing, say that intensity cannot be verified. Do not invent details. Output all text in Russian, concise and coach-like. Return only JSON that matches the provided schema.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            task: 'Проанализируй, насколько спортсмен выполнил недельный план по дням недели и как фактическая нагрузка отличалась от запланированной.',
            matching_rules: [
              'Сначала интерпретируй исходный plan_text, а parsed_plan_days используй только как вспомогательную подсказку.',
              'Сопоставляй только по дню недели. Если тренировка сделана в другой день, это не match.',
              'Не подменяй совпадение по дню похожей длительностью или похожим объемом.',
              'Если в плане или факте не хватает данных, явно укажи это в warnings или comment.',
              'Если темп, сплиты или зона усилия не указаны, прямо скажи, что интенсивность нельзя проверить.',
            ],
            payload,
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  })

  const raw = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      (isRecord(raw) && isRecord(raw.error) && typeof raw.error.message === 'string' && raw.error.message) ||
      `OpenAI request failed with status ${response.status}`

    throw new Error(message)
  }

  const content = isRecord(raw)
    ? (raw.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content
    : null

  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('OpenAI returned an empty response')
  }

  const parsed = JSON.parse(content) as unknown
  const aiOutput = normalizeAiOutput(parsed)

  if (!aiOutput) {
    throw new Error('OpenAI returned JSON in an unexpected shape')
  }

  return {
    model,
    aiOutput,
  }
}

export async function analyzeCoachLab(
  _previousState: CoachLabState,
  formData: FormData
): Promise<CoachLabState> {
  await requireAdmin()

  const form = normalizeFormValues(formData)

  if (!form.userId) {
    return buildErrorState(form, 'Select a user to analyze.')
  }

  if (!form.weekStart) {
    return buildErrorState(form, 'Select the start date for the week.')
  }

  if (!form.planText) {
    return buildErrorState(form, 'Paste a training plan before running analysis.')
  }

  const parsedWeekStart = parseIsoDateOnly(form.weekStart)

  if (!parsedWeekStart) {
    return buildErrorState(form, 'Week start must be a valid date in YYYY-MM-DD format.')
  }

  const parsedWeekEnd = addDaysUtc(parsedWeekStart, 7)
  const weekStartIso = parsedWeekStart.toISOString()
  const weekEndIso = parsedWeekEnd.toISOString()

  const supabase = createSupabaseAdminClient()
  const [{ data: profile, error: profileError }, { data: runs, error: runsError }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, name, app_access_status')
      .eq('id', form.userId)
      .maybeSingle(),
    supabase
      .from('runs')
      .select(
        'id, name, title, description, distance_km, duration_minutes, duration_seconds, moving_time_seconds, elevation_gain_meters, average_heartrate, max_heartrate, created_at, external_source, external_id'
      )
      .eq('user_id', form.userId)
      .eq('external_source', 'strava')
      .gte('created_at', weekStartIso)
      .lt('created_at', weekEndIso)
      .order('created_at', { ascending: true }),
  ])

  if (profileError) {
    return buildErrorState(form, `Failed to load user profile: ${profileError.message}`)
  }

  if (!profile) {
    return buildErrorState(form, 'User not found.')
  }

  if (runsError) {
    return buildErrorState(form, `Failed to load runs: ${runsError.message}`)
  }

  const parsedPlanDays = parsePlanDays(form.planText)
  const actualRuns = normalizeActualRuns((runs as RunRow[] | null) ?? [])
  const userLabel = profile.name?.trim() || profile.id
  const weeklySummary = buildWeeklySummary(weekStartIso, weekEndIso, parsedPlanDays, actualRuns)
  const payload: CoachLabModelPayload = {
    selected_user_id: profile.id,
    selected_user_label: userLabel,
    week_start: weekStartIso,
    week_end_exclusive: weekEndIso,
    plan_text: form.planText,
    parsed_plan_days: parsedPlanDays,
    actual_runs: actualRuns,
    weekly_summary: weeklySummary,
  }

  let aiOutput: CoachLabAiOutput | null = null
  let analysisError: string | null = null
  let model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL

  try {
    const result = await callOpenAiAnalysis(payload)
    aiOutput = result.aiOutput
    model = result.model
  } catch (error) {
    analysisError = error instanceof Error ? error.message : 'Unknown analysis error'
  }

  return {
    form,
    error: null,
    result: {
      userId: profile.id,
      userLabel,
      weekStart: form.weekStart,
      weekEndExclusive: parsedWeekEnd.toISOString().slice(0, 10),
      parsedPlanDays,
      actualRuns,
      weeklySummary,
      aiOutput,
      analysisError,
      debugPayload: {
        model,
        payload,
      },
    },
  }
}
