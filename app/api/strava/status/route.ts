import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export async function GET() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        ok: false,
        step: 'auth_required',
      },
      { status: 401 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()

  const [{ data: connection, error: connectionError }, { count: importedRunsCount, error: runsError }] =
    await Promise.all([
      supabaseAdmin
        .from('strava_connections')
        .select('id', { count: 'exact', head: false })
        .eq('user_id', user.id)
        .maybeSingle(),
      supabaseAdmin
        .from('runs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('external_source', 'strava'),
    ])

  if (connectionError || runsError) {
    return NextResponse.json(
      {
        ok: false,
        step: 'status_load_failed',
        error: connectionError?.message ?? runsError?.message ?? 'Unknown status error',
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    connected: Boolean(connection),
    hasImportedRuns: (importedRunsCount ?? 0) > 0,
  })
}
