import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { calculateRunXp } from '../lib/run-xp'

const STRAVA_EXTERNAL_SOURCE = 'strava'
const PAGE_SIZE = 1000

type RunRow = {
  id: string
  user_id: string | null
  created_at: string
  distance_km: number | string | null
  xp: number | string | null
  external_source: string | null
}

type CandidateEvaluation = {
  id: string
  user_id: string | null
  created_at: string
  distance_km: number
  recalculated_xp: number
  skip_reasons: string[]
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
      'Missing Supabase service role key. Set SUPABASE_SERVICE_ROLE_KEY before running this repair script.'
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

async function fetchZeroXpStravaRuns() {
  const supabase = createSupabaseAdminClient()
  const rows: RunRow[] = []

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('runs')
      .select('id, user_id, created_at, distance_km, xp, external_source')
      .eq('external_source', STRAVA_EXTERNAL_SOURCE)
      .eq('xp', 0)
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

async function evaluateCandidates(candidateRuns: RunRow[]) {
  const supabase = createSupabaseAdminClient()

  return Promise.all(candidateRuns.map(async (candidate): Promise<CandidateEvaluation> => {
    const distanceKm = normalizeDistanceKm(candidate.distance_km)
    const skipReasons: string[] = []
    let recalculatedXp = 0

    if (!candidate.user_id) {
      skipReasons.push('missing_user_id')
    } else {
      try {
        const runXp = await calculateRunXp({
          userId: candidate.user_id,
          createdAt: candidate.created_at,
          distanceKm,
          excludeRunId: candidate.id,
          supabase,
        })
        recalculatedXp = normalizeInteger(runXp.xp)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'unknown_error'
        skipReasons.push(`recalculation_failed:${errorMessage}`)
      }
    }

    if (recalculatedXp <= 0) {
      skipReasons.push('recalculated_xp_not_positive')
    }

    return {
      id: candidate.id,
      user_id: candidate.user_id,
      created_at: candidate.created_at,
      distance_km: distanceKm,
      recalculated_xp: recalculatedXp,
      skip_reasons: skipReasons,
    }
  }))
}

function formatSqlValuesBlock(rows: CandidateEvaluation[]) {
  if (rows.length === 0) {
    return '-- No repairable rows found.'
  }

  return rows
    .map(
      (row) =>
        `('${row.id}'::uuid, '${row.user_id}'::uuid, ${row.recalculated_xp})`
    )
    .join(',\n')
}

function printRepairableRows(rows: CandidateEvaluation[]) {
  console.log('\nRepairable rows')

  if (rows.length === 0) {
    console.log('  none')
    return
  }

  console.table(
    rows.map((row) => ({
      run_id: row.id,
      user_id: row.user_id,
      created_at: row.created_at,
      distance_km: row.distance_km,
      recalculated_xp: row.recalculated_xp,
    }))
  )
}

function printSkippedRows(rows: CandidateEvaluation[]) {
  console.log('\nSkipped rows')

  if (rows.length === 0) {
    console.log('  none')
    return
  }

  console.table(
    rows.map((row) => ({
      run_id: row.id,
      user_id: row.user_id,
      created_at: row.created_at,
      distance_km: row.distance_km,
      recalculated_xp: row.recalculated_xp,
      reason: row.skip_reasons.join(', '),
    }))
  )
}

function printAffectedUsers(rows: CandidateEvaluation[]) {
  const distinctUserIds = Array.from(
    new Set(rows.map((row) => row.user_id).filter((userId): userId is string => Boolean(userId)))
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

async function applyRepairs(rows: CandidateEvaluation[]) {
  const supabase = createSupabaseAdminClient()
  const updatedUserIds = new Set<string>()
  let updatedRunCount = 0

  for (const row of rows) {
    if (!row.user_id || row.recalculated_xp <= 0) {
      continue
    }

    const { data, error } = await supabase
      .from('runs')
      .update({ xp: row.recalculated_xp })
      .eq('id', row.id)
      .eq('user_id', row.user_id)
      .eq('external_source', STRAVA_EXTERNAL_SOURCE)
      .eq('xp', 0)
      .select('id, user_id')

    if (error) {
      throw error
    }

    const updatedRows = (data as Array<{ id: string; user_id: string }> | null) ?? []

    if (updatedRows.length > 0) {
      updatedRunCount += updatedRows.length
      updatedUserIds.add(row.user_id)
    }
  }

  for (const userId of updatedUserIds) {
    const { data: totalXp, error: recalculateError } = await supabase.rpc(
      'recalculate_user_total_xp',
      {
        p_user_id: userId,
      }
    )

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
    updatedProfileCount: updatedUserIds.size,
  }
}

async function main() {
  const printSqlValues = process.argv.includes('--sql-values') || process.argv.includes('--sql')
  const applyRepair = process.argv.includes('--apply')
  const candidateRuns = await fetchZeroXpStravaRuns()

  console.log(`Found ${candidateRuns.length} Strava runs with xp = 0.`)

  if (candidateRuns.length === 0) {
    console.log('Nothing to repair.')
    return
  }

  const evaluatedCandidates = await evaluateCandidates(candidateRuns)
  const repairableRows = evaluatedCandidates.filter((row) => row.skip_reasons.length === 0)
  const skippedRows = evaluatedCandidates.filter((row) => row.skip_reasons.length > 0)

  printRepairableRows(repairableRows)
  printSkippedRows(skippedRows)
  printAffectedUsers(repairableRows)

  console.log(`\nRepairable run count: ${repairableRows.length}`)
  console.log(`Skipped run count: ${skippedRows.length}`)

  if (printSqlValues) {
    console.log('\nSQL VALUES block')
    console.log(formatSqlValuesBlock(repairableRows))
  }

  if (applyRepair) {
    console.log('\nApplying repairs...')
    const result = await applyRepairs(repairableRows)
    console.log(`Updated run count: ${result.updatedRunCount}`)
    console.log(`Refreshed profile count: ${result.updatedProfileCount}`)
    return
  }

  console.log('\nDry run only. Re-run with --apply to update runs and refresh profile totals.')
}

main().catch((error) => {
  console.error('\nFailed to generate Strava zero-XP repair candidates.')
  console.error(error)
  process.exitCode = 1
})
