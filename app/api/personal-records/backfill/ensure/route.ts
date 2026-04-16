import { NextResponse } from 'next/server'
import { ensureHistoricalPersonalRecordBackfillForUser } from '@/scripts/backfill-strava-personal-records.mjs'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export async function POST() {
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

  try {
    const result = await ensureHistoricalPersonalRecordBackfillForUser(user.id)

    return NextResponse.json({
      ok: true,
      triggered: result.triggered ?? false,
      reason: result.reason ?? null,
      jobStatus: result.jobStatus ?? null,
    })
  } catch (backfillError) {
    return NextResponse.json(
      {
        ok: false,
        step: 'backfill_ensure_failed',
        error: backfillError instanceof Error ? backfillError.message : 'unknown_error',
      },
      { status: 500 }
    )
  }
}
