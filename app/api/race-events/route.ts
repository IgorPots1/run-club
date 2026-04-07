import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type RaceEventRequestBody = {
  name?: string | null
  raceDate?: string | null
  linkedRunId?: string | null
}

const RACE_EVENT_SELECT = `
  id,
  user_id,
  name,
  race_date,
  linked_run_id,
  created_at,
  linked_run:runs!race_events_linked_run_id_fkey (
    id,
    name,
    title,
    distance_km,
    created_at
  )
`

async function loadLinkedRunIfOwned(supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>, userId: string, linkedRunId: string | null) {
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

  const { data, error: insertError } = await supabaseAdmin
    .from('race_events')
    .insert({
      user_id: user.id,
      name,
      race_date: raceDate,
      linked_run_id: linkedRunId,
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

  return NextResponse.json(
    {
      ok: true,
      raceEvent: data,
    },
    { status: 201 }
  )
}
