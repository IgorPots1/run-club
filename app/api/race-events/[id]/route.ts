import { after, NextResponse } from 'next/server'
import { cleanupEntityAppEvents } from '@/lib/events/createAppEvent'
import { deriveRaceEventStatus } from '@/lib/race-events'
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

function hasRaceCompletionSignal(raceEvent: {
  linked_run_id?: string | null
  result_time_seconds?: number | null
}) {
  return Boolean(
    raceEvent.linked_run_id ||
    (Number.isFinite(raceEvent.result_time_seconds) && (raceEvent.result_time_seconds ?? 0) >= 0)
  )
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

function buildLinkedRunConflictResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: 'linked_run_already_linked_to_another_race_event',
    },
    { status: 409 }
  )
}

function isLinkedRunUniqueViolation(error: {
  code?: string | null
  message?: string | null
} | null | undefined) {
  return (
    error?.code === '23505' &&
    (
      error.message?.includes('race_events_linked_run_id_unique_idx') ||
      error.message?.includes('linked_run_id')
    )
  )
}

async function loadOwnedRaceEvent(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  raceEventId: string,
  userId: string
) {
  return supabaseAdmin
    .from('race_events')
    .select(RACE_EVENT_SELECT)
    .eq('id', raceEventId)
    .eq('user_id', userId)
    .maybeSingle()
}

async function loadRaceEventById(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  raceEventId: string
) {
  return supabaseAdmin
    .from('race_events')
    .select(RACE_EVENT_SELECT)
    .eq('id', raceEventId)
    .maybeSingle()
}

async function loadLinkedRunIfOwned(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  linkedRunId: string | null
) {
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

async function loadLinkedRunConflict(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  linkedRunId: string | null,
  raceEventIdToExclude: string
) {
  if (!linkedRunId) {
    return { conflict: null }
  }

  const { data, error } = await supabaseAdmin
    .from('race_events')
    .select('id')
    .eq('linked_run_id', linkedRunId)
    .neq('id', raceEventIdToExclude)
    .limit(1)

  if (error) {
    return { conflict: null, error }
  }

  return {
    conflict: Array.isArray(data) ? (data[0] ?? null) : null,
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
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

  const { id: raceEventId } = await context.params
  const supabaseAdmin = createSupabaseAdminClient()
  const { data: existingRaceEvent, error: loadError } = await loadRaceEventById(supabaseAdmin, raceEventId)

  if (loadError) {
    return NextResponse.json(
      {
        ok: false,
        error: loadError.message,
      },
      { status: 500 }
    )
  }

  if (!existingRaceEvent) {
    return NextResponse.json(
      {
        ok: false,
        error: 'race_event_not_found',
      },
      { status: 404 }
    )
  }

  return NextResponse.json({
    ok: true,
    raceEvent: existingRaceEvent,
  })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
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

  const { id: raceEventId } = await context.params
  const supabaseAdmin = createSupabaseAdminClient()
  const { data: existingRaceEvent, error: loadError } = await loadOwnedRaceEvent(supabaseAdmin, raceEventId, user.id)

  if (loadError) {
    return NextResponse.json(
      {
        ok: false,
        error: loadError.message,
      },
      { status: 500 }
    )
  }

  if (!existingRaceEvent) {
    return NextResponse.json(
      {
        ok: false,
        error: 'race_event_not_found',
      },
      { status: 404 }
    )
  }

  const body = await request.json().catch(() => null) as RaceEventRequestBody | null
  const name = body?.name?.trim() ?? ''
  const raceDate = body?.raceDate?.trim() ?? ''
  const linkedRunId = body?.linkedRunId?.trim() || null
  const distanceMeters =
    body && Object.prototype.hasOwnProperty.call(body, 'distanceMeters')
      ? (
        typeof body.distanceMeters === 'number' &&
        Number.isFinite(body.distanceMeters) &&
        body.distanceMeters >= 0
          ? Math.round(body.distanceMeters)
          : null
      )
      : (existingRaceEvent?.distance_meters ?? null)
  const resultTimeSeconds =
    body && Object.prototype.hasOwnProperty.call(body, 'resultTimeSeconds')
      ? (
        typeof body.resultTimeSeconds === 'number' &&
        Number.isFinite(body.resultTimeSeconds) &&
        body.resultTimeSeconds >= 0
          ? Math.round(body.resultTimeSeconds)
          : null
      )
      : (existingRaceEvent?.result_time_seconds ?? null)
  const targetTimeSeconds =
    body && Object.prototype.hasOwnProperty.call(body, 'targetTimeSeconds')
      ? (
        typeof body.targetTimeSeconds === 'number' &&
        Number.isFinite(body.targetTimeSeconds) &&
        body.targetTimeSeconds >= 0
          ? Math.round(body.targetTimeSeconds)
          : null
      )
      : (existingRaceEvent?.target_time_seconds ?? null)

  if (!name || !raceDate) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_race_event_payload',
      },
      { status: 400 }
    )
  }

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

  const linkedRunConflict = await loadLinkedRunConflict(supabaseAdmin, linkedRunId, raceEventId)

  if ('error' in linkedRunConflict && linkedRunConflict.error) {
    return NextResponse.json(
      {
        ok: false,
        error: linkedRunConflict.error.message,
      },
      { status: 500 }
    )
  }

  if (linkedRunConflict.conflict) {
    return buildLinkedRunConflictResponse()
  }

  const wasLinked = Boolean(existingRaceEvent.linked_run_id)
  const isLinked = Boolean(linkedRunId)
  const derivedResultTimeSeconds = isLinked
    ? (resultTimeSeconds ?? getRunResultTimeSeconds(linkedRunLookup.run))
    : resultTimeSeconds
  const nextStatus = isLinked
    ? 'completed_linked'
    : deriveRaceEventStatus({
      status: null,
      race_date: raceDate,
      linked_run_id: null,
    })
  const nowIso = new Date().toISOString()

  const { data, error: updateError } = await supabaseAdmin
    .from('race_events')
    .update({
      name,
      race_date: raceDate,
      linked_run_id: linkedRunId,
      distance_meters: distanceMeters,
      result_time_seconds: derivedResultTimeSeconds,
      target_time_seconds: targetTimeSeconds,
      status: nextStatus,
      matched_at: isLinked ? nowIso : null,
      match_source: isLinked ? 'manual' : null,
      match_confidence: isLinked ? 'manual' : null,
    })
    .eq('id', raceEventId)
    .eq('user_id', user.id)
    .select(RACE_EVENT_SELECT)
    .single()

  if (updateError) {
    if (isLinkedRunUniqueViolation(updateError)) {
      return buildLinkedRunConflictResponse()
    }

    return NextResponse.json(
      {
        ok: false,
        error: updateError.message,
      },
      { status: 500 }
    )
  }

  const hadCompletionSignal = hasRaceCompletionSignal(existingRaceEvent) || wasLinked
  const hasCompletionSignal = hasRaceCompletionSignal(data) || isLinked
  const shouldSyncCompletedAppEvent =
    data.status !== 'cancelled' &&
    (hadCompletionSignal || hasCompletionSignal || wasLinked || isLinked)

  if (shouldSyncCompletedAppEvent) {
    after(async () => {
      try {
        await createRaceEventCompletedAppEvent(data, {
          createIfMissing: isLinked,
        })
      } catch (error) {
        console.error('Failed to create race_event.completed app event', {
          raceEventId: data.id,
          actorUserId: user.id,
          error: error instanceof Error ? error.message : 'unknown_error',
        })
      }
    })
  }

  return NextResponse.json({
    ok: true,
    raceEvent: data,
  })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
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

  const { id: raceEventId } = await context.params
  const supabaseAdmin = createSupabaseAdminClient()
  const { data: existingRaceEvent, error: loadError } = await loadOwnedRaceEvent(supabaseAdmin, raceEventId, user.id)

  if (loadError) {
    return NextResponse.json(
      {
        ok: false,
        error: loadError.message,
      },
      { status: 500 }
    )
  }

  if (!existingRaceEvent) {
    return NextResponse.json(
      {
        ok: false,
        error: 'race_event_not_found',
      },
      { status: 404 }
    )
  }

  const { error: deleteAppEventsError } = await cleanupEntityAppEvents(
    'race_event',
    raceEventId,
    supabaseAdmin
  )

  if (deleteAppEventsError) {
    return NextResponse.json(
      {
        ok: false,
        error: deleteAppEventsError.message,
      },
      { status: 500 }
    )
  }

  const { error: deleteError } = await supabaseAdmin
    .from('race_events')
    .delete()
    .eq('id', raceEventId)
    .eq('user_id', user.id)

  if (deleteError) {
    return NextResponse.json(
      {
        ok: false,
        error: deleteError.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
  })
}
