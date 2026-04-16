import { NextResponse } from 'next/server'
import { ensureHistoricalPersonalRecordBackfillForUser } from '@/scripts/backfill-strava-personal-records.mjs'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export async function POST(request: Request) {
  const url = new URL(request.url)
  const force = url.searchParams.get('force') === '1'

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
    const result = await ensureHistoricalPersonalRecordBackfillForUser(user.id, {
      ignoreCooldown: force,
    })

    return NextResponse.json({
      ok: true,
      triggered: result.triggered ?? false,
      reason: result.reason ?? null,
      jobStatus: result.jobStatus ?? null,
      cooldownUntil: result.cooldownUntil ?? null,
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
