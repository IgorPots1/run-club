import { NextResponse } from 'next/server'
import { backfillStravaSupplementalDataForRun } from '@/lib/strava/strava-sync'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        ok: false,
        step: 'auth_required',
        error: error?.message ?? null,
      },
      { status: 401 }
    )
  }

  const params = await context.params
  const runId = typeof params.id === 'string' ? params.id.trim() : ''

  if (!runId) {
    return NextResponse.json(
      {
        ok: false,
        step: 'invalid_run_id',
      },
      { status: 400 }
    )
  }

  try {
    const synced = await backfillStravaSupplementalDataForRun(user.id, runId)

    return NextResponse.json({
      ok: true,
      synced,
    })
  } catch (caughtError) {
    return NextResponse.json(
      {
        ok: false,
        step: 'strava_backfill_failed',
        error: caughtError instanceof Error ? caughtError.message : 'Unknown Strava backfill error',
      },
      { status: 500 }
    )
  }
}
