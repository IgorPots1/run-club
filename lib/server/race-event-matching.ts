import { createRaceEventCompletedAppEvent } from '@/lib/server/race-event-completion-events'
import {
  deriveRaceEventStatus,
  type RaceEventStatus,
  type RaceEventMatchConfidence,
} from '@/lib/race-events'
import type { SupabaseClient } from '@supabase/supabase-js'

type SupabaseAdminClient = SupabaseClient

type RaceEventMatchRow = {
  id: string
  user_id: string
  name: string
  race_date: string
  linked_run_id: string | null
  distance_meters: number | null
  result_time_seconds: number | null
  target_time_seconds: number | null
  status?: RaceEventStatus | null
  created_at: string
}

type RunMatchRow = {
  id: string
  user_id: string
  name: string | null
  title?: string | null
  created_at: string
  distance_km: number | null
  distance_meters: number | null
  moving_time_seconds: number | null
  duration_seconds?: number | null
  duration_minutes?: number | null
  sport_type?: string | null
}

type MatchCandidate = {
  raceEvent: RaceEventMatchRow
  run: RunMatchRow
  distanceDifferenceMeters: number
  dateDifferenceDays: number
  confidence: RaceEventMatchConfidence
}

export type RaceEventMatchingStats = {
  checked: number
  matched: number
  ambiguous: number
  noCandidate: number
  errors: number
}

export type RaceEventMatchingResult = RaceEventMatchingStats & {
  matches: Array<{ raceEventId: string; runId: string; confidence: RaceEventMatchConfidence }>
}

const RACE_EVENT_MATCH_SELECT = `
  id,
  user_id,
  name,
  race_date,
  linked_run_id,
  distance_meters,
  result_time_seconds,
  target_time_seconds,
  status,
  created_at
`

const RUN_MATCH_SELECT = `
  id,
  user_id,
  name,
  title,
  created_at,
  distance_km,
  distance_meters,
  moving_time_seconds,
  duration_seconds,
  duration_minutes,
  sport_type
`

const RACE_EVENT_COMPLETION_SELECT = `
  id,
  user_id,
  name,
  race_date,
  distance_meters,
  result_time_seconds,
  target_time_seconds,
  linked_run:runs!race_events_linked_run_id_fkey (
    id,
    name,
    title,
    distance_km,
    moving_time_seconds,
    created_at
  )
`

function getDateValueFromIsoString(value: string) {
  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return null
  }

  return parsedDate.toISOString().slice(0, 10)
}

function shiftDateValue(dateValue: string, days: number) {
  const parsedDate = new Date(`${dateValue}T12:00:00Z`)

  if (Number.isNaN(parsedDate.getTime())) {
    return null
  }

  parsedDate.setUTCDate(parsedDate.getUTCDate() + days)
  return parsedDate.toISOString().slice(0, 10)
}

function getDateDistanceDays(leftDateValue: string, rightDateValue: string) {
  const leftDate = new Date(`${leftDateValue}T12:00:00Z`)
  const rightDate = new Date(`${rightDateValue}T12:00:00Z`)

  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) {
    return Number.POSITIVE_INFINITY
  }

  return Math.round(Math.abs(leftDate.getTime() - rightDate.getTime()) / (24 * 60 * 60 * 1000))
}

function getRunDistanceMeters(run: RunMatchRow) {
  if (Number.isFinite(run.distance_meters) && (run.distance_meters ?? 0) > 0) {
    return Math.round(run.distance_meters ?? 0)
  }

  if (Number.isFinite(run.distance_km) && (run.distance_km ?? 0) > 0) {
    return Math.round(Number(run.distance_km ?? 0) * 1000)
  }

  return null
}

function getRunResultTimeSeconds(run: Pick<RunMatchRow, 'moving_time_seconds' | 'duration_seconds' | 'duration_minutes'>) {
  if (Number.isFinite(run.moving_time_seconds) && (run.moving_time_seconds ?? 0) > 0) {
    return Math.round(run.moving_time_seconds ?? 0)
  }

  if (Number.isFinite(run.duration_seconds) && (run.duration_seconds ?? 0) > 0) {
    return Math.round(run.duration_seconds ?? 0)
  }

  if (Number.isFinite(run.duration_minutes) && (run.duration_minutes ?? 0) > 0) {
    return Math.round(Number(run.duration_minutes ?? 0) * 60)
  }

  return null
}

function isRunningActivity(run: RunMatchRow) {
  const sportType = run.sport_type?.trim().toLowerCase()

  if (!sportType) {
    return true
  }

  return sportType.includes('run') || sportType.includes('running')
}

function getAllowedDistanceDifferenceMeters(raceDistanceMeters: number) {
  return Math.max(1, Math.min(Math.round(raceDistanceMeters * 0.1), 1500))
}

function getMatchConfidence(distanceDifferenceMeters: number, allowedDifferenceMeters: number, dateDifferenceDays: number): RaceEventMatchConfidence {
  if (dateDifferenceDays === 0 && distanceDifferenceMeters <= Math.max(100, Math.round(allowedDifferenceMeters * 0.35))) {
    return 'high'
  }

  return 'medium'
}

function findClearMatchForRaceEvent(raceEvent: RaceEventMatchRow, runs: RunMatchRow[]) {
  const raceDistanceMeters = Number(raceEvent.distance_meters ?? 0)

  if (!Number.isFinite(raceDistanceMeters) || raceDistanceMeters <= 0) {
    return { candidate: null, ambiguous: false }
  }

  const allowedDifferenceMeters = getAllowedDistanceDifferenceMeters(raceDistanceMeters)
  const candidates = runs
    .map((run): MatchCandidate | null => {
      const runDate = getDateValueFromIsoString(run.created_at)
      const runDistanceMeters = getRunDistanceMeters(run)

      if (!runDate || !runDistanceMeters || !isRunningActivity(run)) {
        return null
      }

      const dateDifferenceDays = getDateDistanceDays(raceEvent.race_date, runDate)
      const distanceDifferenceMeters = Math.abs(runDistanceMeters - raceDistanceMeters)

      if (dateDifferenceDays > 1 || distanceDifferenceMeters > allowedDifferenceMeters) {
        return null
      }

      return {
        raceEvent,
        run,
        dateDifferenceDays,
        distanceDifferenceMeters,
        confidence: getMatchConfidence(distanceDifferenceMeters, allowedDifferenceMeters, dateDifferenceDays),
      }
    })
    .filter((candidate): candidate is MatchCandidate => candidate !== null)
    .sort((left, right) => {
      if (left.dateDifferenceDays !== right.dateDifferenceDays) {
        return left.dateDifferenceDays - right.dateDifferenceDays
      }

      return left.distanceDifferenceMeters - right.distanceDifferenceMeters
    })

  const bestCandidate = candidates[0] ?? null
  const secondCandidate = candidates[1] ?? null

  if (!bestCandidate) {
    return { candidate: null, ambiguous: false }
  }

  if (
    secondCandidate &&
    secondCandidate.dateDifferenceDays === bestCandidate.dateDifferenceDays &&
    Math.abs(secondCandidate.distanceDifferenceMeters - bestCandidate.distanceDifferenceMeters) <= 100
  ) {
    return { candidate: null, ambiguous: true }
  }

  return { candidate: bestCandidate, ambiguous: false }
}

async function loadCandidateRaceEvents(params: {
  supabase: SupabaseAdminClient
  userId: string
  runDateValue?: string | null
}) {
  let query = params.supabase
    .from('race_events')
    .select(RACE_EVENT_MATCH_SELECT)
    .eq('user_id', params.userId)
    .is('linked_run_id', null)
    .neq('status', 'cancelled')
    .not('distance_meters', 'is', null)
    .order('race_date', { ascending: true })

  if (params.runDateValue) {
    const lowerBoundDate = shiftDateValue(params.runDateValue, -1)
    const upperBoundDate = shiftDateValue(params.runDateValue, 1)

    if (lowerBoundDate && upperBoundDate) {
      query = query.gte('race_date', lowerBoundDate).lte('race_date', upperBoundDate)
    }
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return (data as RaceEventMatchRow[] | null) ?? []
}

async function loadCandidateRuns(params: {
  supabase: SupabaseAdminClient
  userId: string
  runId?: string | null
}) {
  let query = params.supabase
    .from('runs')
    .select(RUN_MATCH_SELECT)
    .eq('user_id', params.userId)
    .not('distance_meters', 'is', null)
    .order('created_at', { ascending: false })

  if (params.runId) {
    query = query.eq('id', params.runId)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return ((data as RunMatchRow[] | null) ?? []).filter(isRunningActivity)
}

async function loadUnavailableRunIds(params: {
  supabase: SupabaseAdminClient
  userId: string
}) {
  const { data, error } = await params.supabase
    .from('race_events')
    .select('linked_run_id')
    .eq('user_id', params.userId)
    .not('linked_run_id', 'is', null)

  if (error) {
    throw error
  }

  return new Set(
    ((data as Array<{ linked_run_id: string | null }> | null) ?? [])
      .map((row) => row.linked_run_id)
      .filter((linkedRunId): linkedRunId is string => typeof linkedRunId === 'string' && linkedRunId.length > 0)
  )
}

async function emitCompletedEventForRaceEvent(supabase: SupabaseAdminClient, raceEventId: string) {
  const { data, error } = await supabase
    .from('race_events')
    .select(RACE_EVENT_COMPLETION_SELECT)
    .eq('id', raceEventId)
    .maybeSingle()

  if (error || !data) {
    if (error) {
      throw error
    }

    return
  }

  await createRaceEventCompletedAppEvent(data as Parameters<typeof createRaceEventCompletedAppEvent>[0])
}

export async function matchRaceEventsForUser(params: {
  supabase?: SupabaseAdminClient
  userId: string
  runId?: string | null
  dryRun?: boolean
  emitEvents?: boolean
}): Promise<RaceEventMatchingResult> {
  const supabase = params.supabase
  if (!supabase) {
    throw new Error('race_event_matching_supabase_required')
  }
  const dryRun = params.dryRun === true
  const emitEvents = params.emitEvents !== false
  const stats: RaceEventMatchingResult = {
    checked: 0,
    matched: 0,
    ambiguous: 0,
    noCandidate: 0,
    errors: 0,
    matches: [],
  }

  try {
    const unavailableRunIds = await loadUnavailableRunIds({
      supabase,
      userId: params.userId,
    })
    const runs = await loadCandidateRuns({
      supabase,
      userId: params.userId,
      runId: params.runId ?? null,
    })
    const runDateValue = params.runId && runs[0] ? getDateValueFromIsoString(runs[0].created_at) : null
    const raceEvents = await loadCandidateRaceEvents({
      supabase,
      userId: params.userId,
      runDateValue,
    })

    stats.checked = raceEvents.length

    for (const raceEvent of raceEvents) {
      const availableRuns = runs.filter((run) => !unavailableRunIds.has(run.id))
      const { candidate, ambiguous } = findClearMatchForRaceEvent(raceEvent, availableRuns)

      if (ambiguous) {
        stats.ambiguous += 1
        continue
      }

      if (!candidate) {
        const nextStatus = deriveRaceEventStatus(raceEvent)

        if (nextStatus === 'completed_unlinked' && !dryRun) {
          const { error } = await supabase
            .from('race_events')
            .update({ status: 'completed_unlinked' })
            .eq('id', raceEvent.id)
            .eq('user_id', params.userId)
            .is('linked_run_id', null)
            .neq('status', 'cancelled')

          if (error) {
            stats.errors += 1
          }
        }

        stats.noCandidate += 1
        continue
      }

      stats.matches.push({
        raceEventId: candidate.raceEvent.id,
        runId: candidate.run.id,
        confidence: candidate.confidence,
      })
      stats.matched += 1

      if (dryRun) {
        unavailableRunIds.add(candidate.run.id)
        continue
      }

      const resultTimeSeconds = getRunResultTimeSeconds(candidate.run)
      const { error } = await supabase
        .from('race_events')
        .update({
          linked_run_id: candidate.run.id,
          status: 'completed_linked',
          matched_at: new Date().toISOString(),
          match_source: 'auto',
          match_confidence: candidate.confidence,
          result_time_seconds: resultTimeSeconds,
        })
        .eq('id', candidate.raceEvent.id)
        .eq('user_id', params.userId)
        .is('linked_run_id', null)
        .neq('status', 'cancelled')
        .is('match_source', null)

      if (error) {
        stats.errors += 1
        continue
      }

      unavailableRunIds.add(candidate.run.id)

      if (emitEvents) {
        try {
          await emitCompletedEventForRaceEvent(supabase, candidate.raceEvent.id)
        } catch (eventError) {
          stats.errors += 1
          console.warn('Race event completion app event failed', {
            userId: params.userId,
            raceEventId: candidate.raceEvent.id,
            runId: candidate.run.id,
            error: eventError instanceof Error ? eventError.message : 'unknown_error',
          })
        }
      }
    }
  } catch (error) {
    stats.errors += 1
    console.warn('Race event matching failed', {
      userId: params.userId,
      runId: params.runId ?? null,
      error: error instanceof Error ? error.message : 'unknown_error',
    })
  }

  return stats
}

export async function matchRaceEventsForRun(params: {
  supabase?: SupabaseAdminClient
  userId: string
  runId: string
}) {
  return matchRaceEventsForUser({
    supabase: params.supabase,
    userId: params.userId,
    runId: params.runId,
  })
}
