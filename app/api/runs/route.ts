import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { applyRunToShoe } from '@/lib/run-shoe-impact'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type CreateRunRequestBody = {
  name?: string | null
  title?: string | null
  distanceKm?: number | null
  distanceMeters?: number | null
  durationMinutes?: number | null
  durationSeconds?: number | null
  movingTimeSeconds?: number | null
  elapsedTimeSeconds?: number | null
  averagePaceSeconds?: number | null
  createdAt?: string | null
  xp?: number | null
  shoeId?: string | null
}

export async function GET() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        ok: false,
        step: 'auth_required',
        error: error?.message ?? null,
      },
      { status: 401 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const { data, error: runsError } = await supabaseAdmin
    .from('runs')
    .select('id, user_id, name, title, distance_km, duration_minutes, duration_seconds, xp, created_at, external_source')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  if (runsError) {
    return NextResponse.json(
      {
        ok: false,
        step: 'runs_load_failed',
        error: runsError.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    runs: data ?? [],
  })
}

export async function POST(request: Request) {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        ok: false,
        step: 'auth_required',
        error: error?.message ?? null,
      },
      { status: 401 }
    )
  }

  const body = await request.json().catch(() => null) as CreateRunRequestBody | null
  const name = body?.name?.trim() || body?.title?.trim() || 'Бег'
  const title = body?.title?.trim() || name
  const distanceKm = Number(body?.distanceKm ?? 0)
  const distanceMeters = Math.max(0, Math.round(Number(body?.distanceMeters ?? 0)))
  const durationMinutes = Math.max(0, Math.round(Number(body?.durationMinutes ?? 0)))
  const durationSeconds = Math.max(0, Math.round(Number(body?.durationSeconds ?? 0)))
  const movingTimeSeconds = Math.max(0, Math.round(Number(body?.movingTimeSeconds ?? 0)))
  const elapsedTimeSeconds = Math.max(0, Math.round(Number(body?.elapsedTimeSeconds ?? 0)))
  const averagePaceSeconds = Math.max(0, Math.round(Number(body?.averagePaceSeconds ?? 0)))
  const xp = Math.max(0, Math.round(Number(body?.xp ?? 0)))
  const createdAt = typeof body?.createdAt === 'string' ? body.createdAt : ''
  const shoeId = body?.shoeId?.trim() || null

  if (
    !Number.isFinite(distanceKm) ||
    distanceKm <= 0 ||
    !Number.isFinite(distanceMeters) ||
    distanceMeters <= 0 ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !createdAt
  ) {
    return NextResponse.json(
      {
        ok: false,
        step: 'validation_failed',
        error: 'invalid_run_payload',
      },
      { status: 400 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const insertPayload = {
    user_id: user.id,
    name,
    title,
    distance_km: distanceKm,
    distance_meters: distanceMeters,
    duration_minutes: durationMinutes,
    duration_seconds: durationSeconds,
    moving_time_seconds: movingTimeSeconds,
    elapsed_time_seconds: elapsedTimeSeconds,
    average_pace_seconds: averagePaceSeconds,
    created_at: createdAt,
    xp,
    shoe_id: shoeId,
  }

  const { data: insertedRun, error: insertError } = await supabaseAdmin
    .from('runs')
    .insert(insertPayload)
    .select('id')
    .single()

  if (insertError) {
    return NextResponse.json(
      {
        ok: false,
        step: 'run_create_failed',
        error: insertError.message,
      },
      { status: 500 }
    )
  }

  let shoeWearTrigger: Awaited<ReturnType<typeof applyRunToShoe>> = null

  try {
    shoeWearTrigger = await applyRunToShoe(supabaseAdmin, {
      userId: user.id,
      shoeId,
      distanceMeters,
    })
  } catch (shoeImpactError) {
    await supabaseAdmin.from('runs').delete().eq('id', insertedRun.id).eq('user_id', user.id)

    return NextResponse.json(
      {
        ok: false,
        step: 'shoe_impact_failed',
        error: shoeImpactError instanceof Error ? shoeImpactError.message : 'shoe_impact_failed',
      },
      { status: 500 }
    )
  }

  return NextResponse.json(
    {
      ok: true,
      run: {
        id: insertedRun.id,
      },
      shoeWearMessage: shoeWearTrigger?.message ?? null,
    },
    { status: 201 }
  )
}
