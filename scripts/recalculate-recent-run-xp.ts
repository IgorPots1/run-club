import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { calculateRunXp } from '../lib/run-xp'

const PAGE_SIZE = 1000
const RECENT_WINDOW_DAYS = 7

type RunRow = {
  id: string
  user_id: string | null
  created_at: string
  distance_km: number | string | null
  elevation_gain_meters: number | string | null
  external_source: string | null
  xp: number | string | null
}

type EvaluatedRun = {
  id: string
  user_id: string | null
  created_at: string
  distance_km: number
  old_xp: number
  recalculated_xp: number
  xp_delta: number
  status: 'increase' | 'decrease' | 'same' | 'skipped'
  skip_reasons: string[]
}

type Summary = {
  totalRunsInWindow: number
  wouldChange: number
  wouldIncrease: number
  wouldDecrease: number
  wouldStaySame: number
  skipped: number
}

let cachedSupabaseAdminClient: SupabaseClient | null = null

function getSupabaseUrl() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!supabaseUrl) {
    throw new Error(
      'Missing Supabase URL. Set SUPABASE_URL for scripts, or fall back to NEXT_PUBLIC_SUPABASE_URL if needed.'
    )
  }

  return supabaseUrl
}

function getSupabaseServiceRoleKey() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!serviceRoleKey) {
    throw new Error(
      'Missing Supabase service role key. Set SUPABASE_SERVICE_ROLE_KEY before running this script.'
    )
  }

  return serviceRoleKey
}

function createSupabaseAdminClient() {
  if (cachedSupabaseAdminClient) {
    return cachedSupabaseAdminClient
  }

  cachedSupabaseAdminClient = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return cachedSupabaseAdminClient
}

function normalizeDistanceKm(value: RunRow['distance_km']) {
  const numericValue = Number(value ?? 0)
  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0
}

function normalizeInteger(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0)
  return Number.isFinite(numericValue) ? Math.max(0, Math.round(numericValue)) : 0
}

function getRecentWindowStartIso() {
  return new Date(Date.now() - (RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000)).toISOString()
}

async function fetchRecentRuns() {
  const supabase = createSupabaseAdminClient()
  const rows: RunRow[] = []
  const recentWindowStartIso = getRecentWindowStartIso()

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('runs')
      .select('id, user_id, created_at, distance_km, elevation_gain_meters, external_source, xp')
      .gte('created_at', recentWindowStartIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      throw error
    }

    const page = (data as RunRow[] | null) ?? []
    rows.push(...page)

    if (page.length < PAGE_SIZE) {
      break
    }
  }

  return rows
}

async function evaluateRuns(runs: RunRow[]) {
  const supabase = createSupabaseAdminClient()

  return Promise.all(runs.map(async (run): Promise<EvaluatedRun> => {
    const distanceKm = normalizeDistanceKm(run.distance_km)
    const oldXp = normalizeInteger(run.xp)
    const skipReasons: string[] = []
    let recalculatedXp = oldXp

    if (!run.user_id) {
      skipReasons.push('missing_user_id')
    } else {
      try {
        const nextXp = await calculateRunXp({
          userId: run.user_id,
          createdAt: run.created_at,
          distanceKm,
          elevationGainMeters: normalizeInteger(run.elevation_gain_meters),
          externalSource: run.external_source,
          excludeRunId: run.id,
          supabase,
        })
        recalculatedXp = normalizeInteger(nextXp.xp)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'unknown_error'
        skipReasons.push(`recalculation_failed:${errorMessage}`)
      }
    }

    const xpDelta = recalculatedXp - oldXp
    const status = skipReasons.length > 0
      ? 'skipped'
      : xpDelta > 0
        ? 'increase'
        : xpDelta < 0
          ? 'decrease'
          : 'same'

    return {
      id: run.id,
      user_id: run.user_id,
      created_at: run.created_at,
      distance_km: distanceKm,
      old_xp: oldXp,
      recalculated_xp: recalculatedXp,
      xp_delta: xpDelta,
      status,
      skip_reasons: skipReasons,
    }
  }))
}

function buildSummary(rows: EvaluatedRun[]): Summary {
  const changeableRows = rows.filter((row) => row.status !== 'skipped')

  return {
    totalRunsInWindow: rows.length,
    wouldChange: changeableRows.filter((row) => row.xp_delta !== 0).length,
    wouldIncrease: changeableRows.filter((row) => row.status === 'increase').length,
    wouldDecrease: changeableRows.filter((row) => row.status === 'decrease').length,
    wouldStaySame: changeableRows.filter((row) => row.status === 'same').length,
    skipped: rows.filter((row) => row.status === 'skipped').length,
  }
}

function printSummary(summary: Summary) {
  console.log('\nDry-run summary')
  console.log(`  Total runs in 7-day window: ${summary.totalRunsInWindow}`)
  console.log(`  Would change: ${summary.wouldChange}`)
  console.log(`  Would increase: ${summary.wouldIncrease}`)
  console.log(`  Would decrease: ${summary.wouldDecrease}`)
  console.log(`  Would stay the same: ${summary.wouldStaySame}`)
  console.log(`  Skipped: ${summary.skipped}`)
}

function printChangedRows(rows: EvaluatedRun[]) {
  const changedRows = rows.filter((row) => row.status === 'increase' || row.status === 'decrease')

  console.log('\nRuns that would change')

  if (changedRows.length === 0) {
    console.log('  none')
    return
  }

  console.table(
    changedRows.map((row) => ({
      run_id: row.id,
      user_id: row.user_id,
      created_at: row.created_at,
      distance_km: row.distance_km,
      old_xp: row.old_xp,
      recalculated_xp: row.recalculated_xp,
      xp_delta: row.xp_delta,
      status: row.status,
    }))
  )
}

function printSkippedRows(rows: EvaluatedRun[]) {
  const skippedRows = rows.filter((row) => row.status === 'skipped')

  console.log('\nSkipped runs')

  if (skippedRows.length === 0) {
    console.log('  none')
    return
  }

  console.table(
    skippedRows.map((row) => ({
      run_id: row.id,
      user_id: row.user_id,
      created_at: row.created_at,
      distance_km: row.distance_km,
      old_xp: row.old_xp,
      recalculated_xp: row.recalculated_xp,
      reason: row.skip_reasons.join(', '),
    }))
  )
}

function printAffectedUsers(rows: EvaluatedRun[]) {
  const distinctUserIds = Array.from(
    new Set(
      rows
        .filter((row) => row.status !== 'skipped' && row.xp_delta !== 0)
        .map((row) => row.user_id)
        .filter((userId): userId is string => Boolean(userId))
    )
  )

  console.log('\nDistinct affected users')

  if (distinctUserIds.length === 0) {
    console.log('  none')
    return
  }

  for (const userId of distinctUserIds) {
    console.log(`  ${userId}`)
  }
}

async function applyRecalculation(rows: EvaluatedRun[]) {
  const supabase = createSupabaseAdminClient()
  const changedRows = rows.filter((row) => row.status !== 'skipped' && row.xp_delta !== 0 && row.user_id)
  const affectedUserIds = new Set<string>()
  let updatedRunCount = 0

  for (const row of changedRows) {
    const { data, error } = await supabase
      .from('runs')
      .update({ xp: row.recalculated_xp })
      .eq('id', row.id)
      .eq('user_id', row.user_id as string)
      .select('id, user_id')

    if (error) {
      throw error
    }

    const updatedRows = (data as Array<{ id: string; user_id: string }> | null) ?? []

    if (updatedRows.length > 0) {
      updatedRunCount += updatedRows.length
      affectedUserIds.add(row.user_id as string)
    }
  }

  for (const userId of affectedUserIds) {
    const { data: totalXp, error: recalculateError } = await supabase.rpc('recalculate_user_total_xp', {
      p_user_id: userId,
    })

    if (recalculateError) {
      throw recalculateError
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ total_xp: normalizeInteger(totalXp) })
      .eq('id', userId)

    if (updateError) {
      throw updateError
    }
  }

  return {
    updatedRunCount,
    updatedProfileCount: affectedUserIds.size,
  }
}

async function main() {
  const applyMode = process.argv.includes('--apply')
  const recentRuns = await fetchRecentRuns()

  console.log(`Found ${recentRuns.length} runs in the last ${RECENT_WINDOW_DAYS} days.`)
  console.log(
    'Note: accidental duplicate imports may still end up with different XP because current duplicate-window and daily-cap rules remain unchanged.'
  )

  if (recentRuns.length === 0) {
    console.log('Nothing to recalculate.')
    return
  }

  const evaluatedRuns = await evaluateRuns(recentRuns)
  const summary = buildSummary(evaluatedRuns)

  printSummary(summary)
  printChangedRows(evaluatedRuns)
  printSkippedRows(evaluatedRuns)
  printAffectedUsers(evaluatedRuns)

  if (applyMode) {
    console.log('\nApplying recent run XP recalculation...')
    const result = await applyRecalculation(evaluatedRuns)
    console.log(`Updated run count: ${result.updatedRunCount}`)
    console.log(`Refreshed profile count: ${result.updatedProfileCount}`)
    return
  }

  console.log('\nDry run only. Re-run with --apply to update runs and refresh profile totals.')
}

main().catch((error) => {
  console.error('\nFailed to recalculate recent run XP.')
  console.error(error)
  process.exitCode = 1
})
