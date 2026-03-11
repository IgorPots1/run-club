import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { syncStravaRuns } from '@/lib/strava/strava-sync'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const queryUserId = url.searchParams.get('userId')?.trim() ?? ''
  const cookieStore = await cookies()
  const cookieUserId = cookieStore.get('strava_connect_user_id')?.value?.trim() ?? ''
  const userId = queryUserId || cookieUserId

  if (!userId) {
    return NextResponse.json({
      ok: false,
      step: 'missing_user_id',
    })
  }

  try {
    const result = await syncStravaRuns(userId)

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
    })
  } catch (caughtError) {
    return NextResponse.json({
      ok: false,
      step: 'initial_sync_failed',
      error: caughtError instanceof Error ? caughtError.message : 'Unknown sync error',
    })
  }
}
