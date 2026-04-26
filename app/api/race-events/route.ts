import { after, NextResponse } from 'next/server'
import { createAppEvent } from '@/lib/events/createAppEvent'
import { buildRaceEventCreatedEvent } from '@/lib/events/returnTriggerEvents'
import { createRaceEventCompletedAppEvent } from '@/lib/server/race-event-completion-events'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type RaceEventRequestBody = {
  name?: string | null
  raceDate?: string | null
  linkedRunId?: string | null
  distanceMeters?: number | null
  resultTimeSeconds?: number | null
  targetTimeSeconds?: number | null
}

const RACE_EVENT_SELECT = `
  id,
  user_id,
  name,
  race_date,
  linked_run_id,
  distance_meters,
  result_time_seconds,
  target_time_seconds,
  status,
  cancelled_at,
  matched_at,
  match_source,
  match_confidence,
  created_at,
  linked_run:runs!race_events_linked_run_id_fkey (
    id,
    name,
    title,
    distance_km,
    moving_time_seconds,
    duration_seconds,
    duration_minutes,
    created_at
  )
`

function getRunResultTimeSeconds(run: {
  moving_time_seconds?: number | null
  duration_seconds?: number | null
  duration_minutes?: number | null
} | null | undefined) {
  if (Number.isFinite(run?.moving_time_seconds) && (run?.moving_time_seconds ?? 0) > 0) {
    return Math.round(run?.moving_time_seconds ?? 0)
  }

  if (Number.isFinite(run?.duration_seconds) && (run?.duration_seconds ?? 0) > 0) {
    return Math.round(run?.duration_seconds ?? 0)
  }

  if (Number.isFinite(run?.duration_minutes) && (run?.duration_minutes ?? 0) > 0) {
    return Math.round(Number(run?.duration_minutes ?? 0) * 60)
  }

  return null
}

async function loadLinkedRunIfOwned(supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>, userId: string, linkedRunId: string | null) {
  if (!linkedRunId) {
    return { exists: true }
  }

  const { data, error } = await supabaseAdmin
    .from('runs')
    .select('id, moving_time_seconds, duration_seconds, duration_minutes')
    .eq('id', linkedRunId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    return { exists: false, error }
  }

  return { exists: Boolean(data), run: data ?? null }
}

export async function GET() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? 'auth_required',
      },
      { status: 401 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const { data, error: loadError } = await supabaseAdmin
    .from('race_events')
    .select(RACE_EVENT_SELECT)
    .eq('user_id', user.id)
    .order('race_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (loadError) {
    return NextResponse.json(
      {
        ok: false,
        error: loadError.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    raceEvents: data ?? [],
  })
}

export async function POST(request: Request) {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? 'auth_required',
      },
      { status: 401 }
    )
  }

  const body = await request.json().catch(() => null) as RaceEventRequestBody | null
  const name = body?.name?.trim() ?? ''
  const raceDate = body?.raceDate?.trim() ?? ''
  const linkedRunId = body?.linkedRunId?.trim() || null
  const distanceMeters =
    typeof body?.distanceMeters === 'number' && Number.isFinite(body.distanceMeters) && body.distanceMeters >= 0
      ? Math.round(body.distanceMeters)
      : null
  const resultTimeSeconds =
    typeof body?.resultTimeSeconds === 'number' && Number.isFinite(body.resultTimeSeconds) && body.resultTimeSeconds >= 0
      ? Math.round(body.resultTimeSeconds)
      : null
  const targetTimeSeconds =
    typeof body?.targetTimeSeconds === 'number' && Number.isFinite(body.targetTimeSeconds) && body.targetTimeSeconds >= 0
      ? Math.round(body.targetTimeSeconds)
      : null

  if (!name || !raceDate) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_race_event_payload',
      },
      { status: 400 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const linkedRunLookup = await loadLinkedRunIfOwned(supabaseAdmin, user.id, linkedRunId)

  if ('error' in linkedRunLookup && linkedRunLookup.error) {
    return NextResponse.json(
      {
        ok: false,
        error: linkedRunLookup.error.message,
      },
      { status: 500 }
    )
  }

  if (!linkedRunLookup.exists) {
    return NextResponse.json(
      {
        ok: false,
        error: 'linked_run_not_found',
      },
      { status: 400 }
    )
  }

  const derivedResultTimeSeconds = resultTimeSeconds ?? getRunResultTimeSeconds(linkedRunLookup.run)

  const { data, error: insertError } = await supabaseAdmin
    .from('race_events')
    .insert({
      user_id: user.id,
      name,
      race_date: raceDate,
      linked_run_id: linkedRunId,
      distance_meters: distanceMeters,
      result_time_seconds: derivedResultTimeSeconds,
      target_time_seconds: targetTimeSeconds,
      status: linkedRunId ? 'completed_linked' : (raceDate < new Date().toISOString().slice(0, 10) ? 'completed_unlinked' : 'upcoming'),
      matched_at: linkedRunId ? new Date().toISOString() : null,
      match_source: linkedRunId ? 'manual' : null,
      match_confidence: linkedRunId ? 'manual' : null,
    })
    .select(RACE_EVENT_SELECT)
    .single()

  if (insertError) {
    return NextResponse.json(
      {
        ok: false,
        error: insertError.message,
      },
      { status: 500 }
    )
  }

  after(async () => {
    try {
      await createAppEvent(
        buildRaceEventCreatedEvent({
          actorUserId: user.id,
          raceEventId: data.id,
          raceName: data.name,
          raceDate: data.race_date,
          distanceMeters: data.distance_meters,
          targetTimeSeconds: data.target_time_seconds,
        })
      )
    } catch (error) {
      console.error('Failed to create race_event.created app event', {
        raceEventId: data.id,
        actorUserId: user.id,
        error: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  })

  if (linkedRunId) {
    after(async () => {
      try {
        await createRaceEventCompletedAppEvent(data)
      } catch (error) {
        console.error('Failed to create race_event.completed app event', {
          raceEventId: data.id,
          actorUserId: user.id,
          error: error instanceof Error ? error.message : 'unknown_error',
        })
      }
    })
  }

  return NextResponse.json(
    {
      ok: true,
      raceEvent: data,
    },
    { status: 201 }
  )
}
