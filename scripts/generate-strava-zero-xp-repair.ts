import { createClient } from '@supabase/supabase-js'

const STRAVA_EXTERNAL_SOURCE = 'strava'
const MIN_DISTANCE_KM = 1
const BASE_WORKOUT_XP = 50
const DISTANCE_XP_PER_KM = 10
const DAILY_XP_CAP = 250
const XP_PER_LIKE = 5
const MAX_LIKES_WITH_XP_PER_DAY = 10
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
  raw_xp_before_cap: number
  prior_daily_xp: number
  expected_xp_after_cap: number
  weekly_bonus_xp: number
  prior_run_count_7d: number
  skip_reasons: string[]
}

type DailyXpUsageRpcResult = {
  runXp?: number | null
  challengeXp?: number | null
  receivedLikesCount?: number | null
} | null

let cachedSupabaseAdminClient: ReturnType<typeof createClient> | null = null

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

function parseCreatedAtMs(value: string) {
  const createdAtMs = new Date(value).getTime()
  return Number.isNaN(createdAtMs) ? null : createdAtMs
}

function getUtcDayBounds(timestamp: string) {
  const date = new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    throw new Error('invalid_xp_timestamp')
  }

  const start = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0,
    0,
    0,
    0
  ))
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  }
}

function applyDailyXpCap(rawXp: number, currentDailyXp: number) {
  const normalizedRawXp = normalizeInteger(rawXp)
  const normalizedCurrentDailyXp = normalizeInteger(currentDailyXp)
  const remainingXp = Math.max(0, DAILY_XP_CAP - normalizedCurrentDailyXp)

  return Math.min(normalizedRawXp, remainingXp)
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

async function loadPriorDailyXp(userId: string, timestamp: string) {
  const supabase = createSupabaseAdminClient()
  const { startIso } = getUtcDayBounds(timestamp)
  const params = {
    p_user_id: userId,
    p_start: startIso,
    p_end: timestamp,
  }
  const rpcClient = supabase as {
    rpc(
      fn: 'get_daily_xp_usage',
      args: typeof params
    ): Promise<{ data: unknown; error: unknown }>
  }
  const { data, error } = await rpcClient.rpc('get_daily_xp_usage', params)

  if (error) {
    throw error
  }

  const dailyUsage = (data as DailyXpUsageRpcResult) ?? null
  const runXp = normalizeInteger(dailyUsage?.runXp)
  const challengeXp = normalizeInteger(dailyUsage?.challengeXp)
  const receivedLikesCount = normalizeInteger(dailyUsage?.receivedLikesCount)
  const likeXp = Math.min(receivedLikesCount, MAX_LIKES_WITH_XP_PER_DAY) * XP_PER_LIKE
  const uncappedTotalXp = runXp + challengeXp + likeXp

  return Math.min(uncappedTotalXp, DAILY_XP_CAP)
}

async function evaluateCandidates(candidateRuns: RunRow[], relatedRuns: RunRow[]) {
  const runsByUser = new Map<string, Array<RunRow & { created_at_ms: number }>>()
  const priorDailyXpCache = new Map<string, number>()

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

  return Promise.all(candidateRuns.map(async (candidate): Promise<CandidateEvaluation> => {
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
    let priorDailyXp = 0

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

      const dailyUsageCacheKey = `${candidate.user_id}:${candidate.created_at}`
      const cachedPriorDailyXp = priorDailyXpCache.get(dailyUsageCacheKey)

      if (cachedPriorDailyXp !== undefined) {
        priorDailyXp = cachedPriorDailyXp
      } else {
        priorDailyXp = await loadPriorDailyXp(candidate.user_id, candidate.created_at)
        priorDailyXpCache.set(dailyUsageCacheKey, priorDailyXp)
      }
    }

    const rawXpBeforeCap = Math.max(
      0,
      BASE_WORKOUT_XP + Math.round(distanceKm * DISTANCE_XP_PER_KM) + weeklyBonusXp
    )
    const expectedXpAfterCap = applyDailyXpCap(rawXpBeforeCap, priorDailyXp)

    if (expectedXpAfterCap <= 0) {
      skipReasons.push('expected_xp_after_cap_not_positive')
    }

    return {
      id: candidate.id,
      user_id: candidate.user_id,
      created_at: candidate.created_at,
      distance_km: distanceKm,
      raw_xp_before_cap: rawXpBeforeCap,
      prior_daily_xp: priorDailyXp,
      expected_xp_after_cap: expectedXpAfterCap,
      weekly_bonus_xp: weeklyBonusXp,
      prior_run_count_7d: priorRunCount7d,
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
        `('${row.id}'::uuid, '${row.user_id}'::uuid, ${row.expected_xp_after_cap})`
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
      raw_xp_before_cap: row.raw_xp_before_cap,
      prior_daily_xp: row.prior_daily_xp,
      expected_xp_after_cap: row.expected_xp_after_cap,
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
      raw_xp_before_cap: row.raw_xp_before_cap,
      prior_daily_xp: row.prior_daily_xp,
      expected_xp_after_cap: row.expected_xp_after_cap,
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
  const evaluatedCandidates = await evaluateCandidates(candidateRuns, relatedRuns)
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
