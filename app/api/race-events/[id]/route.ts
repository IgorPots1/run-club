import { after, NextResponse } from 'next/server'
import { createAppEvent } from '@/lib/events/createAppEvent'
import { buildRaceEventCompletedEvent } from '@/lib/events/returnTriggerEvents'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type RaceEventRequestBody = {
  name?: string | null
  raceDate?: string | null
  linkedRunId?: string | null
  distanceMeters?: number | null
  resultTimeSeconds?: number | null
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
  created_at,
  linked_run:runs!race_events_linked_run_id_fkey (
    id,
    name,
    title,
    distance_km,
    moving_time_seconds,
    created_at
  )
`

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
    .select('id')
    .eq('id', linkedRunId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    return { exists: false, error }
  }

  return { exists: Boolean(data) }
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

  const { data, error: updateError } = await supabaseAdmin
    .from('race_events')
    .update({
      name,
      race_date: raceDate,
      linked_run_id: linkedRunId,
      distance_meters: distanceMeters,
      result_time_seconds: resultTimeSeconds,
    })
    .eq('id', raceEventId)
    .eq('user_id', user.id)
    .select(RACE_EVENT_SELECT)
    .single()

  if (updateError) {
    return NextResponse.json(
      {
        ok: false,
        error: updateError.message,
      },
      { status: 500 }
    )
  }

  const hadCompletionSignal = hasRaceCompletionSignal(existingRaceEvent)
  const hasCompletionSignal = hasRaceCompletionSignal(data)

  if (!hadCompletionSignal && hasCompletionSignal) {
    after(async () => {
      try {
        const linkedRun = Array.isArray(data.linked_run) ? (data.linked_run[0] ?? null) : (data.linked_run ?? null)

        await createAppEvent(
          buildRaceEventCompletedEvent({
            actorUserId: user.id,
            raceEventId: data.id,
            raceName: data.name,
            raceDate: data.race_date,
            resultTimeSeconds: data.result_time_seconds,
            linkedRun: linkedRun ? {
              id: linkedRun.id,
              name: linkedRun.name,
              title: linkedRun.title,
              distanceKm: linkedRun.distance_km,
              movingTimeSeconds: linkedRun.moving_time_seconds,
              createdAt: linkedRun.created_at,
            } : null,
          })
        )
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
