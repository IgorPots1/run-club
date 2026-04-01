import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export async function getFirstSessionState(userId: string) {
  const supabaseAdmin = createSupabaseAdminClient()
  const [{ count: runsCount, error: runsError }, { data: stravaConnection, error: stravaError }] = await Promise.all([
    supabaseAdmin
      .from('runs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    supabaseAdmin
      .from('strava_connections')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  if (runsError) {
    throw new Error(`first_session_runs_check_failed:${runsError.message}`)
  }

  if (stravaError) {
    throw new Error(`first_session_strava_check_failed:${stravaError.message}`)
  }

  const hasRuns = (runsCount ?? 0) > 0
  const hasStravaConnection = Boolean(stravaConnection)
  const isFirstSession = !hasRuns && !hasStravaConnection

  return {
    hasRuns,
    hasStravaConnection,
    isFirstSession,
  }
}

export async function getPostAuthRedirectPath(userId: string) {
  const { isFirstSession } = await getFirstSessionState(userId)

  return isFirstSession ? '/onboarding' : '/dashboard'
}
