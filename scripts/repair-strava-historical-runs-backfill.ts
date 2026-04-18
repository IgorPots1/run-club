import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { syncStravaRuns } from '../lib/strava/strava-sync'

type Args = {
  userIds: string[]
  allConnected: boolean
  limit: number | null
  help: boolean
}

type ConnectionRow = {
  user_id: string | null
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
  return createClient(getSupabaseUrl(), getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function parsePositiveInteger(value: string, flagName: string) {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`)
  }

  return parsed
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    userIds: [],
    allConnected: false,
    limit: null,
    help: false,
  }

  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') {
      args.help = true
      continue
    }

    if (argument === '--all-connected') {
      args.allConnected = true
      continue
    }

    if (argument.startsWith('--user-id=')) {
      const userId = argument.slice('--user-id='.length).trim()
      if (!userId) {
        throw new Error('--user-id cannot be empty')
      }
      args.userIds.push(userId)
      continue
    }

    if (argument.startsWith('--limit=')) {
      args.limit = parsePositiveInteger(argument.slice('--limit='.length), '--limit')
      continue
    }

    throw new Error(`Unknown argument: ${argument}`)
  }

  if (!args.help && !args.allConnected && args.userIds.length === 0) {
    throw new Error('Provide at least one --user-id=<uuid> or --all-connected')
  }

  if (args.allConnected && args.userIds.length > 0) {
    throw new Error('Use either --all-connected or --user-id, not both')
  }

  return args
}

function printUsage() {
  console.log(`
One-time repair: run Strava historical backfill (from 2026-01-01 cutoff) for users
who connected Strava before callback-based run backfill existed.

Usage:
  NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/repair-strava-historical-runs-backfill.ts --user-id=<uuid>
  NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/repair-strava-historical-runs-backfill.ts --all-connected
  NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/repair-strava-historical-runs-backfill.ts --all-connected --limit=100

Flags:
  --user-id=<uuid>    Backfill one user (repeatable)
  --all-connected     Backfill all users with strava_connections.status='connected'
  --limit=<n>         Optional cap when using --all-connected

Environment variables:
  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`)
}

async function fetchConnectedUserIds(supabase: SupabaseClient, limit: number | null) {
  const userIds = new Set<string>()
  const pageSize = 1000

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('strava_connections')
      .select('user_id')
      .eq('status', 'connected')
      .order('user_id', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) {
      throw new Error(error.message)
    }

    const rows = (data as ConnectionRow[] | null) ?? []
    if (rows.length === 0) {
      break
    }

    for (const row of rows) {
      if (row.user_id) {
        userIds.add(row.user_id)
      }

      if (limit && userIds.size >= limit) {
        return [...userIds]
      }
    }
  }

  return [...userIds]
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printUsage()
    return
  }

  const supabase = createSupabaseAdminClient()
  const targetUserIds = args.allConnected
    ? await fetchConnectedUserIds(supabase, args.limit)
    : [...new Set(args.userIds)]

  if (targetUserIds.length === 0) {
    console.log('No users to process.')
    return
  }

  const totals = {
    processed: 0,
    ok: 0,
    failed: 0,
    imported: 0,
    updated: 0,
    skipped: 0,
    runImportFailures: 0,
  }

  console.log('[repair-strava-historical-runs] start', {
    users: targetUserIds.length,
    source: args.allConnected ? 'all_connected' : 'explicit_user_ids',
  })

  for (const userId of targetUserIds) {
    totals.processed += 1
    console.log('[repair-strava-historical-runs] user_start', { userId })

    try {
      const result = await syncStravaRuns(userId, { mode: 'backfill' })
      if (!result.ok) {
        totals.failed += 1
        console.error('[repair-strava-historical-runs] user_failed', {
          userId,
          step: result.step,
        })
        continue
      }

      totals.ok += 1
      totals.imported += result.imported
      totals.updated += result.updated
      totals.skipped += result.skipped
      totals.runImportFailures += result.failed

      console.log('[repair-strava-historical-runs] user_done', {
        userId,
        imported: result.imported,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed,
        totalRunsFetched: result.totalRunsFetched,
      })
    } catch (error) {
      totals.failed += 1
      console.error('[repair-strava-historical-runs] user_exception', {
        userId,
        error: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }

  console.log('[repair-strava-historical-runs] complete', totals)
}

main().catch((error) => {
  console.error('[repair-strava-historical-runs] fatal', {
    error: error instanceof Error ? error.message : 'unknown_error',
  })
  process.exitCode = 1
})
