import {
  auditPersonalRecordsPipeline,
  hasActiveRateLimit,
  type AuditStatus,
} from './audit-personal-records-pipeline'
import { runInitialPersonalRecordsSyncForUser } from '@/lib/personal-records/runInitialPersonalRecordsSyncForUser'

const DEFAULT_BATCH_SIZE = 200
const DEFAULT_SOURCE_PAGE_SIZE = 1000
const RETRYABLE_STATUSES = ['needs_retry', 'backfill_missing', 'recompute_missing', 'partial'] as const

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
  noConnection: number
  rateLimited: number
  skippedRateLimited: number
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

function createSummary(): Summary {
  return {
    auditedUsers: 0,
    retryCandidates: 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    noConnection: 0,
    rateLimited: 0,
    skippedRateLimited: 0,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printUsage()
    return
  }

  process.env.NEXT_PUBLIC_SUPABASE_URL ??= process.env.SUPABASE_URL

  console.log('Starting personal records pipeline retry', {
    batchSize: args.batchSize,
    sourcePageSize: args.sourcePageSize,
    targetUserId: args.userId,
    retryableStatuses: [...RETRYABLE_STATUSES],
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
  summary.retryCandidates = retryRows.length

  for (const row of retryRows) {
    if (hasActiveRateLimit(row.rate_limited_until)) {
      summary.skippedRateLimited += 1

      console.log('Skipping user still in Strava cooldown window', {
        userId: row.user_id,
        displayName: row.display_name,
        auditStatus: row.status,
        rateLimitedUntil: row.rate_limited_until,
      })
      continue
    }

    summary.attempted += 1

    const result = await runInitialPersonalRecordsSyncForUser(row.user_id)

    console.log('Processed retry candidate', {
      userId: row.user_id,
      displayName: row.display_name,
      auditStatus: row.status,
      resultStatus: result.status,
      ...(result.status === 'success'
        ? {
            backfillReason: result.backfillReason,
            backfillTriggered: result.backfillTriggered,
            backfillJobStatus: result.backfillJobStatus,
            resumedFailedBackfillJob: result.resumedFailedBackfillJob,
            recomputedDistances: result.recomputedDistances,
          }
        : {}),
      ...(result.status === 'rate_limited'
        ? {
            rateLimitedUntil: result.rateLimitedUntil,
          }
        : {}),
      ...(result.status === 'failed'
        ? {
            error: result.error,
            backfillReason: result.backfillReason ?? null,
            backfillJobStatus: result.backfillJobStatus ?? null,
          }
        : {}),
    })

    if (result.status === 'success') {
      summary.succeeded += 1
      continue
    }

    if (result.status === 'rate_limited') {
      summary.rateLimited += 1
      continue
    }

    if (result.status === 'no_connection') {
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
