import {
  auditPersonalRecordsPipeline,
  getAuditStatusLogLabel,
  hasActiveRateLimit,
  type AuditStatus,
} from './audit-personal-records-pipeline'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { runInitialPersonalRecordsSyncForUser } from '@/lib/personal-records/runInitialPersonalRecordsSyncForUser'

const DEFAULT_BATCH_SIZE = 200
const DEFAULT_SOURCE_PAGE_SIZE = 1000
const RETRYABLE_STATUSES = ['needs_retry', 'backfill_missing', 'recompute_missing', 'partial'] as const
const maxAttemptsPerUser = 3

type RetryableAuditStatus = (typeof RETRYABLE_STATUSES)[number]

type ScriptArgs = {
  batchSize: number
  sourcePageSize: number
  userId: string | null
  help: boolean
}

type Summary = {
  auditedUsers: number
  retryCandidates: number
  attempted: number
  succeeded: number
  failed: number
  dataMissing: number
  noConnection: number
  rateLimited: number
  skippedRateLimited: number
  skippedRunning: number
}

type BackfillJobStateRow = {
  status: string | null
  last_error: string | null
}

let cachedSupabaseAdminClient: SupabaseClient | null = null

function parsePositiveInteger(value: string, flagName: string) {
  const normalizedValue = Number(value)

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new Error(`${flagName} must be a positive integer`)
  }

  return normalizedValue
}

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

async function loadLatestBackfillJobState(
  supabase: SupabaseClient,
  userId: string
): Promise<BackfillJobStateRow | null> {
  const { data, error } = await supabase
    .from('personal_record_backfill_jobs')
    .select('status, last_error')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return (data as BackfillJobStateRow | null) ?? null
}

function isRateLimitErrorMessage(value: string | null | undefined) {
  if (!value) {
    return false
  }

  const normalizedValue = value.toLowerCase()
  return normalizedValue.includes('429') || normalizedValue.includes('rate_limit')
}

function parseArgs(argv: string[]): ScriptArgs {
  const args: ScriptArgs = {
    batchSize: DEFAULT_BATCH_SIZE,
    sourcePageSize: DEFAULT_SOURCE_PAGE_SIZE,
    userId: null,
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

    if (argument.startsWith('--user-id=')) {
      args.userId = argument.slice('--user-id='.length).trim() || null
      continue
    }

    throw new Error(`Unknown argument: ${argument}`)
  }

  return args
}

function printUsage() {
  console.log(`
Retry the personal records pipeline for users still missing backfill or recompute coverage.

Usage:
  npx tsx --env-file=.env.local scripts/retry-personal-records-pipeline.ts
  npx tsx --env-file=.env.local scripts/retry-personal-records-pipeline.ts --user-id=<uuid>

Optional:
  --batch-size=200
  --source-page-size=1000

Environment variables:
  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`)
}

function isRetryableStatus(status: AuditStatus): status is RetryableAuditStatus {
  return (RETRYABLE_STATUSES as readonly AuditStatus[]).includes(status)
}

function getRetryLogLabel(status: AuditStatus | 'rate_limited') {
  if (status === 'rate_limited') {
    return status
  }

  return getAuditStatusLogLabel(status)
}

function createSummary(): Summary {
  return {
    auditedUsers: 0,
    retryCandidates: 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    dataMissing: 0,
    noConnection: 0,
    rateLimited: 0,
    skippedRateLimited: 0,
    skippedRunning: 0,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printUsage()
    return
  }

  process.env.NEXT_PUBLIC_SUPABASE_URL ??= process.env.SUPABASE_URL
  const supabase = createSupabaseAdminClient()

  console.log('Starting personal records pipeline retry', {
    batchSize: args.batchSize,
    sourcePageSize: args.sourcePageSize,
    targetUserId: args.userId,
    retryableStatuses: [...RETRYABLE_STATUSES],
    retryableStatusLabels: RETRYABLE_STATUSES.map((status) => getAuditStatusLogLabel(status)),
    maxAttemptsPerUser,
    mode: 'sequential',
  })

  const auditResult = await auditPersonalRecordsPipeline({
    batchSize: args.batchSize,
    sourcePageSize: args.sourcePageSize,
    targetUserId: args.userId,
    logProgress: true,
  })
  const summary = createSummary()
  summary.auditedUsers = auditResult.auditRows.length

  if (args.userId && auditResult.auditRows.length === 0) {
    throw new Error(`No active auditable user found for user_id=${args.userId}`)
  }

  const retryRows = auditResult.auditRows.filter((row) => isRetryableStatus(row.status))
  const partialDataMissingRows = auditResult.auditRows.filter(
    (row) => row.status === 'partial_data_missing'
  )
  summary.retryCandidates = retryRows.length

  if (partialDataMissingRows.length > 0) {
    summary.dataMissing += partialDataMissingRows.length

    console.log('Skipping users with valid missing-distance gaps', {
      skippedUsers: partialDataMissingRows.length,
      auditStatus: 'partial_data_missing',
      auditStatusLabel: getAuditStatusLogLabel('partial_data_missing'),
      action: 'no_retry',
    })
  }

  for (const row of retryRows) {
    const latestBackfillJobState = await loadLatestBackfillJobState(supabase, row.user_id)
    const isBackfillRunning = latestBackfillJobState?.status === 'running'
    const hasBackfillRateLimitError = isRateLimitErrorMessage(latestBackfillJobState?.last_error)

    if (isBackfillRunning) {
      summary.skippedRunning += 1

      console.log('Skipping retry candidate', {
        userId: row.user_id,
        displayName: row.display_name,
        auditStatus: row.status,
        auditStatusLabel: getAuditStatusLogLabel(row.status),
        attemptsUsed: 0,
        finalStatus: row.status,
        finalStatusLabel: getAuditStatusLogLabel(row.status),
        backfillJobStatus: latestBackfillJobState?.status ?? null,
        action: 'skipped_due_to_running',
      })
      continue
    }

    if (hasActiveRateLimit(row.rate_limited_until) || hasBackfillRateLimitError) {
      summary.skippedRateLimited += 1

      console.log('Skipping retry candidate', {
        userId: row.user_id,
        displayName: row.display_name,
        auditStatus: row.status,
        auditStatusLabel: getAuditStatusLogLabel(row.status),
        attemptsUsed: 0,
        finalStatus: 'rate_limited',
        finalStatusLabel: getRetryLogLabel('rate_limited'),
        rateLimitedUntil: row.rate_limited_until,
        backfillJobStatus: latestBackfillJobState?.status ?? null,
        backfillLastError: latestBackfillJobState?.last_error ?? null,
        action: 'skipped_due_to_rate_limit',
      })
      continue
    }

    summary.attempted += 1
    let attemptsUsed = 0
    let finalStatus: AuditStatus | 'rate_limited' = row.status
    let finalAuditStatus = row.status
    let finalRateLimitedUntil = row.rate_limited_until
    let lastResult: Awaited<ReturnType<typeof runInitialPersonalRecordsSyncForUser>> | null = null

    for (let attemptNumber = 1; attemptNumber <= maxAttemptsPerUser; attemptNumber += 1) {
      attemptsUsed = attemptNumber
      lastResult = await runInitialPersonalRecordsSyncForUser(row.user_id)

      const updatedAuditResult = await auditPersonalRecordsPipeline({
        batchSize: args.batchSize,
        sourcePageSize: args.sourcePageSize,
        targetUserId: row.user_id,
        logProgress: false,
      })
      const updatedAuditRow = updatedAuditResult.auditRows[0] ?? null

      if (!updatedAuditRow) {
        finalStatus = 'failed'

        console.log('Retry candidate audit missing after attempt', {
          userId: row.user_id,
          displayName: row.display_name,
          attemptNumber,
          maxAttemptsPerUser,
          resultStatus: lastResult.status,
        })
        break
      }

      finalAuditStatus = updatedAuditRow.status
      finalRateLimitedUntil = updatedAuditRow.rate_limited_until
      const attemptRateLimited = hasActiveRateLimit(updatedAuditRow.rate_limited_until)
        || lastResult.status === 'rate_limited'
        || (lastResult.status === 'failed' && isRateLimitErrorMessage(lastResult.error))
      finalStatus = attemptRateLimited
        ? 'rate_limited'
        : updatedAuditRow.status

      console.log('Processed retry attempt', {
        userId: row.user_id,
        displayName: row.display_name,
        initialAuditStatus: row.status,
        initialAuditStatusLabel: getAuditStatusLogLabel(row.status),
        attemptNumber,
        maxAttemptsPerUser,
        resultStatus: lastResult.status,
        updatedAuditStatus: updatedAuditRow.status,
        updatedAuditStatusLabel: getAuditStatusLogLabel(updatedAuditRow.status),
        finalStatus,
        finalStatusLabel: getRetryLogLabel(finalStatus),
        ...(lastResult.status === 'success'
          ? {
              backfillReason: lastResult.backfillReason,
              backfillTriggered: lastResult.backfillTriggered,
              backfillJobStatus: lastResult.backfillJobStatus,
              resumedFailedBackfillJob: lastResult.resumedFailedBackfillJob,
              recomputedDistances: lastResult.recomputedDistances,
            }
          : {}),
        ...(lastResult.status === 'rate_limited'
          ? {
              rateLimitedUntil: lastResult.rateLimitedUntil,
            }
          : {}),
        ...(lastResult.status === 'failed'
          ? {
              error: lastResult.error,
              backfillReason: lastResult.backfillReason ?? null,
              backfillJobStatus: lastResult.backfillJobStatus ?? null,
            }
          : {}),
      })

      if (
        finalStatus === 'complete'
        || finalStatus === 'rate_limited'
        || finalStatus === 'partial_data_missing'
      ) {
        break
      }

      if (lastResult.status !== 'success') {
        break
      }
    }

    console.log('Processed retry candidate', {
      userId: row.user_id,
      displayName: row.display_name,
      initialAuditStatus: row.status,
      initialAuditStatusLabel: getAuditStatusLogLabel(row.status),
      attemptsUsed,
      maxAttemptsPerUser,
      finalAuditStatus,
      finalAuditStatusLabel: getAuditStatusLogLabel(finalAuditStatus),
      finalStatus,
      finalStatusLabel: getRetryLogLabel(finalStatus),
      rateLimitedUntil: finalRateLimitedUntil,
      lastResultStatus: lastResult?.status ?? null,
    })

    if (finalStatus === 'complete') {
      summary.succeeded += 1
      continue
    }

    if (finalStatus === 'rate_limited') {
      summary.rateLimited += 1
      continue
    }

    if (finalStatus === 'partial_data_missing') {
      summary.dataMissing += 1

      console.log('Not retrying user due to missing source data coverage', {
        userId: row.user_id,
        displayName: row.display_name,
        auditStatus: finalAuditStatus,
        auditStatusLabel: getAuditStatusLogLabel(finalAuditStatus),
        finalStatus,
        finalStatusLabel: getRetryLogLabel(finalStatus),
        action: 'no_retry',
      })
      continue
    }

    if (finalStatus === 'no_strava_connection' || lastResult?.status === 'no_connection') {
      summary.noConnection += 1
      continue
    }

    summary.failed += 1
  }

  console.log('Personal records pipeline retry finished', {
    ...summary,
    targetUserId: args.userId,
    auditedStatusSummary: auditResult.summary,
  })
}

main().catch((error) => {
  console.error('Personal records pipeline retry failed', {
    error: error instanceof Error ? error.message : 'unknown_error',
  })
  process.exitCode = 1
})
