import { cookies } from 'next/headers'
import { after, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { runInitialPersonalRecordsSyncForUser } from '@/lib/personal-records/runInitialPersonalRecordsSyncForUser'
import { exchangeStravaCodeForToken } from '@/lib/strava/strava-client'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const debugMode = url.searchParams.get('debug') === '1'
  const cookieStore = await cookies()
  const storedState = cookieStore.get('strava_oauth_state')?.value
  const cookieUserId = cookieStore.get('strava_connect_user_id')?.value ?? null
  const cookieNextPath = cookieStore.get('strava_connect_next')?.value ?? null
  const { user: authenticatedUser } = await getAuthenticatedUser()
  const connectUserId = authenticatedUser?.id ?? cookieUserId
  const nextPath =
    cookieNextPath && cookieNextPath.startsWith('/') && !cookieNextPath.startsWith('//')
      ? cookieNextPath
      : '/profile'

  function buildRedirect(status: 'connected' | 'error') {
    const redirectUrl = new URL(nextPath, url.origin)
    redirectUrl.searchParams.set('strava', status)
    return NextResponse.redirect(redirectUrl)
  }

  function clearStravaConnectCookies(response: NextResponse) {
    response.cookies.set('strava_oauth_state', '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    })

    response.cookies.set('strava_connect_user_id', '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    })

    response.cookies.set('strava_connect_next', '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    })

    return response
  }

  if (!code) {
    if (debugMode) {
      return NextResponse.json({
        ok: false,
        step: 'missing_code',
      })
    }

    return clearStravaConnectCookies(buildRedirect('error'))
  }

  if (!state || !storedState || state !== storedState) {
    if (debugMode) {
      return NextResponse.json({
        ok: false,
        step: 'invalid_state',
        expected: storedState ?? null,
        received: state,
      })
    }

    return clearStravaConnectCookies(buildRedirect('error'))
  }

  if (!connectUserId) {
    if (debugMode) {
      return NextResponse.json({
        ok: false,
        step: 'missing_connect_user_id',
      })
    }

    return clearStravaConnectCookies(buildRedirect('error'))
  }

  if (authenticatedUser?.id && cookieUserId && authenticatedUser.id !== cookieUserId) {
    if (debugMode) {
      return NextResponse.json({
        ok: false,
        step: 'user_mismatch',
        authenticatedUserId: authenticatedUser.id,
        cookieUserId,
      })
    }

    return clearStravaConnectCookies(buildRedirect('error'))
  }

  const supabase = await createSupabaseServerClient()

  try {
    const tokenResponse = await exchangeStravaCodeForToken(code)

    if (!tokenResponse.athlete?.id) {
      if (debugMode) {
        return NextResponse.json({
          ok: false,
          step: 'missing_athlete',
        })
      }

      return clearStravaConnectCookies(buildRedirect('error'))
    }

    const connectionPayload = {
      user_id: connectUserId,
      strava_athlete_id: tokenResponse.athlete.id,
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      expires_at: new Date(tokenResponse.expires_at * 1000).toISOString(),
      last_synced_at: null,
      status: 'connected',
    }

    const { data: existingConnection, error: selectError } = await supabase
      .from('strava_connections')
      .select('id')
      .eq('user_id', connectUserId)
      .maybeSingle()

    if (selectError) {
      if (debugMode) {
        return NextResponse.json({
          ok: false,
          step: 'db_upsert_failed',
          error: selectError.message,
        })
      }

      return clearStravaConnectCookies(buildRedirect('error'))
    }

    const { error: saveError } = existingConnection
      ? await supabase
          .from('strava_connections')
          .update({
            strava_athlete_id: connectionPayload.strava_athlete_id,
            access_token: connectionPayload.access_token,
            refresh_token: connectionPayload.refresh_token,
            expires_at: connectionPayload.expires_at,
            last_synced_at: connectionPayload.last_synced_at,
            status: connectionPayload.status,
          })
          .eq('id', existingConnection.id)
      : await supabase.from('strava_connections').insert(connectionPayload)

    if (saveError) {
      if (debugMode) {
        return NextResponse.json({
          ok: false,
          step: 'db_upsert_failed',
          error: saveError.message,
        })
      }

      return clearStravaConnectCookies(buildRedirect('error'))
    }

    after(async () => {
      try {
        const result = await runInitialPersonalRecordsSyncForUser(connectUserId)

        if (result.status === 'failed') {
          console.error('Failed to run personal records sync after Strava connect', {
            userId: connectUserId,
            error: result.error,
            backfillReason: result.backfillReason ?? null,
            backfillJobStatus: result.backfillJobStatus ?? null,
          })
        }
      } catch (syncError) {
        console.error('Failed to run personal records sync after Strava connect', {
          userId: connectUserId,
          error: syncError instanceof Error ? syncError.message : 'unknown_error',
        })
      }
    })

    if (debugMode) {
      return NextResponse.json({
        ok: true,
        step: 'connected',
        athleteId: String(tokenResponse.athlete.id),
        userId: connectUserId,
      })
    }

    return clearStravaConnectCookies(buildRedirect('connected'))
  } catch (caughtError) {
    if (debugMode) {
      return NextResponse.json({
        ok: false,
        step: 'token_exchange_failed',
        error: caughtError instanceof Error ? caughtError.message : 'Unknown token exchange error',
      })
    }

    return clearStravaConnectCookies(buildRedirect('error'))
  }
}
