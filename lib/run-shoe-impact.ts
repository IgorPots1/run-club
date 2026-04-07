import 'server-only'

import { createSupabaseAdminClient } from './supabase-admin'
import {
  getUserShoeUsageMetrics,
  getWearThresholdCrossing,
  normalizeMaxDistanceMeters,
} from './shoes'

type AdminSupabaseClient = ReturnType<typeof createSupabaseAdminClient>

type UserShoeDistanceRow = {
  id: string
  user_id: string
  current_distance_meters: number | null
  max_distance_meters: number | string | null
}

export type RunShoeImpactState = {
  userId: string
  shoeId: string | null
  distanceMeters: number | null
}

export type RunShoeWearTrigger = {
  threshold: 'warning' | 'critical'
  message: string
} | null

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
): Promise<RunShoeWearTrigger> {
  const { userId, shoeId, deltaMeters } = params

  if (!shoeId || deltaMeters === 0) {
    return null
  }

  const { data: existingShoe, error: loadError } = await supabase
    .from('user_shoes')
    .select('id, user_id, current_distance_meters, max_distance_meters')
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
  const previousUsageMetrics = getUserShoeUsageMetrics({
    currentDistanceMeters: toSafeDistanceMeters(shoeRow.current_distance_meters),
    maxDistanceMeters: normalizeMaxDistanceMeters(shoeRow.max_distance_meters),
  })
  const nextUsageMetrics = getUserShoeUsageMetrics({
    currentDistanceMeters: nextDistanceMeters,
    maxDistanceMeters: normalizeMaxDistanceMeters(shoeRow.max_distance_meters),
  })

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

  return getWearThresholdCrossing({
    previousUsagePercent: previousUsageMetrics.usagePercent,
    nextUsagePercent: nextUsageMetrics.usagePercent,
  })
}

export async function applyRunToShoe(
  supabase: AdminSupabaseClient,
  params: {
    userId: string
    shoeId: string | null
    distanceMeters: number | null
  }
) {
  return adjustUserShoeDistance(supabase, {
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
  return adjustUserShoeDistance(supabase, {
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
): Promise<RunShoeWearTrigger> {
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
      return null
    }

    const deltaMeters = nextRun.distanceMeters - previousRun.distanceMeters

    if (deltaMeters === 0) {
      return null
    }

    return adjustUserShoeDistance(supabase, {
      userId: nextRun.userId,
      shoeId: nextRun.shoeId,
      deltaMeters,
    })
  }

  if (previousRun.shoeId) {
    await removeRunFromShoe(supabase, {
      userId: previousRun.userId,
      shoeId: previousRun.shoeId,
      distanceMeters: previousRun.distanceMeters,
    })
  }

  if (!nextRun.shoeId) {
    return null
  }

  try {
    return await applyRunToShoe(supabase, {
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
