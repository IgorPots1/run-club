import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getServerAuthDebug } from '@/lib/supabase-server'
import { syncStravaRuns } from '@/lib/strava/strava-sync'

export async function GET() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    const debug = await getServerAuthDebug('/api/strava/sync')

    return NextResponse.json({
      ok: false,
      step: 'auth_required',
      authUserId: null,
      error: error?.message ?? null,
      ...debug,
    })
  }

  try {
    const result = await syncStravaRuns(user.id)

    if (!result.ok) {
      return NextResponse.json(result)
    }

    return NextResponse.json({
      ok: true,
      step: 'initial_sync_complete',
      imported: result.imported,
      skipped: result.skipped,
      failed: result.failed,
      totalRunsFetched: result.totalRunsFetched,
      errors: result.errors,
      userId: user.id,
    })
  } catch (caughtError) {
    return NextResponse.json({
      ok: false,
      step: 'initial_sync_failed',
      error: caughtError instanceof Error ? caughtError.message : 'Unknown sync error',
    })
  }
}
