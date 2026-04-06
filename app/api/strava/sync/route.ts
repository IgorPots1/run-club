import { NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { syncStravaRuns } from '@/lib/strava/strava-sync'

type SyncDebugDiagnostics = {
  totalActivitiesFetched: number
  runActivitiesCount: number
  imported: number
  failed: number
  firstFailure: { activityId: string; error: string; field?: string; value?: number | string | null } | null
}

function buildDebugDiagnostics(source: {
  debug?: {
    totalActivitiesFetched?: number
    runActivitiesCount?: number
    imported?: number
    failed?: number
    firstFailure?: { activityId: string; error: string; field?: string; value?: number | string | null } | null
    targetedRunId?: string | null
    targetedActivityId?: number | null
    targetedSyncAttempted?: boolean
    targetedSyncSucceeded?: boolean
    targetedOwnerMismatch?: boolean
    targetedRunOwnerUserId?: string | null
    targetedLapsFetchedCount?: number
    targetedLapsSavedCount?: number
    targetedLapsStatus?: 'fetched_and_saved' | 'fetched_but_not_saved' | 'no_laps_returned' | 'laps_fetch_failed'
    targetedLapsErrorMessage?: string | null
    targetedLapsHttpStatus?: number | null
  }
}): SyncDebugDiagnostics {
  return {
    totalActivitiesFetched: source.debug?.totalActivitiesFetched ?? 0,
    runActivitiesCount: source.debug?.runActivitiesCount ?? 0,
    imported: source.debug?.imported ?? 0,
    failed: source.debug?.failed ?? 0,
    firstFailure: source.debug?.firstFailure ?? null,
  }
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  const debugMode = url.searchParams.get('debug') === '1'
  const debugRunId = url.searchParams.get('debugRunId')?.trim() || null
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    // #region agent log
    console.info('[strava-sync-debug] auth_required', {
      hasUser: Boolean(user),
      authError: error?.message ?? null,
    })
    // #endregion
    return NextResponse.json({
      ok: false,
      step: 'auth_required',
      error: error?.message ?? null,
    }, { status: 401 })
  }

  // #region agent log
  console.info('[strava-sync-debug] route_enter', {
    userId: user.id,
  })
  // #endregion
  console.info('[run-detail-debug] sync_route_start', {
    userId: user.id,
    debugRunId,
  })

  try {
    const result = await syncStravaRuns(user.id, {
      mode: debugRunId ? 'backfill' : 'incremental',
      ...(debugRunId ? { debugRunId } : {}),
    })

    if (!result.ok) {
      // #region agent log
      console.info('[strava-sync-debug] sync_not_ok', {
        userId: user.id,
        step: result.step,
        debug: result.debug ?? null,
      })
      // #endregion
      if (result.step === 'reconnect_required') {
        return NextResponse.json(
          {
            ...result,
            ...(debugMode ? { debug: buildDebugDiagnostics(result) } : {}),
          },
          { status: 401 }
        )
      }

      return NextResponse.json({
        ...result,
        ...(debugMode ? { debug: buildDebugDiagnostics(result) } : {}),
      })
    }

    // #region agent log
    console.info('[strava-sync-debug] sync_ok', {
      userId: user.id,
      imported: result.imported,
      skipped: result.skipped,
      failed: result.failed,
      totalRunsFetched: result.totalRunsFetched,
      debug: result.debug ?? null,
    })
    // #endregion

    if (debugRunId) {
      return NextResponse.json({
        ok: true,
        debugVersion: 'strava-debug-v2',
        targetedRunId: result.debug?.targetedRunId ?? debugRunId,
        targetedActivityId: result.debug?.targetedActivityId ?? null,
        targetedSyncAttempted: result.debug?.targetedSyncAttempted ?? false,
        targetedSyncSucceeded: result.debug?.targetedSyncSucceeded ?? false,
        targetedOwnerMismatch: result.debug?.targetedOwnerMismatch ?? false,
        targetedRunOwnerUserId: result.debug?.targetedRunOwnerUserId ?? null,
        targetedLapsFetchedCount: result.debug?.targetedLapsFetchedCount ?? 0,
        targetedLapsSavedCount: result.debug?.targetedLapsSavedCount ?? 0,
        targetedLapsStatus: result.debug?.targetedLapsStatus ?? 'laps_fetch_failed',
        targetedLapsErrorMessage: result.debug?.targetedLapsErrorMessage ?? null,
        targetedLapsHttpStatus: result.debug?.targetedLapsHttpStatus ?? null,
        detailedActivityDebug: result.debug?.detailedActivityDebug ?? null,
      })
    }

    return NextResponse.json({
      ok: true,
      step: 'initial_sync_complete',
      imported: result.imported,
      skipped: result.skipped,
      failed: result.failed,
      totalRunsFetched: result.totalRunsFetched,
      xpGained: result.xpGained ?? 0,
      breakdown: result.breakdown ?? [],
      levelUp: result.levelUp === true,
      newLevel: result.newLevel ?? null,
      errors: result.errors,
      userId: user.id,
      ...(debugMode ? { debug: buildDebugDiagnostics(result) } : {}),
    })
  } catch (caughtError) {
    // #region agent log
    console.error('[strava-sync-debug] sync_exception', {
      userId: user.id,
      error: caughtError instanceof Error ? caughtError.message : 'Unknown sync error',
    })
    // #endregion
    return NextResponse.json({
      ok: false,
      step: 'initial_sync_failed',
      error: caughtError instanceof Error ? caughtError.message : 'Unknown sync error',
      ...(debugMode
        ? {
            debug: {
              totalActivitiesFetched: 0,
              runActivitiesCount: 0,
              imported: 0,
              failed: 0,
              firstFailure: {
                activityId: 'n/a',
                error: caughtError instanceof Error ? caughtError.message : 'Unknown sync error',
              },
            },
          }
        : {}),
    })
  }
}
