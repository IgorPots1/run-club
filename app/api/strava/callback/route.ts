import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { exchangeStravaCodeForToken } from '@/lib/strava/strava-client'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const debugMode = url.searchParams.get('debug') === '1'
  const cookieStore = await cookies()
  const storedState = cookieStore.get('strava_oauth_state')?.value
  const cookieUserId = cookieStore.get('strava_connect_user_id')?.value ?? null
  const { user: authenticatedUser } = await getAuthenticatedUser()
  const connectUserId = authenticatedUser?.id ?? cookieUserId

  function buildProfileRedirect(status: 'connected' | 'error') {
    return NextResponse.redirect(new URL(`/profile?strava=${status}`, url.origin))
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

    return response
  }

  if (!code) {
    if (debugMode) {
      return NextResponse.json({
        ok: false,
        step: 'missing_code',
      })
    }

    return clearStravaConnectCookies(buildProfileRedirect('error'))
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

    return clearStravaConnectCookies(buildProfileRedirect('error'))
  }

  if (!connectUserId) {
    if (debugMode) {
      return NextResponse.json({
        ok: false,
        step: 'missing_connect_user_id',
      })
    }

    return clearStravaConnectCookies(buildProfileRedirect('error'))
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

    return clearStravaConnectCookies(buildProfileRedirect('error'))
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

      return clearStravaConnectCookies(buildProfileRedirect('error'))
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

      return clearStravaConnectCookies(buildProfileRedirect('error'))
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

      return clearStravaConnectCookies(buildProfileRedirect('error'))
    }

    if (debugMode) {
      return NextResponse.json({
        ok: true,
        step: 'connected',
        athleteId: String(tokenResponse.athlete.id),
        userId: connectUserId,
      })
    }

    return clearStravaConnectCookies(buildProfileRedirect('connected'))
  } catch (caughtError) {
    if (debugMode) {
      return NextResponse.json({
        ok: false,
        step: 'token_exchange_failed',
        error: caughtError instanceof Error ? caughtError.message : 'Unknown token exchange error',
      })
    }

    return clearStravaConnectCookies(buildProfileRedirect('error'))
  }
}
