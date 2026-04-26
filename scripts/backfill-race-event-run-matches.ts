import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type RaceEventRow = {
  id: string
  user_id: string
  name: string
  race_date: string
  distance_meters: number | null
  target_time_seconds: number | null
}

type RunRow = {
  id: string
  user_id: string
  name: string | null
  title: string | null
  created_at: string
  distance_km: number | null
  distance_meters: number | null
  moving_time_seconds: number | null
  duration_seconds: number | null
  duration_minutes: number | null
  sport_type: string | null
}

type Candidate = {
  run: RunRow
  distanceDiff: number
  dateDiff: number
  confidence: 'high' | 'medium'
}

type Totals = {
  checked: number
  matched: number
  ambiguous: number
  noCandidate: number
  errors: number
}

const APPLY_FLAG = '--apply'

function getSupabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
}

function createSupabaseAdminClient() {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function dateValueFromIso(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

function dateDiffDays(left: string, right: string) {
  const leftDate = new Date(`${left}T12:00:00Z`)
  const rightDate = new Date(`${right}T12:00:00Z`)

  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) {
    return Number.POSITIVE_INFINITY
  }

  return Math.round(Math.abs(leftDate.getTime() - rightDate.getTime()) / 86_400_000)
}

function runDistanceMeters(run: RunRow) {
  if (Number.isFinite(run.distance_meters) && (run.distance_meters ?? 0) > 0) {
    return Math.round(run.distance_meters ?? 0)
  }

  if (Number.isFinite(run.distance_km) && (run.distance_km ?? 0) > 0) {
    return Math.round(Number(run.distance_km ?? 0) * 1000)
  }

  return null
}

function runTimeSeconds(run: RunRow) {
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

function isRunningRun(run: RunRow) {
  const sportType = run.sport_type?.trim().toLowerCase()
  return !sportType || sportType.includes('run') || sportType.includes('running')
}

function formatClock(totalSeconds: number | null) {
  if (!Number.isFinite(totalSeconds) || (totalSeconds ?? 0) < 0) {
    return null
  }

  const seconds = Math.round(totalSeconds ?? 0)
  return [
    String(Math.floor(seconds / 3600)).padStart(2, '0'),
    String(Math.floor((seconds % 3600) / 60)).padStart(2, '0'),
    String(seconds % 60).padStart(2, '0'),
  ].join(':')
}

function findCandidate(raceEvent: RaceEventRow, runs: RunRow[]) {
  const raceDistance = Number(raceEvent.distance_meters ?? 0)
  const allowedDiff = Math.max(1, Math.min(Math.round(raceDistance * 0.1), 1500))
  const candidates = runs
    .map((run): Candidate | null => {
      const runDate = dateValueFromIso(run.created_at)
      const distance = runDistanceMeters(run)

      if (!runDate || !distance || !isRunningRun(run)) {
        return null
      }

      const dateDiff = dateDiffDays(raceEvent.race_date, runDate)
      const distanceDiff = Math.abs(distance - raceDistance)

      if (dateDiff > 1 || distanceDiff > allowedDiff) {
        return null
      }

      return {
        run,
        dateDiff,
        distanceDiff,
        confidence: dateDiff === 0 && distanceDiff <= Math.max(100, Math.round(allowedDiff * 0.35)) ? 'high' : 'medium',
      }
    })
    .filter((candidate): candidate is Candidate => candidate !== null)
    .sort((left, right) => left.dateDiff - right.dateDiff || left.distanceDiff - right.distanceDiff)

  if (!candidates[0]) {
    return { candidate: null, ambiguous: false }
  }

  if (
    candidates[1] &&
    candidates[1].dateDiff === candidates[0].dateDiff &&
    Math.abs(candidates[1].distanceDiff - candidates[0].distanceDiff) <= 100
  ) {
    return { candidate: null, ambiguous: true }
  }

  return { candidate: candidates[0], ambiguous: false }
}

async function createCompletionEvent(supabase: SupabaseClient, raceEvent: RaceEventRow, run: RunRow, resultTimeSeconds: number | null) {
  const resultLabel = formatClock(resultTimeSeconds)
  const { error } = await supabase
    .from('app_events')
    .insert({
      type: 'race_event.completed',
      actor_user_id: raceEvent.user_id,
      target_user_id: null,
      entity_type: 'race_event',
      entity_id: raceEvent.id,
      category: 'race',
      channel: null,
      priority: 'normal',
      target_path: `/races/${raceEvent.id}`,
      dedupe_key: `race_event.completed:${raceEvent.id}`,
      payload: {
        v: 1,
        targetPath: `/races/${raceEvent.id}`,
        preview: {
          title: 'Старт завершен',
          body: resultLabel ? `${raceEvent.name} • ${resultLabel}` : raceEvent.name,
        },
        context: {
          raceEventId: raceEvent.id,
          raceName: raceEvent.name,
          raceDate: raceEvent.race_date,
          distanceMeters: raceEvent.distance_meters,
          resultTimeSeconds,
          targetTimeSeconds: raceEvent.target_time_seconds,
          linkedRunId: run.id,
          linkedRunName: run.name?.trim() || run.title?.trim() || null,
          linkedRunDistanceKm: run.distance_km,
          linkedRunMovingTimeSeconds: run.moving_time_seconds,
          linkedRunCreatedAt: run.created_at,
        },
      },
    })

  if (error && error.code !== '23505') {
    throw error
  }
}

async function main() {
  const apply = process.argv.includes(APPLY_FLAG)
  const supabase = createSupabaseAdminClient()
  const totals: Totals = { checked: 0, matched: 0, ambiguous: 0, noCandidate: 0, errors: 0 }

  const { data: raceEvents, error: raceEventsError } = await supabase
    .from('race_events')
    .select('id, user_id, name, race_date, distance_meters, target_time_seconds')
    .is('linked_run_id', null)
    .neq('status', 'cancelled')
    .lt('race_date', new Date().toISOString().slice(0, 10))
    .not('distance_meters', 'is', null)
    .order('user_id', { ascending: true })
    .order('race_date', { ascending: true })

  if (raceEventsError) {
    throw raceEventsError
  }

  const events = (raceEvents as RaceEventRow[] | null) ?? []
  totals.checked = events.length
  const userIds = Array.from(new Set(events.map((event) => event.user_id)))
  const runsByUserId = new Map<string, RunRow[]>()

  for (const userId of userIds) {
    const { data: runs, error } = await supabase
      .from('runs')
      .select('id, user_id, name, title, created_at, distance_km, distance_meters, moving_time_seconds, duration_seconds, duration_minutes, sport_type')
      .eq('user_id', userId)
      .not('distance_meters', 'is', null)

    if (error) {
      totals.errors += 1
      runsByUserId.set(userId, [])
      continue
    }

    runsByUserId.set(userId, (runs as RunRow[] | null) ?? [])
  }

  for (const raceEvent of events) {
    const { candidate, ambiguous } = findCandidate(raceEvent, runsByUserId.get(raceEvent.user_id) ?? [])

    if (ambiguous) {
      totals.ambiguous += 1
      continue
    }

    if (!candidate) {
      totals.noCandidate += 1
      if (apply) {
        const { error } = await supabase
          .from('race_events')
          .update({ status: 'completed_unlinked' })
          .eq('id', raceEvent.id)
          .is('linked_run_id', null)

        if (error) {
          totals.errors += 1
        }
      }
      continue
    }

    totals.matched += 1

    if (!apply) {
      continue
    }

    const resultTimeSeconds = runTimeSeconds(candidate.run)
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
      .eq('id', raceEvent.id)
      .is('linked_run_id', null)
      .neq('status', 'cancelled')
      .is('match_source', null)

    if (error) {
      totals.errors += 1
      continue
    }

    await createCompletionEvent(supabase, raceEvent, candidate.run, resultTimeSeconds).catch(() => {
      totals.errors += 1
    })
  }

  console.info(`mode: ${apply ? 'apply' : 'dry-run'}`)
  console.info(`total race_events checked: ${totals.checked}`)
  console.info(`matched: ${totals.matched}`)
  console.info(`ambiguous: ${totals.ambiguous}`)
  console.info(`no candidate: ${totals.noCandidate}`)
  console.info(`errors: ${totals.errors}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
