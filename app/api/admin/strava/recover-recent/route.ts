import { NextResponse } from 'next/server'
import { writeAdminAuditEntry } from '@/lib/admin/audit'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { syncStravaRuns } from '@/lib/strava/strava-sync'

const RECOVERY_LOOKBACK_DAYS = 14
const RECOVERY_SYNC_MODE = 'backfill'

export async function POST() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        ok: false,
        step: 'auth_required',
        error: 'Authentication required',
      },
      { status: 401 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role, app_access_status')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    return NextResponse.json(
      {
        ok: false,
        step: 'admin_profile_lookup_failed',
        error: profileError.message,
      },
      { status: 500 }
    )
  }

  if (!profile || profile.app_access_status !== 'active' || profile.role !== 'admin') {
    return NextResponse.json(
      {
        ok: false,
        step: 'admin_required',
        error: 'Admin access required',
      },
      { status: 403 }
    )
  }

  try {
    const result = await syncStravaRuns(user.id, {
      mode: RECOVERY_SYNC_MODE,
      lookbackDays: RECOVERY_LOOKBACK_DAYS,
      ignoreCooldown: true,
    })

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          step: result.step,
          error:
            result.step === 'missing_connection'
              ? 'Strava not connected'
              : result.step === 'reconnect_required'
                ? 'Strava reconnect required'
                : result.step === 'rate_limited'
                  ? 'Strava rate limit cooldown is active'
                  : 'Recovery failed',
        },
        {
          status:
            result.step === 'missing_connection' || result.step === 'reconnect_required'
              ? 409
              : result.step === 'rate_limited'
                ? 429
                : 500,
        }
      )
    }

    await writeAdminAuditEntry({
      actorUserId: user.id,
      action: 'strava.recover_recent',
      entityType: 'strava_connection',
      entityId: user.id,
      payloadAfter: {
        mode: RECOVERY_SYNC_MODE,
        lookbackDays: RECOVERY_LOOKBACK_DAYS,
        imported: result.imported,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed,
        totalRunsFetched: result.totalRunsFetched,
      },
    })

    return NextResponse.json({
      ok: true,
      message: 'Восстановление завершено',
      mode: RECOVERY_SYNC_MODE,
      lookbackDays: RECOVERY_LOOKBACK_DAYS,
      imported: result.imported,
      updated: result.updated,
      skipped: result.skipped,
      failed: result.failed,
      totalRunsFetched: result.totalRunsFetched,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        step: 'recovery_failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      },
      { status: 500 }
    )
  }
}
