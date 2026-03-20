import { NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { syncStravaRuns } from '@/lib/strava/strava-sync'

type SyncDebugDiagnostics = {
  totalActivitiesFetched: number
  runActivitiesCount: number
  imported: number
  failed: number
  firstFailure: { activityId: string; error: string; field?: string; value?: number | string | null } | null
  targetedAuthUserExists?: boolean
  targetedAuthUserId?: string | null
  targetedRunFound?: boolean
  targetedResolvedRunId?: string | null
  targetedResolvedRunUserId?: string | null
  targetedResolvedRunSource?: string | null
  targetedResolvedRunExternalId?: string | null
  targetedResolvedRunStravaActivityId?: number | null
  targetedComparisonUserId?: string | null
  targetedOwnerComparisonResult?: boolean
  targetedOwnerCheckPassed?: boolean
  targetedStopReason?: string | null
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
    targetedAuthUserExists?: boolean
    targetedAuthUserId?: string | null
    targetedRunFound?: boolean
    targetedResolvedRunId?: string | null
    targetedResolvedRunUserId?: string | null
    targetedResolvedRunSource?: string | null
    targetedResolvedRunExternalId?: string | null
    targetedResolvedRunStravaActivityId?: number | null
    targetedComparisonUserId?: string | null
    targetedOwnerComparisonResult?: boolean
    targetedOwnerCheckPassed?: boolean
    targetedStopReason?: string | null
  }
}): SyncDebugDiagnostics {
  return {
    totalActivitiesFetched: source.debug?.totalActivitiesFetched ?? 0,
    runActivitiesCount: source.debug?.runActivitiesCount ?? 0,
    imported: source.debug?.imported ?? 0,
    failed: source.debug?.failed ?? 0,
    firstFailure: source.debug?.firstFailure ?? null,
    targetedAuthUserExists: source.debug?.targetedAuthUserExists ?? undefined,
    targetedAuthUserId: source.debug?.targetedAuthUserId ?? undefined,
    targetedRunFound: source.debug?.targetedRunFound ?? undefined,
    targetedResolvedRunId: source.debug?.targetedResolvedRunId ?? undefined,
    targetedResolvedRunUserId: source.debug?.targetedResolvedRunUserId ?? undefined,
    targetedResolvedRunSource: source.debug?.targetedResolvedRunSource ?? undefined,
    targetedResolvedRunExternalId: source.debug?.targetedResolvedRunExternalId ?? undefined,
    targetedResolvedRunStravaActivityId: source.debug?.targetedResolvedRunStravaActivityId ?? undefined,
    targetedComparisonUserId: source.debug?.targetedComparisonUserId ?? undefined,
    targetedOwnerComparisonResult: source.debug?.targetedOwnerComparisonResult ?? undefined,
    targetedOwnerCheckPassed: source.debug?.targetedOwnerCheckPassed ?? undefined,
    targetedStopReason: source.debug?.targetedStopReason ?? undefined,
  }
}

export async function GET(request: Request) {
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
      mode: 'backfill',
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
      console.info('[run-detail-debug] targeted_sync_route_result', {
        authUserExists: Boolean(user),
        authUserId: user.id,
        targetedRunId: result.debug?.targetedRunId ?? debugRunId,
        targetedRunFound: result.debug?.targetedRunFound ?? null,
        targetedResolvedRunId: result.debug?.targetedResolvedRunId ?? null,
        targetedResolvedRunUserId: result.debug?.targetedResolvedRunUserId ?? null,
        targetedResolvedRunSource: result.debug?.targetedResolvedRunSource ?? null,
        targetedResolvedRunExternalId: result.debug?.targetedResolvedRunExternalId ?? null,
        targetedResolvedRunStravaActivityId: result.debug?.targetedResolvedRunStravaActivityId ?? null,
        targetedComparisonUserId: result.debug?.targetedComparisonUserId ?? null,
        targetedOwnerComparisonResult: result.debug?.targetedOwnerComparisonResult ?? null,
        targetedOwnerCheckPassed: result.debug?.targetedOwnerCheckPassed ?? null,
        targetedStopReason: result.debug?.targetedStopReason ?? null,
      })

      return NextResponse.json({
        ok: true,
        authUserExists: Boolean(user),
        authUserId: user.id,
        targetedRunId: result.debug?.targetedRunId ?? debugRunId,
        targetedRunFound: result.debug?.targetedRunFound ?? false,
        targetedResolvedRunId: result.debug?.targetedResolvedRunId ?? null,
        targetedResolvedRunUserId: result.debug?.targetedResolvedRunUserId ?? null,
        targetedResolvedRunSource: result.debug?.targetedResolvedRunSource ?? null,
        targetedResolvedRunExternalId: result.debug?.targetedResolvedRunExternalId ?? null,
        targetedResolvedRunStravaActivityId: result.debug?.targetedResolvedRunStravaActivityId ?? null,
        targetedComparisonUserId: result.debug?.targetedComparisonUserId ?? null,
        targetedOwnerComparisonResult: result.debug?.targetedOwnerComparisonResult ?? false,
        targetedActivityId: result.debug?.targetedActivityId ?? null,
        targetedOwnerCheckPassed: result.debug?.targetedOwnerCheckPassed ?? false,
        targetedSyncAttempted: result.debug?.targetedSyncAttempted ?? false,
        targetedSyncSucceeded: result.debug?.targetedSyncSucceeded ?? false,
        targetedOwnerMismatch: result.debug?.targetedOwnerMismatch ?? false,
        targetedRunOwnerUserId: result.debug?.targetedRunOwnerUserId ?? null,
        targetedStopReason: result.debug?.targetedStopReason ?? null,
      })
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
