import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_BATCH_SIZE = 200
const DEFAULT_SOURCE_PAGE_SIZE = 1000
const EXCLUDED_USER_ID = '9c831c40-928d-4d0c-99f7-393b2b985290'
const SUPPORTED_DISTANCES = [5000, 10000, 21097, 42195] as const

type SupportedDistance = (typeof SUPPORTED_DISTANCES)[number]
export type AuditStatus =
  | 'no_strava_connection'
  | 'needs_retry'
  | 'no_runs'
  | 'backfill_missing'
  | 'recompute_missing'
  | 'partial'
  | 'partial_data_missing'
  | 'complete'
  | 'failed'

type ScriptArgs = {
  batchSize: number
  sourcePageSize: number
  help: boolean
}

type AuditPipelineOptions = {
  batchSize?: number
  sourcePageSize?: number
  targetUserId?: string | null
  logProgress?: boolean
}

type ProfileRow = {
  id: string
  app_access_status: 'active' | 'blocked' | null
  first_name: string | null
  last_name: string | null
  name: string | null
  nickname: string | null
  email: string | null
}

type StravaConnectionRow = {
  id: string
  user_id: string | null
  status: string | null
  rate_limited_until: string | null
  updated_at: string | null
}

type BackfillJobRow = {
  user_id: string | null
  status: string | null
  last_error: string | null
  processed_activities_count: number | null
  scanned_pages_count: number | null
}

type RunUserRow = {
  id: string
  user_id: string | null
}

type DistanceRow = {
  id: string
  user_id: string | null
  distance_meters: number | string | null
}

export type AuditRow = {
  user_id: string
  display_name: string
  has_strava_connection: boolean
  is_strava_rate_limited: boolean
  rate_limited_until: string | null
  strava_runs_count: number
  historical_distances: number[]
  canonical_distances: number[]
  missing_distances: number[]
  status: AuditStatus
  error: string | null
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

function parsePositiveInteger(value: string, flagName: string) {
  const normalizedValue = Number(value)

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new Error(`${flagName} must be a positive integer`)
  }

  return normalizedValue
}

function parseArgs(argv: string[]): ScriptArgs {
  const args: ScriptArgs = {
    batchSize: DEFAULT_BATCH_SIZE,
    sourcePageSize: DEFAULT_SOURCE_PAGE_SIZE,
    help: false,
  }

  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') {
      args.help = true
      continue
    }

    if (argument.startsWith('--batch-size=')) {
      args.batchSize = parsePositiveInteger(argument.slice('--batch-size='.length), '--batch-size')
      continue
    }

    if (argument.startsWith('--source-page-size=')) {
      args.sourcePageSize = parsePositiveInteger(
        argument.slice('--source-page-size='.length),
        '--source-page-size'
      )
      continue
    }

    throw new Error(`Unknown argument: ${argument}`)
  }

  return args
}

function printUsage() {
  console.log(`
Audit personal records pipeline coverage for active club users.

Usage:
  npx tsx --env-file=.env.local scripts/audit-personal-records-pipeline.ts
  npx tsx --env-file=.env.local scripts/audit-personal-records-pipeline.ts --batch-size=200

Optional:
  --source-page-size=1000

Environment variables:
  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`)
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function buildDisplayName(profile: ProfileRow) {
  const fullName = [normalizeText(profile.first_name), normalizeText(profile.last_name)]
    .filter(Boolean)
    .join(' ')
    .trim()

  return (
    normalizeText(profile.nickname)
    || (fullName ? fullName : null)
    || normalizeText(profile.name)
    || normalizeText(profile.email)
    || profile.id
  )
}

function isSupportedDistance(value: number): value is SupportedDistance {
  return (SUPPORTED_DISTANCES as readonly number[]).includes(value)
}

function toDistanceArray(values: Set<number>) {
  return [...values].sort((left, right) => left - right)
}

function formatDistanceArray(values: number[]) {
  return values.length > 0 ? `[${values.join(', ')}]` : '[]'
}

export function getAuditStatusLogLabel(status: AuditStatus) {
  if (status === 'partial') {
    return 'partial_pipeline'
  }

  return status
}

function getMissingDistances(canonicalDistances: Set<number>) {
  return SUPPORTED_DISTANCES.filter((distanceMeters) => !canonicalDistances.has(distanceMeters))
}

export function hasActiveRateLimit(rateLimitedUntil: string | null) {
  if (!rateLimitedUntil) {
    return false
  }

  const untilMs = new Date(rateLimitedUntil).getTime()
  if (!Number.isFinite(untilMs)) {
    return false
  }

  return untilMs > Date.now()
}

async function fetchActiveProfileBatch(
  supabase: SupabaseClient,
  batchSize: number,
  afterUserId: string | null,
  targetUserId: string | null = null
) {
  if (targetUserId) {
    if (afterUserId) {
      return []
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, app_access_status, first_name, last_name, name, nickname, email')
      .eq('app_access_status', 'active')
      .eq('id', targetUserId)
      .neq('id', EXCLUDED_USER_ID)
      .limit(1)

    if (error) {
      throw new Error(error.message)
    }

    return (data as ProfileRow[] | null) ?? []
  }

  let query = supabase
    .from('profiles')
    .select('id, app_access_status, first_name, last_name, name, nickname, email')
    .eq('app_access_status', 'active')
    .neq('id', EXCLUDED_USER_ID)
    .order('id', { ascending: true })
    .limit(batchSize)

  if (afterUserId) {
    query = query.gt('id', afterUserId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return (data as ProfileRow[] | null) ?? []
}

async function fetchLatestStravaConnectionsForUsers(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<Map<string, StravaConnectionRow>> {
  const connectionsByUserId = new Map<string, StravaConnectionRow>()

  if (userIds.length === 0) {
    return connectionsByUserId
  }

  const { data, error } = await supabase
    .from('strava_connections')
    .select('id, user_id, status, rate_limited_until, updated_at')
    .in('user_id', userIds)
    .order('user_id', { ascending: true })
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  const rows = (data as StravaConnectionRow[] | null) ?? []

  for (const row of rows) {
    if (!row.user_id || connectionsByUserId.has(row.user_id)) {
      continue
    }

    connectionsByUserId.set(row.user_id, row)
  }

  return connectionsByUserId
}

async function fetchStravaRunCountsForUsers(
  supabase: SupabaseClient,
  userIds: string[],
  sourcePageSize: number
): Promise<Map<string, number>> {
  const runCountsByUserId = new Map<string, number>()

  if (userIds.length === 0) {
    return runCountsByUserId
  }

  for (let offset = 0; ; offset += sourcePageSize) {
    const { data, error } = await supabase
      .from('runs')
      .select('id, user_id')
      .in('user_id', userIds)
      .eq('external_source', 'strava')
      .order('user_id', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + sourcePageSize - 1)

    if (error) {
      throw new Error(error.message)
    }

    const rows = (data as RunUserRow[] | null) ?? []

    for (const row of rows) {
      if (!row.user_id) {
        continue
      }

      runCountsByUserId.set(row.user_id, (runCountsByUserId.get(row.user_id) ?? 0) + 1)
    }

    if (rows.length < sourcePageSize) {
      break
    }
  }

  return runCountsByUserId
}

async function fetchBackfillJobStatusesForUsers(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<
  Map<
    string,
    Pick<
      BackfillJobRow,
      'status' | 'last_error' | 'processed_activities_count' | 'scanned_pages_count'
    >
  >
> {
  const backfillStatesByUserId = new Map<
    string,
    Pick<
      BackfillJobRow,
      'status' | 'last_error' | 'processed_activities_count' | 'scanned_pages_count'
    >
  >()

  if (userIds.length === 0) {
    return backfillStatesByUserId
  }

  const { data, error } = await supabase
    .from('personal_record_backfill_jobs')
    .select('user_id, status, last_error, processed_activities_count, scanned_pages_count')
    .in('user_id', userIds)

  if (error) {
    throw new Error(error.message)
  }

  const rows = (data as BackfillJobRow[] | null) ?? []

  for (const row of rows) {
    if (!row.user_id || backfillStatesByUserId.has(row.user_id)) {
      continue
    }

    backfillStatesByUserId.set(row.user_id, {
      status: row.status,
      last_error: row.last_error,
      processed_activities_count: row.processed_activities_count,
      scanned_pages_count: row.scanned_pages_count,
    })
  }

  return backfillStatesByUserId
}

async function fetchDistanceSetsForUsers(
  supabase: SupabaseClient,
  tableName: 'personal_record_sources' | 'personal_records',
  userIds: string[],
  sourcePageSize: number
): Promise<Map<string, Set<number>>> {
  const distanceSetsByUserId = new Map<string, Set<number>>()

  if (userIds.length === 0) {
    return distanceSetsByUserId
  }

  for (let offset = 0; ; offset += sourcePageSize) {
    const { data, error } = await supabase
      .from(tableName)
      .select('id, user_id, distance_meters')
      .in('user_id', userIds)
      .in('distance_meters', [...SUPPORTED_DISTANCES])
      .order('user_id', { ascending: true })
      .order('distance_meters', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + sourcePageSize - 1)

    if (error) {
      throw new Error(error.message)
    }

    const rows = (data as DistanceRow[] | null) ?? []

    for (const row of rows) {
      if (!row.user_id) {
        continue
      }

      const distanceMeters = Number(row.distance_meters)
      if (!isSupportedDistance(distanceMeters)) {
        continue
      }

      const distances = distanceSetsByUserId.get(row.user_id) ?? new Set<number>()
      distances.add(distanceMeters)
      distanceSetsByUserId.set(row.user_id, distances)
    }

    if (rows.length < sourcePageSize) {
      break
    }
  }

  return distanceSetsByUserId
}

function deriveStatus(input: {
  hasStravaConnection: boolean
  isStravaRateLimited: boolean
  stravaRunsCount: number
  hasBackfillJob: boolean
  backfillJobStatus: string | null
  backfillLastError: string | null
  backfillProcessedActivitiesCount: number | null
  backfillScannedPagesCount: number | null
  historicalDistances: number[]
  canonicalDistances: number[]
  missingDistances: number[]
  error: string | null
}): AuditStatus {
  if (input.error) {
    return 'failed'
  }

  if (!input.hasStravaConnection) {
    return 'no_strava_connection'
  }

  if (input.isStravaRateLimited) {
    return 'needs_retry'
  }

  const hasHistoricalOrCanonicalData = (
    input.historicalDistances.length > 0
    || input.canonicalDistances.length > 0
  )

  const hasRetryableBackfillBootstrapState = (
    input.hasBackfillJob
    && (
      input.backfillJobStatus === 'pending'
      || input.backfillJobStatus === 'running'
      || input.backfillJobStatus === 'paused_rate_limited'
      || input.backfillLastError === 'empty_first_historical_page'
      || (
        input.backfillProcessedActivitiesCount === 0
        && input.backfillScannedPagesCount === 0
      )
    )
  )

  if (input.stravaRunsCount === 0 && !hasHistoricalOrCanonicalData) {
    if (hasRetryableBackfillBootstrapState) {
      return 'backfill_missing'
    }

    return 'no_runs'
  }

  if (input.historicalDistances.length === 0) {
    return 'backfill_missing'
  }

  if (input.canonicalDistances.length === 0) {
    return 'recompute_missing'
  }

  if (input.missingDistances.length > 0) {
    if (input.backfillJobStatus === 'completed') {
      return 'partial_data_missing'
    }

    return 'partial'
  }

  return 'complete'
}

function createEmptySummary(): Record<AuditStatus, number> {
  return {
    no_strava_connection: 0,
    needs_retry: 0,
    no_runs: 0,
    backfill_missing: 0,
    recompute_missing: 0,
    partial: 0,
    partial_data_missing: 0,
    complete: 0,
    failed: 0,
  }
}

export async function auditPersonalRecordsPipeline(options: AuditPipelineOptions = {}) {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const sourcePageSize = options.sourcePageSize ?? DEFAULT_SOURCE_PAGE_SIZE
  const targetUserId = typeof options.targetUserId === 'string' && options.targetUserId.trim()
    ? options.targetUserId.trim()
    : null
  const logProgress = options.logProgress === true

  process.env.NEXT_PUBLIC_SUPABASE_URL ??= process.env.SUPABASE_URL

  const supabase = createSupabaseAdminClient()
  const startedAt = Date.now()
  const auditRows: AuditRow[] = []
  let lastProcessedUserId: string | null = null
  let processedUsers = 0

  if (logProgress) {
    console.log('Starting personal records pipeline audit', {
      batchSize,
      sourcePageSize,
      targetUserId,
      supportedDistances: [...SUPPORTED_DISTANCES],
      excludedUserId: EXCLUDED_USER_ID,
      mode: 'read_only',
    })
  }

  for (;;) {
    const profiles = await fetchActiveProfileBatch(
      supabase,
      batchSize,
      lastProcessedUserId,
      targetUserId
    )

    if (profiles.length === 0) {
      break
    }

    const userIds = profiles.map((profile) => profile.id)

    if (logProgress) {
      console.log('Loaded active user batch', {
        userCount: profiles.length,
        firstUserId: userIds[0],
        lastUserId: userIds[userIds.length - 1],
      })
    }

    let connectionsByUserId = new Map<string, StravaConnectionRow>()
    let stravaRunCountsByUserId = new Map<string, number>()
    let backfillStatesByUserId = new Map<string, Pick<BackfillJobRow, 'status' | 'last_error'>>()
    let historicalByUserId = new Map<string, Set<number>>()
    let canonicalByUserId = new Map<string, Set<number>>()
    let batchError: string | null = null

    try {
      const batchData = await Promise.all([
        fetchLatestStravaConnectionsForUsers(supabase, userIds),
        fetchStravaRunCountsForUsers(supabase, userIds, sourcePageSize),
        fetchBackfillJobStatusesForUsers(supabase, userIds),
        fetchDistanceSetsForUsers(supabase, 'personal_record_sources', userIds, sourcePageSize),
        fetchDistanceSetsForUsers(supabase, 'personal_records', userIds, sourcePageSize),
      ])

      connectionsByUserId = batchData[0]
      stravaRunCountsByUserId = batchData[1]
      backfillStatesByUserId = batchData[2]
      historicalByUserId = batchData[3]
      canonicalByUserId = batchData[4]
    } catch (error) {
      batchError = error instanceof Error ? error.message : 'unknown_error'
    }

    for (const profile of profiles) {
      let rowError: string | null = null

      try {
        if (batchError) {
          throw new Error(batchError)
        }

        const latestConnection = connectionsByUserId.get(profile.id) ?? null
        const hasStravaConnection = latestConnection !== null
        const isStravaRateLimited = hasActiveRateLimit(latestConnection?.rate_limited_until ?? null)
        const latestBackfillState = backfillStatesByUserId.get(profile.id) ?? null
        const backfillJobStatus = latestBackfillState?.status ?? null
        const backfillLastError = latestBackfillState?.last_error ?? null
        const backfillProcessedActivitiesCount = latestBackfillState?.processed_activities_count ?? null
        const backfillScannedPagesCount = latestBackfillState?.scanned_pages_count ?? null
        const historicalDistances = toDistanceArray(historicalByUserId.get(profile.id) ?? new Set<number>())
        const canonicalDistances = toDistanceArray(canonicalByUserId.get(profile.id) ?? new Set<number>())
        const missingDistances = getMissingDistances(new Set(canonicalDistances))
        const stravaRunsCount = stravaRunCountsByUserId.get(profile.id) ?? 0

        auditRows.push({
          user_id: profile.id,
          display_name: buildDisplayName(profile),
          has_strava_connection: hasStravaConnection,
          is_strava_rate_limited: isStravaRateLimited,
          rate_limited_until: latestConnection?.rate_limited_until ?? null,
          strava_runs_count: stravaRunsCount,
          historical_distances: historicalDistances,
          canonical_distances: canonicalDistances,
          missing_distances: missingDistances,
          status: deriveStatus({
            hasStravaConnection,
            isStravaRateLimited,
            stravaRunsCount,
            hasBackfillJob: latestBackfillState !== null,
            backfillJobStatus,
            backfillLastError,
            backfillProcessedActivitiesCount,
            backfillScannedPagesCount,
            historicalDistances,
            canonicalDistances,
            missingDistances,
            error: null,
          }),
          error: null,
        })
      } catch (error) {
        rowError = error instanceof Error ? error.message : 'unknown_error'

        auditRows.push({
          user_id: profile.id,
          display_name: buildDisplayName(profile),
          has_strava_connection: false,
          is_strava_rate_limited: false,
          rate_limited_until: null,
          strava_runs_count: 0,
          historical_distances: [],
          canonical_distances: [],
          missing_distances: [...SUPPORTED_DISTANCES],
          status: 'failed',
          error: rowError,
        })
      }

      processedUsers += 1
      lastProcessedUserId = profile.id
    }

    if (logProgress) {
      console.log('Batch audit complete', {
        processedUsersSoFar: processedUsers,
        lastProcessedUserId,
      })
    }
  }

  const summary = createEmptySummary()
  for (const row of auditRows) {
    summary[row.status] += 1
  }

  return {
    auditRows,
    summary,
    lastProcessedUserId,
    elapsedMs: Date.now() - startedAt,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printUsage()
    return
  }

  const result = await auditPersonalRecordsPipeline({
    batchSize: args.batchSize,
    sourcePageSize: args.sourcePageSize,
    logProgress: true,
  })

  console.log('\nPer-user audit rows')
  console.table(
    result.auditRows.map((row) => ({
      ...row,
      status_label: getAuditStatusLogLabel(row.status),
      historical_distances: formatDistanceArray(row.historical_distances),
      canonical_distances: formatDistanceArray(row.canonical_distances),
      missing_distances: formatDistanceArray(row.missing_distances),
    }))
  )

  console.log('\nAggregate summary by status')
  console.table(
    Object.entries(result.summary).map(([status, count]) => ({
      status,
      status_label: getAuditStatusLogLabel(status as AuditStatus),
      count,
    }))
  )
  console.log('partial_data_missing users', {
    count: result.summary.partial_data_missing,
    status: 'partial_data_missing',
    statusLabel: getAuditStatusLogLabel('partial_data_missing'),
  })

  console.log('\nPersonal records pipeline audit finished', {
    usersAudited: result.auditRows.length,
    lastProcessedUserId: result.lastProcessedUserId,
    elapsedMs: result.elapsedMs,
    mode: 'read_only',
  })
}

const isDirectExecution = Boolean(
  process.argv[1]
  && new URL(import.meta.url).pathname === process.argv[1]
)

if (isDirectExecution) {
  main().catch((error) => {
    console.error('Personal records pipeline audit failed', {
      error: error instanceof Error ? error.message : 'unknown_error',
    })
    process.exitCode = 1
  })
}
