import { NextResponse } from 'next/server'
import { cleanupEntityAppEvents } from '@/lib/events/createAppEvent'
import {
  clearRunPrNeedsRecompute,
  markRunPrNeedsRecompute,
  recomputePersonalRecordForUserDistance,
  SUPPORTED_PERSONAL_RECORD_DISTANCES,
  upsertPersonalRecordForLocalRunIfEligible,
} from '@/lib/personal-records'
import { matchRaceEventsForRun } from '@/lib/server/race-event-matching'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { removeRunFromShoe, updateRunShoeImpact } from '@/lib/run-shoe-impact'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type RunMutationRow = {
  id: string
  user_id: string
  name: string | null
  description: string | null
  name_manually_edited: boolean | null
  description_manually_edited: boolean | null
  shoe_id: string | null
  distance_meters: number | null
  moving_time_seconds: number | null
  external_source: string | null
  pr_needs_recompute: boolean
  created_at: string
}

type UpdateRunRequestBody = {
  name?: string | null
  description?: string | null
  nameManuallyEdited?: boolean | null
  descriptionManuallyEdited?: boolean | null
  shoeId?: string | null
}

async function loadOwnedRun(
  runId: string,
  userId: string
) {
  const supabaseAdmin = createSupabaseAdminClient()
  const result = await supabaseAdmin
    .from('runs')
    .select('id, user_id, name, description, name_manually_edited, description_manually_edited, shoe_id, distance_meters, moving_time_seconds, external_source, pr_needs_recompute, created_at')
    .eq('id', runId)
    .eq('user_id', userId)
    .maybeSingle()

  return {
    supabaseAdmin,
    data: (result.data as RunMutationRow | null) ?? null,
    error: result.error,
  }
}

async function loadRunCommentIds(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  runId: string
) {
  const { data, error } = await supabaseAdmin
    .from('run_comments')
    .select('id')
    .eq('run_id', runId)

  return {
    data: ((data ?? []) as Array<{ id: string | null }>)
      .map((row) => row.id?.trim() ?? '')
      .filter(Boolean),
    error,
  }
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

  const { id: runId } = await context.params
  const { supabaseAdmin, data: existingRun, error: loadError } = await loadOwnedRun(runId, user.id)

  if (loadError) {
    return NextResponse.json(
      {
        ok: false,
        error: loadError.message,
      },
      { status: 500 }
    )
  }

  if (!existingRun) {
    return NextResponse.json(
      {
        ok: false,
        error: 'run_not_found',
      },
      { status: 404 }
    )
  }

  const body = await request.json().catch(() => null) as UpdateRunRequestBody | null
  const updates: Record<string, string | boolean | null> = {}

  if (body && 'name' in body) {
    updates.name = body.name?.trim() || null
  }

  if (body && 'description' in body) {
    updates.description = body.description?.trim() || null
  }

  if (body && 'nameManuallyEdited' in body) {
    updates.name_manually_edited = Boolean(body.nameManuallyEdited)
  }

  if (body && 'descriptionManuallyEdited' in body) {
    updates.description_manually_edited = Boolean(body.descriptionManuallyEdited)
  }

  if (body && 'shoeId' in body) {
    updates.shoe_id = body.shoeId?.trim() || null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({
      ok: true,
      run: {
        id: existingRun.id,
        shoe_id: existingRun.shoe_id,
      },
    })
  }

  const previousRun = {
    userId: existingRun.user_id,
    shoeId: existingRun.shoe_id,
    distanceMeters: existingRun.distance_meters,
  }
  const nextRun = {
    userId: existingRun.user_id,
    shoeId: Object.prototype.hasOwnProperty.call(updates, 'shoe_id')
      ? (updates.shoe_id as string | null)
      : existingRun.shoe_id,
    distanceMeters: existingRun.distance_meters,
  }

  let shoeWearTrigger: Awaited<ReturnType<typeof updateRunShoeImpact>> = null

  try {
    shoeWearTrigger = await updateRunShoeImpact(supabaseAdmin, {
      previousRun,
      nextRun,
    })
  } catch (shoeImpactError) {
    return NextResponse.json(
      {
        ok: false,
        error: shoeImpactError instanceof Error ? shoeImpactError.message : 'shoe_impact_failed',
      },
      { status: 500 }
    )
  }

  const { error: updateError } = await supabaseAdmin
    .from('runs')
    .update(updates)
    .eq('id', existingRun.id)
    .eq('user_id', user.id)

  if (updateError) {
    await updateRunShoeImpact(supabaseAdmin, {
      previousRun: nextRun,
      nextRun: previousRun,
    }).catch(() => {})

    return NextResponse.json(
      {
        ok: false,
        error: updateError.message,
      },
      { status: 500 }
    )
  }

  try {
    const personalRecordResult = await upsertPersonalRecordForLocalRunIfEligible({
      supabase: supabaseAdmin,
      userId: user.id,
      runId: existingRun.id,
      distanceMeters: existingRun.distance_meters,
      movingTimeSeconds: existingRun.moving_time_seconds,
      createdAt: existingRun.created_at,
      externalSource: existingRun.external_source,
    })

    if (
      existingRun.pr_needs_recompute
      && (personalRecordResult.checked > 0 || personalRecordResult.deleted > 0)
    ) {
      await clearRunPrNeedsRecompute(existingRun.id).catch((clearError) => {
        console.error('Failed to clear run PR recompute flag after local run update', {
          userId: user.id,
          runId: existingRun.id,
          error: clearError instanceof Error ? clearError.message : 'unknown_error',
        })
      })
    }
  } catch (personalRecordError) {
    await markRunPrNeedsRecompute(existingRun.id).catch((markError) => {
      console.error('Failed to mark run for PR recompute after local run update', {
        userId: user.id,
        runId: existingRun.id,
        error: markError instanceof Error ? markError.message : 'unknown_error',
      })
    })

    console.error('Failed to update personal records after local run update', {
      userId: user.id,
      runId: existingRun.id,
      error: personalRecordError instanceof Error ? personalRecordError.message : 'unknown_error',
    })
  }

  try {
    await matchRaceEventsForRun({
      supabase: supabaseAdmin,
      userId: user.id,
      runId: existingRun.id,
    })
  } catch (raceEventMatchError) {
    console.error('Failed to match race events after local run update', {
      userId: user.id,
      runId: existingRun.id,
      error: raceEventMatchError instanceof Error ? raceEventMatchError.message : 'unknown_error',
    })
  }

  return NextResponse.json({
    ok: true,
    run: {
      id: existingRun.id,
      ...updates,
    },
    shoeWearMessage: shoeWearTrigger?.message ?? null,
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

  const { id: runId } = await context.params
  const { supabaseAdmin, data: existingRun, error: loadError } = await loadOwnedRun(runId, user.id)

  if (loadError) {
    return NextResponse.json(
      {
        ok: false,
        error: loadError.message,
      },
      { status: 500 }
    )
  }

  if (!existingRun) {
    return NextResponse.json(
      {
        ok: false,
        error: 'run_not_found',
      },
      { status: 404 }
    )
  }

  try {
    await removeRunFromShoe(supabaseAdmin, {
      userId: existingRun.user_id,
      shoeId: existingRun.shoe_id,
      distanceMeters: existingRun.distance_meters,
    })
  } catch (shoeImpactError) {
    return NextResponse.json(
      {
        ok: false,
        error: shoeImpactError instanceof Error ? shoeImpactError.message : 'shoe_impact_failed',
      },
      { status: 500 }
    )
  }

  const { data: affectedPersonalRecordSources, error: affectedPersonalRecordSourcesError } = await supabaseAdmin
    .from('personal_record_sources')
    .select('distance_meters')
    .eq('user_id', user.id)
    .eq('run_id', existingRun.id)
    .in('distance_meters', [...SUPPORTED_PERSONAL_RECORD_DISTANCES])

  if (affectedPersonalRecordSourcesError) {
    return NextResponse.json(
      {
        ok: false,
        error: affectedPersonalRecordSourcesError.message,
      },
      { status: 500 }
    )
  }

  const affectedDistances = Array.from(
    new Set(
      ((affectedPersonalRecordSources ?? []) as Array<{ distance_meters: number | null }>)
        .map((row) => (
          SUPPORTED_PERSONAL_RECORD_DISTANCES.find((distance) => distance === row.distance_meters) ?? null
        ))
        .filter((distance): distance is (typeof SUPPORTED_PERSONAL_RECORD_DISTANCES)[number] => distance !== null)
    )
  )

  const { data: runCommentIds, error: runCommentIdsError } = await loadRunCommentIds(supabaseAdmin, existingRun.id)

  if (runCommentIdsError) {
    return NextResponse.json(
      {
        ok: false,
        error: runCommentIdsError.message,
      },
      { status: 500 }
    )
  }

  const { error: deleteRunAppEventsError } = await cleanupEntityAppEvents(
    'run',
    existingRun.id,
    supabaseAdmin
  )

  if (deleteRunAppEventsError) {
    return NextResponse.json(
      {
        ok: false,
        error: deleteRunAppEventsError.message,
      },
      { status: 500 }
    )
  }

  if (runCommentIds.length > 0) {
    const { error: deleteRunCommentAppEventsError } = await supabaseAdmin
      .from('app_events')
      .delete()
      .eq('entity_type', 'run_comment')
      .in('entity_id', runCommentIds)

    if (deleteRunCommentAppEventsError) {
      return NextResponse.json(
        {
          ok: false,
          error: deleteRunCommentAppEventsError.message,
        },
        { status: 500 }
      )
    }
  }

  const { error: deleteError } = await supabaseAdmin
    .from('runs')
    .delete()
    .eq('id', existingRun.id)
    .eq('user_id', user.id)

  if (deleteError) {
    await updateRunShoeImpact(supabaseAdmin, {
      previousRun: {
        userId: existingRun.user_id,
        shoeId: null,
        distanceMeters: 0,
      },
      nextRun: {
        userId: existingRun.user_id,
        shoeId: existingRun.shoe_id,
        distanceMeters: existingRun.distance_meters,
      },
    }).catch(() => {})

    return NextResponse.json(
      {
        ok: false,
        error: deleteError.message,
      },
      { status: 500 }
    )
  }

  for (const distance of affectedDistances) {
    try {
      await recomputePersonalRecordForUserDistance({
        supabase: supabaseAdmin,
        userId: user.id,
        distanceMeters: distance,
      })
    } catch (personalRecordError) {
      console.error('Failed to recompute personal records after run delete', {
        userId: user.id,
        runId: existingRun.id,
        distanceMeters: distance,
        error: personalRecordError instanceof Error ? personalRecordError.message : 'unknown_error',
      })
    }
  }

  return NextResponse.json({
    ok: true,
  })
}
