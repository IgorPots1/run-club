import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { syncStravaRuns } from '../lib/strava/strava-sync'

const INITIAL_SYNC_CUTOFF = '2026-01-01T00:00:00Z'
const EXCLUDED_USER_IDS = [
  '7d2fa58b-d6bd-40fd-89b4-0d59d22734a6',
  '64806e86-39eb-472e-989f-903ab67f9999',
  '2a1fbf47-3240-42f9-8db3-4a31badd357d',
  '9c831c40-928d-4d0c-99f7-393b2b985290',
] as const

type Args = {
  userId: string | null
  limit: number | null
  dryRun: boolean
  force: boolean
  help: boolean
}

type ConnectionRow = {
  user_id: string | null
}

type ProfileRow = {
  id: string
  role: string | null
  first_name: string | null
  last_name: string | null
  name: string | null
  nickname: string | null
  email: string | null
}

type CandidateUser = {
  userId: string
  displayName: string
  runsSinceCutoff: number
}

type UserRepairStatus = 'completed' | 'rate_limited' | 'failed'

type UserRepairResult = {
  userId: string
  displayName: string
  imported: number
  skipped: number
  status: UserRepairStatus
  reason: string | null
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
    userId: null,
    limit: null,
    dryRun: false,
    force: false,
    help: false,
  }

  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') {
      args.help = true
      continue
    }

    if (argument.startsWith('--user-id=')) {
      const userId = argument.slice('--user-id='.length).trim()
      if (!userId) {
        throw new Error('--user-id cannot be empty')
      }
      args.userId = userId
      continue
    }

    if (argument.startsWith('--limit=')) {
      args.limit = parsePositiveInteger(argument.slice('--limit='.length), '--limit')
      continue
    }

    if (argument === '--dry-run') {
      args.dryRun = true
      continue
    }

    if (argument === '--force' || argument === '--force=true') {
      args.force = true
      continue
    }

    if (argument === '--force=false') {
      args.force = false
      continue
    }

    throw new Error(`Unknown argument: ${argument}`)
  }

  return args
}

function printUsage() {
  console.log(`
One-time repair for missing Strava initial historical run backfill.
Uses syncStravaRuns(mode=backfill) with cutoff 2026-01-01.

Usage:
  NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/repair-strava-historical-runs-backfill.ts --user-id=<uuid>
  NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/repair-strava-historical-runs-backfill.ts --limit=100
  NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/repair-strava-historical-runs-backfill.ts --dry-run
  NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/repair-strava-historical-runs-backfill.ts --force=true

Flags:
  --user-id=<uuid>    Repair one candidate user
  --limit=<n>         Optional cap for candidate users
  --dry-run           Print candidate users without syncing
  --force[=true|false] Ignore safe filter and process all candidates

Candidate filter:
  strava_connections.status = connected
  strava_connections.last_synced_at is null
  runs_since_cutoff = 0 (unless --force=true)
  excludes admin users and known excluded user ids

Environment variables:
  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`)
}

function getDisplayName(profile: ProfileRow | null) {
  if (!profile) {
    return 'unknown'
  }

  const fullName = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()
  if (fullName) {
    return fullName
  }
  if (profile.name?.trim()) {
    return profile.name.trim()
  }
  if (profile.nickname?.trim()) {
    return profile.nickname.trim()
  }
  if (profile.email?.trim()) {
    return profile.email.trim()
  }
  return 'unknown'
}

async function fetchProfilesMap(supabase: SupabaseClient, userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<string, ProfileRow>()
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, first_name, last_name, name, nickname, email')
    .in('id', userIds)

  if (error) {
    throw new Error(error.message)
  }

  const rows = (data as ProfileRow[] | null) ?? []
  return new Map(rows.map((row) => [row.id, row]))
}

async function fetchRunsSinceCutoffMap(
  supabase: SupabaseClient,
  userIds: string[]
) {
  const runsSinceCutoffByUserId = new Map<string, number>()
  const pageSize = 1000

  if (userIds.length === 0) {
    return runsSinceCutoffByUserId
  }

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('runs')
      .select('id, user_id')
      .in('user_id', userIds)
      .eq('external_source', 'strava')
      .gte('created_at', INITIAL_SYNC_CUTOFF)
      .order('user_id', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) {
      throw new Error(error.message)
    }

    const rows = (data as ConnectionRow[] | null) ?? []
    if (rows.length === 0) {
      break
    }

    for (const row of rows) {
      if (!row.user_id) {
        continue
      }
      runsSinceCutoffByUserId.set(
        row.user_id,
        (runsSinceCutoffByUserId.get(row.user_id) ?? 0) + 1
      )
    }

    if (rows.length < pageSize) {
      break
    }
  }

  return runsSinceCutoffByUserId
}

async function fetchCandidateUsers(
  supabase: SupabaseClient,
  options: {
    userId: string | null
    limit: number | null
    force: boolean
  }
) {
  const pageSize = 1000
  const candidateIds = new Set<string>()
  const excludedIds = new Set<string>(EXCLUDED_USER_IDS)

  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from('strava_connections')
      .select('user_id')
      .eq('status', 'connected')
      .is('last_synced_at', null)
      .order('user_id', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (options.userId) {
      query = query.eq('user_id', options.userId)
    }

    const { data, error } = await query
    if (error) {
      throw new Error(error.message)
    }

    const rows = (data as ConnectionRow[] | null) ?? []
    if (rows.length === 0) {
      break
    }

    for (const row of rows) {
      if (!row.user_id || excludedIds.has(row.user_id)) {
        continue
      }
      candidateIds.add(row.user_id)
    }

    if (options.userId) {
      break
    }
  }

  const candidateUserIds = [...candidateIds]
  const profilesMap = await fetchProfilesMap(supabase, candidateUserIds)
  const runsSinceCutoffByUserId = await fetchRunsSinceCutoffMap(supabase, candidateUserIds)
  const filtered = candidateUserIds.filter((candidateUserId) => {
    const profile = profilesMap.get(candidateUserId)
    return profile?.role !== 'admin'
  })

  const safelyFiltered = options.force
    ? filtered
    : filtered.filter((candidateUserId) => (runsSinceCutoffByUserId.get(candidateUserId) ?? 0) === 0)
  const limited = options.limit ? safelyFiltered.slice(0, options.limit) : safelyFiltered
  return limited.map((candidateUserId) => ({
    userId: candidateUserId,
    displayName: getDisplayName(profilesMap.get(candidateUserId) ?? null),
    runsSinceCutoff: runsSinceCutoffByUserId.get(candidateUserId) ?? 0,
  })) satisfies CandidateUser[]
}

async function runUserRepair(candidate: CandidateUser): Promise<UserRepairResult> {
  try {
    const result = await syncStravaRuns(candidate.userId, { mode: 'backfill' })
    if (!result.ok) {
      return {
        userId: candidate.userId,
        displayName: candidate.displayName,
        imported: 0,
        skipped: 0,
        status: result.step === 'rate_limited' ? 'rate_limited' : 'failed',
        reason: result.step,
      }
    }

    return {
      userId: candidate.userId,
      displayName: candidate.displayName,
      imported: result.imported,
      skipped: result.skipped,
      status: 'completed',
      reason: null,
    }
  } catch (error) {
    return {
      userId: candidate.userId,
      displayName: candidate.displayName,
      imported: 0,
      skipped: 0,
      status: 'failed',
      reason: error instanceof Error ? error.message : 'unknown_error',
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printUsage()
    return
  }

  const supabase = createSupabaseAdminClient()
  const candidates = await fetchCandidateUsers(supabase, {
    userId: args.userId,
    limit: args.limit,
    force: args.force,
  })

  if (candidates.length === 0) {
    console.log('[repair-strava-historical-runs] no_candidates', {
      userId: args.userId,
      limit: args.limit,
      force: args.force,
    })
    return
  }

  console.log('[repair-strava-historical-runs] start', {
    candidates: candidates.length,
    userId: args.userId,
    limit: args.limit,
    dryRun: args.dryRun,
    force: args.force,
    cutoff: INITIAL_SYNC_CUTOFF,
  })

  if (args.dryRun) {
    for (const candidate of candidates) {
      console.log('[repair-strava-historical-runs] candidate', {
        userId: candidate.userId,
        displayName: candidate.displayName,
        runsSinceCutoff: candidate.runsSinceCutoff,
      })
    }
    console.log('[repair-strava-historical-runs] dry_run_complete', {
      candidates: candidates.length,
    })
    return
  }

  const totals = {
    processed: 0,
    completed: 0,
    rateLimited: 0,
    failed: 0,
    imported: 0,
    skipped: 0,
  }

  for (const candidate of candidates) {
    totals.processed += 1
    const result = await runUserRepair(candidate)
    totals.imported += result.imported
    totals.skipped += result.skipped

    if (result.status === 'completed') {
      totals.completed += 1
    } else if (result.status === 'rate_limited') {
      totals.rateLimited += 1
    } else {
      totals.failed += 1
    }

    console.log('[repair-strava-historical-runs] user_result', {
      userId: result.userId,
      displayName: result.displayName,
      imported: result.imported,
      skipped: result.skipped,
      status: result.status,
      reason: result.reason,
    })
  }

  console.log('[repair-strava-historical-runs] complete', totals)
}

main().catch((error) => {
  console.error('[repair-strava-historical-runs] fatal', {
    error: error instanceof Error ? error.message : 'unknown_error',
  })
  process.exitCode = 1
})
