import { createClient } from '@supabase/supabase-js'

const SUPPORTED_DISTANCES = [5000, 10000, 21097, 42195] as const

type SupportedDistance = (typeof SUPPORTED_DISTANCES)[number]

type CanonicalRow = {
  id: string
  duration_seconds: number
}

function parseUserIds(argv: string[]) {
  const userIdsArg = argv.find((arg) => arg.startsWith('--user-ids='))
  const rawValue = userIdsArg?.slice('--user-ids='.length).trim() ?? ''

  if (!rawValue) {
    throw new Error('Missing required argument: --user-ids=<uuid,uuid,...>')
  }

  const userIds = rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (userIds.length === 0) {
    throw new Error('No user IDs were provided in --user-ids')
  }

  return [...new Set(userIds)]
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

async function loadCanonical(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  distanceMeters: SupportedDistance
) {
  const { data, error } = await supabase
    .from('personal_records')
    .select('id, duration_seconds')
    .eq('user_id', userId)
    .eq('distance_meters', distanceMeters)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  const row = (data as CanonicalRow | null) ?? null
  if (!row) {
    return null
  }

  return {
    id: row.id,
    durationSeconds: Number(row.duration_seconds),
  }
}

async function recomputeCanonical(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  distanceMeters: SupportedDistance
) {
  const rpc = supabase.rpc as (
    fn: 'recompute_personal_record_for_user_distance',
    args: { p_user_id: string; p_distance_meters: SupportedDistance }
  ) => Promise<{ error: { message: string } | null }>

  const { error } = await rpc('recompute_personal_record_for_user_distance', {
    p_user_id: userId,
    p_distance_meters: distanceMeters,
  })

  if (error) {
    throw new Error(error.message)
  }
}

async function main() {
  const userIds = parseUserIds(process.argv.slice(2))
  const supabase = createClient(
    getSupabaseUrl(),
    getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )

  console.log('Starting targeted canonical PR recompute', {
    userIds,
    distances: SUPPORTED_DISTANCES,
    mode: 'explicit-user-list',
  })

  for (const userId of userIds) {
    console.log('Processing user', { userId })

    for (const distanceMeters of SUPPORTED_DISTANCES) {
      const before = await loadCanonical(supabase, userId, distanceMeters)
      await recomputeCanonical(supabase, userId, distanceMeters)
      const after = await loadCanonical(supabase, userId, distanceMeters)

      console.log('Recompute result', {
        userId,
        distanceMeters,
        before,
        after,
        changed: JSON.stringify(before) !== JSON.stringify(after),
      })
    }
  }

  console.log('Targeted canonical PR recompute finished', {
    userCount: userIds.length,
  })
}

main().catch((error) => {
  console.error('Targeted canonical PR recompute failed', {
    error: error instanceof Error ? error.message : 'unknown_error',
  })
  process.exitCode = 1
})
