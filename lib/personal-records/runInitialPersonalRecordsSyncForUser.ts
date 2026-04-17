import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  SUPPORTED_PERSONAL_RECORD_DISTANCES,
  recomputePersonalRecordForUserDistance,
} from '@/lib/personal-records-recompute'
import { runHistoricalPersonalRecordBackfillForUser } from '@/lib/personal-records/runHistoricalPersonalRecordBackfillForUser.mjs'

type StravaConnectionRow = {
  id: string
  rate_limited_until: string | null
}

type BackfillEnsureResult = {
  ok?: boolean
  reason?: string | null
  triggered?: boolean
  jobStatus?: string | null
  cooldownUntil?: string | null
}

export type InitialPersonalRecordsSyncResult =
  | {
      status: 'success'
      userId: string
      backfillReason: string | null
      backfillTriggered: boolean
      backfillJobStatus: string | null
      resumedFailedBackfillJob: boolean
      recomputedDistances: number[]
    }
  | {
      status: 'rate_limited'
      userId: string
      rateLimitedUntil: string | null
    }
  | {
      status: 'no_connection'
      userId: string
    }
  | {
      status: 'failed'
      userId: string
      error: string
      backfillReason?: string | null
      backfillJobStatus?: string | null
    }

let cachedSupabaseAdminClient: SupabaseClient | null = null

function getRequiredEnv(name: string) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

function getSupabaseUrl() {
  return process.env.SUPABASE_URL ?? getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL')
}

function createSupabaseAdminClient() {
  if (cachedSupabaseAdminClient) {
    return cachedSupabaseAdminClient
  }

  cachedSupabaseAdminClient = createClient(
    getSupabaseUrl(),
    getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )

  return cachedSupabaseAdminClient
}

function hasActiveRateLimit(rateLimitedUntil: string | null) {
  if (!rateLimitedUntil) {
    return false
  }

  const untilMs = new Date(rateLimitedUntil).getTime()
  if (!Number.isFinite(untilMs)) {
    return false
  }

  return untilMs > Date.now()
}

async function loadLatestConnectedStravaConnection(
  supabase: SupabaseClient,
  userId: string
): Promise<StravaConnectionRow | null> {
  const { data, error } = await supabase
    .from('strava_connections')
    .select('id, rate_limited_until')
    .eq('user_id', userId)
    .eq('status', 'connected')
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return (data as StravaConnectionRow | null) ?? null
}

async function resetFailedBackfillJobToPending(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from('personal_record_backfill_jobs')
    .update({
      status: 'pending',
      last_error: null,
      finished_at: null,
    })
    .eq('user_id', userId)
    .eq('status', 'failed')
    .select('user_id')
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return Boolean(data)
}

export async function runInitialPersonalRecordsSyncForUser(
  userId: string
): Promise<InitialPersonalRecordsSyncResult> {
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : ''

  if (!normalizedUserId) {
    return {
      status: 'failed',
      userId: normalizedUserId,
      error: 'invalid_user_id',
    }
  }

  process.env.NEXT_PUBLIC_SUPABASE_URL ??= process.env.SUPABASE_URL

  try {
    const supabase = createSupabaseAdminClient()
    const connection = await loadLatestConnectedStravaConnection(supabase, normalizedUserId)

    if (!connection) {
      return {
        status: 'no_connection',
        userId: normalizedUserId,
      }
    }

    if (hasActiveRateLimit(connection.rate_limited_until)) {
      return {
        status: 'rate_limited',
        userId: normalizedUserId,
        rateLimitedUntil: connection.rate_limited_until,
      }
    }

    const resumedFailedBackfillJob = await resetFailedBackfillJobToPending(supabase, normalizedUserId)
    const backfillResult = await runHistoricalPersonalRecordBackfillForUser(
      normalizedUserId
    ) as BackfillEnsureResult

    if (backfillResult.ok !== true) {
      return {
        status: 'failed',
        userId: normalizedUserId,
        error: backfillResult.reason ?? 'backfill_failed',
        backfillReason: backfillResult.reason ?? null,
        backfillJobStatus: backfillResult.jobStatus ?? null,
      }
    }

    if (backfillResult.reason === 'not_connected') {
      return {
        status: 'no_connection',
        userId: normalizedUserId,
      }
    }

    if (backfillResult.reason === 'cooldown_active') {
      return {
        status: 'rate_limited',
        userId: normalizedUserId,
        rateLimitedUntil: backfillResult.cooldownUntil ?? null,
      }
    }

    if (backfillResult.reason === 'already_running' || backfillResult.reason === 'failed_not_resumed') {
      return {
        status: 'failed',
        userId: normalizedUserId,
        error: backfillResult.reason,
        backfillReason: backfillResult.reason,
        backfillJobStatus: backfillResult.jobStatus ?? null,
      }
    }

    const recomputedDistances: number[] = []

    for (const distanceMeters of SUPPORTED_PERSONAL_RECORD_DISTANCES) {
      await recomputePersonalRecordForUserDistance({
        supabase,
        userId: normalizedUserId,
        distanceMeters,
      })
      recomputedDistances.push(distanceMeters)
    }

    return {
      status: 'success',
      userId: normalizedUserId,
      backfillReason: backfillResult.reason ?? null,
      backfillTriggered: backfillResult.triggered === true,
      backfillJobStatus: backfillResult.jobStatus ?? null,
      resumedFailedBackfillJob,
      recomputedDistances,
    }
  } catch (error) {
    return {
      status: 'failed',
      userId: normalizedUserId,
      error: error instanceof Error ? error.message : 'unknown_error',
    }
  }
}
