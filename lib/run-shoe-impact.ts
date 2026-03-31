import 'server-only'

import { createSupabaseAdminClient } from './supabase-admin'

type AdminSupabaseClient = ReturnType<typeof createSupabaseAdminClient>

type UserShoeDistanceRow = {
  id: string
  user_id: string
  current_distance_meters: number | null
}

export type RunShoeImpactState = {
  userId: string
  shoeId: string | null
  distanceMeters: number | null
}

function toSafeDistanceMeters(value: number | string | null | undefined) {
  const numericValue = typeof value === 'string' ? Number(value) : value

  if (!Number.isFinite(numericValue)) {
    return 0
  }

  return Math.max(0, Math.round(Number(numericValue)))
}

async function adjustUserShoeDistance(
  supabase: AdminSupabaseClient,
  params: {
    userId: string
    shoeId: string | null
    deltaMeters: number
  }
) {
  const { userId, shoeId, deltaMeters } = params

  if (!shoeId || deltaMeters === 0) {
    return
  }

  const { data: existingShoe, error: loadError } = await supabase
    .from('user_shoes')
    .select('id, user_id, current_distance_meters')
    .eq('id', shoeId)
    .eq('user_id', userId)
    .maybeSingle()

  if (loadError) {
    throw new Error(loadError.message)
  }

  const shoeRow = (existingShoe as UserShoeDistanceRow | null) ?? null

  if (!shoeRow) {
    throw new Error('user_shoe_not_found')
  }

  const nextDistanceMeters = Math.max(
    0,
    toSafeDistanceMeters(shoeRow.current_distance_meters) + deltaMeters
  )

  const { error: updateError } = await supabase
    .from('user_shoes')
    .update({
      current_distance_meters: nextDistanceMeters,
    })
    .eq('id', shoeId)
    .eq('user_id', userId)

  if (updateError) {
    throw new Error(updateError.message)
  }
}

export async function applyRunToShoe(
  supabase: AdminSupabaseClient,
  params: {
    userId: string
    shoeId: string | null
    distanceMeters: number | null
  }
) {
  await adjustUserShoeDistance(supabase, {
    userId: params.userId,
    shoeId: params.shoeId,
    deltaMeters: toSafeDistanceMeters(params.distanceMeters),
  })
}

export async function removeRunFromShoe(
  supabase: AdminSupabaseClient,
  params: {
    userId: string
    shoeId: string | null
    distanceMeters: number | null
  }
) {
  await adjustUserShoeDistance(supabase, {
    userId: params.userId,
    shoeId: params.shoeId,
    deltaMeters: -toSafeDistanceMeters(params.distanceMeters),
  })
}

export async function updateRunShoeImpact(
  supabase: AdminSupabaseClient,
  params: {
    previousRun: RunShoeImpactState
    nextRun: RunShoeImpactState
  }
) {
  const previousRun = {
    ...params.previousRun,
    distanceMeters: toSafeDistanceMeters(params.previousRun.distanceMeters),
  }
  const nextRun = {
    ...params.nextRun,
    distanceMeters: toSafeDistanceMeters(params.nextRun.distanceMeters),
  }

  if (previousRun.shoeId === nextRun.shoeId) {
    if (!nextRun.shoeId) {
      return
    }

    const deltaMeters = nextRun.distanceMeters - previousRun.distanceMeters

    if (deltaMeters === 0) {
      return
    }

    await adjustUserShoeDistance(supabase, {
      userId: nextRun.userId,
      shoeId: nextRun.shoeId,
      deltaMeters,
    })
    return
  }

  if (previousRun.shoeId) {
    await removeRunFromShoe(supabase, {
      userId: previousRun.userId,
      shoeId: previousRun.shoeId,
      distanceMeters: previousRun.distanceMeters,
    })
  }

  if (!nextRun.shoeId) {
    return
  }

  try {
    await applyRunToShoe(supabase, {
      userId: nextRun.userId,
      shoeId: nextRun.shoeId,
      distanceMeters: nextRun.distanceMeters,
    })
  } catch (error) {
    if (previousRun.shoeId) {
      await applyRunToShoe(supabase, {
        userId: previousRun.userId,
        shoeId: previousRun.shoeId,
        distanceMeters: previousRun.distanceMeters,
      }).catch(() => {})
    }

    throw error
  }
}
