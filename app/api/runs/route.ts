import { NextResponse } from 'next/server'
import {
  markRunPrNeedsRecompute,
  upsertPersonalRecordForLocalRunIfEligible,
} from '@/lib/personal-records'
import { loadProfileTotalXp } from '@/lib/profile-total-xp'
import { buildPersistedRunXpBreakdown, calculateRunXp } from '@/lib/run-xp'
import { matchRaceEventsForRun } from '@/lib/server/race-event-matching'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { applyRunToShoe } from '@/lib/run-shoe-impact'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { getLevelFromXP } from '@/lib/xp'

const MANUAL_RUN_DUPLICATE_WINDOW_SECONDS = 60

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
  shoeId?: string | null
}

type ManualRunCreateRpcResult = {
  run_id?: string | null
  was_created?: boolean | null
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
  const previousTotalXp = await loadProfileTotalXp(user.id, {
    supabase: supabaseAdmin,
  })
  const runXp = await calculateRunXp({
    userId: user.id,
    createdAt,
    distanceKm,
    supabase: supabaseAdmin,
  })

  const { data: rpcRows, error: insertError } = await supabaseAdmin.rpc(
    'create_manual_run_if_not_duplicate',
    {
      p_user_id: user.id,
      p_name: name,
      p_title: title,
      p_distance_km: distanceKm,
      p_distance_meters: distanceMeters,
      p_duration_minutes: durationMinutes,
      p_duration_seconds: durationSeconds,
      p_moving_time_seconds: movingTimeSeconds,
      p_elapsed_time_seconds: elapsedTimeSeconds,
      p_average_pace_seconds: averagePaceSeconds,
      p_created_at: createdAt,
      p_xp: runXp.xp,
      p_xp_breakdown: buildPersistedRunXpBreakdown(runXp),
      p_shoe_id: shoeId,
      p_duplicate_window_seconds: MANUAL_RUN_DUPLICATE_WINDOW_SECONDS,
    }
  )

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

  const insertedRun = ((rpcRows as ManualRunCreateRpcResult[] | null) ?? [])[0] ?? null
  const insertedRunId = insertedRun?.run_id ?? null

  if (!insertedRunId) {
    return NextResponse.json(
      {
        ok: false,
        step: 'run_create_failed',
        error: 'manual_run_create_rpc_empty',
      },
      { status: 500 }
    )
  }

  if (insertedRun.was_created === false) {
    return NextResponse.json({
      ok: true,
      run: {
        id: insertedRunId,
      },
      shoeWearMessage: null,
      xpGained: 0,
      breakdown: [],
      levelUp: false,
      newLevel: null,
    })
  }

  let shoeWearTrigger: Awaited<ReturnType<typeof applyRunToShoe>> = null

  try {
    shoeWearTrigger = await applyRunToShoe(supabaseAdmin, {
      userId: user.id,
      shoeId,
      distanceMeters,
    })
  } catch (shoeImpactError) {
    await supabaseAdmin.from('runs').delete().eq('id', insertedRunId).eq('user_id', user.id)

    return NextResponse.json(
      {
        ok: false,
        step: 'shoe_impact_failed',
        error: shoeImpactError instanceof Error ? shoeImpactError.message : 'shoe_impact_failed',
      },
      { status: 500 }
    )
  }

  const nextTotalXp = await loadProfileTotalXp(user.id, {
    supabase: supabaseAdmin,
  })
  const previousLevel = getLevelFromXP(previousTotalXp).level
  const nextLevel = getLevelFromXP(nextTotalXp).level
  const levelUp = nextLevel > previousLevel

  try {
    await upsertPersonalRecordForLocalRunIfEligible({
      supabase: supabaseAdmin,
      userId: user.id,
      runId: insertedRunId,
      distanceMeters,
      movingTimeSeconds,
      createdAt,
    })
  } catch (personalRecordError) {
    await markRunPrNeedsRecompute(insertedRunId).catch((markError) => {
      console.error('Failed to mark run for PR recompute after local run create', {
        userId: user.id,
        runId: insertedRunId,
        error: markError instanceof Error ? markError.message : 'unknown_error',
      })
    })

    console.error('Failed to update personal records after local run create', {
      userId: user.id,
      runId: insertedRunId,
      error: personalRecordError instanceof Error ? personalRecordError.message : 'unknown_error',
    })
  }

  try {
    await matchRaceEventsForRun({
      supabase: supabaseAdmin,
      userId: user.id,
      runId: insertedRunId,
    })
  } catch (raceEventMatchError) {
    console.error('Failed to match race events after local run create', {
      userId: user.id,
      runId: insertedRunId,
      error: raceEventMatchError instanceof Error ? raceEventMatchError.message : 'unknown_error',
    })
  }

  return NextResponse.json(
    {
      ok: true,
      run: {
        id: insertedRunId,
      },
      shoeWearMessage: shoeWearTrigger?.message ?? null,
      xpGained: runXp.xp,
      breakdown: runXp.breakdown,
      levelUp,
      newLevel: levelUp ? nextLevel : null,
    },
    { status: 201 }
  )
}
