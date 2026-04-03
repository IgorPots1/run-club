import { createSupabaseAdminClient } from '../lib/supabase-admin'

const STRAVA_EXTERNAL_SOURCE = 'strava'
const MIN_DISTANCE_KM = 1
const BASE_WORKOUT_XP = 50
const DISTANCE_XP_PER_KM = 10
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000
const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
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
  expected_xp: number
  weekly_bonus_xp: number
  prior_run_count_7d: number
  skip_reasons: string[]
}

function normalizeDistanceKm(value: RunRow['distance_km']) {
  const numericValue = Number(value ?? 0)
  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0
}

function parseCreatedAtMs(value: string) {
  const createdAtMs = new Date(value).getTime()
  return Number.isNaN(createdAtMs) ? null : createdAtMs
}

function getWeeklyConsistencyBonus(runCountLast7Days: number) {
  const normalizedRunCount = Number.isFinite(runCountLast7Days)
    ? Math.max(0, Math.round(runCountLast7Days))
    : 0

  if (normalizedRunCount >= 5) {
    return 50
  }

  if (normalizedRunCount >= 3) {
    return 30
  }

  if (normalizedRunCount >= 2) {
    return 15
  }

  return 0
}

function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }

  return chunks
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

async function fetchRunsForUsers(userIds: string[], minCreatedAtIso: string, maxCreatedAtIso: string) {
  const supabase = createSupabaseAdminClient()
  const rows: RunRow[] = []

  for (const userIdChunk of chunkValues(userIds, 200)) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('runs')
        .select('id, user_id, created_at, distance_km, xp, external_source')
        .in('user_id', userIdChunk)
        .gte('created_at', minCreatedAtIso)
        .lte('created_at', maxCreatedAtIso)
        .order('user_id', { ascending: true })
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
  }

  return rows
}

function evaluateCandidates(candidateRuns: RunRow[], relatedRuns: RunRow[]) {
  const runsByUser = new Map<string, Array<RunRow & { created_at_ms: number }>>()

  for (const run of relatedRuns) {
    if (!run.user_id) {
      continue
    }

    const createdAtMs = parseCreatedAtMs(run.created_at)

    if (createdAtMs === null) {
      continue
    }

    const existingRuns = runsByUser.get(run.user_id) ?? []
    existingRuns.push({
      ...run,
      created_at_ms: createdAtMs,
    })
    runsByUser.set(run.user_id, existingRuns)
  }

  return candidateRuns.map<CandidateEvaluation>((candidate) => {
    const distanceKm = normalizeDistanceKm(candidate.distance_km)
    const skipReasons: string[] = []
    const createdAtMs = parseCreatedAtMs(candidate.created_at)

    if (!candidate.user_id) {
      skipReasons.push('missing_user_id')
    }

    if (createdAtMs === null) {
      skipReasons.push('invalid_created_at')
    }

    if (distanceKm < MIN_DISTANCE_KM) {
      skipReasons.push('distance_below_1km')
    }

    let priorRunCount7d = 0
    let weeklyBonusXp = 0

    if (candidate.user_id && createdAtMs !== null) {
      const userRuns = runsByUser.get(candidate.user_id) ?? []

      if (
        userRuns.some((run) => run.id !== candidate.id && run.created_at === candidate.created_at)
      ) {
        skipReasons.push('same_timestamp_sibling')
      }

      if (
        userRuns.some(
          (run) =>
            run.id !== candidate.id &&
            run.created_at_ms >= createdAtMs - DUPLICATE_WINDOW_MS &&
            run.created_at_ms < createdAtMs
        )
      ) {
        skipReasons.push('earlier_run_within_10_minutes')
      }

      priorRunCount7d = userRuns.filter(
        (run) =>
          run.id !== candidate.id &&
          run.created_at_ms >= createdAtMs - WEEKLY_WINDOW_MS &&
          run.created_at_ms < createdAtMs
      ).length

      weeklyBonusXp = getWeeklyConsistencyBonus(priorRunCount7d + 1)
    }

    const expectedXp = Math.max(
      0,
      BASE_WORKOUT_XP + Math.round(distanceKm * DISTANCE_XP_PER_KM) + weeklyBonusXp
    )

    if (expectedXp <= 0) {
      skipReasons.push('expected_xp_not_positive')
    }

    return {
      id: candidate.id,
      user_id: candidate.user_id,
      created_at: candidate.created_at,
      distance_km: distanceKm,
      expected_xp: expectedXp,
      weekly_bonus_xp: weeklyBonusXp,
      prior_run_count_7d: priorRunCount7d,
      skip_reasons: skipReasons,
    }
  })
}

function formatSqlValuesBlock(rows: CandidateEvaluation[]) {
  if (rows.length === 0) {
    return '-- No repairable rows found.'
  }

  return rows
    .map(
      (row) =>
        `('${row.id}'::uuid, '${row.user_id}'::uuid, ${row.expected_xp})`
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
      prior_run_count_7d: row.prior_run_count_7d,
      weekly_bonus_xp: row.weekly_bonus_xp,
      expected_xp: row.expected_xp,
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
      expected_xp: row.expected_xp,
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

async function main() {
  const printSqlValues = process.argv.includes('--sql-values') || process.argv.includes('--sql')
  const candidateRuns = await fetchZeroXpStravaRuns()

  console.log(`Found ${candidateRuns.length} Strava runs with xp = 0.`)

  if (candidateRuns.length === 0) {
    console.log('Nothing to repair.')
    return
  }

  const candidateUserIds = Array.from(
    new Set(candidateRuns.map((run) => run.user_id).filter((userId): userId is string => Boolean(userId)))
  )

  const candidateCreatedAtMs = candidateRuns
    .map((run) => parseCreatedAtMs(run.created_at))
    .filter((value): value is number => value !== null)

  if (candidateUserIds.length === 0 || candidateCreatedAtMs.length === 0) {
    throw new Error('Unable to build repair context from candidate rows.')
  }

  const minCreatedAtMs = Math.min(...candidateCreatedAtMs) - WEEKLY_WINDOW_MS
  const maxCreatedAtMs = Math.max(...candidateCreatedAtMs)
  const relatedRuns = await fetchRunsForUsers(
    candidateUserIds,
    new Date(minCreatedAtMs).toISOString(),
    new Date(maxCreatedAtMs).toISOString()
  )
  const evaluatedCandidates = evaluateCandidates(candidateRuns, relatedRuns)
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
}

main().catch((error) => {
  console.error('\nFailed to generate Strava zero-XP repair candidates.')
  console.error(error)
  process.exitCode = 1
})
