import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { exchangeStravaCodeForToken } from '@/lib/strava/strava-client'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieStore = await cookies()
  const storedState = cookieStore.get('strava_oauth_state')?.value
  const cookieUserId = cookieStore.get('strava_connect_user_id')?.value ?? null
  const { user: authenticatedUser } = await getAuthenticatedUser()
  const connectUserId = authenticatedUser?.id ?? cookieUserId

  if (!code) {
    return NextResponse.json({
      ok: false,
      step: 'missing_code',
    })
  }

  if (!state || !storedState || state !== storedState) {
    return NextResponse.json({
      ok: false,
      step: 'invalid_state',
      expected: storedState ?? null,
      received: state,
    })
  }

  if (!connectUserId) {
    return NextResponse.json({
      ok: false,
      step: 'missing_connect_user_id',
    })
  }

  if (authenticatedUser?.id && cookieUserId && authenticatedUser.id !== cookieUserId) {
    return NextResponse.json({
      ok: false,
      step: 'user_mismatch',
      authenticatedUserId: authenticatedUser.id,
      cookieUserId,
    })
  }

  const supabase = await createSupabaseServerClient()

  try {
    const tokenResponse = await exchangeStravaCodeForToken(code)

    if (!tokenResponse.athlete?.id) {
      return NextResponse.json({
        ok: false,
        step: 'missing_athlete',
      })
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
      return NextResponse.json({
        ok: false,
        step: 'db_upsert_failed',
        error: selectError.message,
      })
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
      return NextResponse.json({
        ok: false,
        step: 'db_upsert_failed',
        error: saveError.message,
      })
    }

    return NextResponse.json({
      ok: true,
      step: 'connected',
      athleteId: String(tokenResponse.athlete.id),
      userId: connectUserId,
    })
  } catch (caughtError) {
    return NextResponse.json({
      ok: false,
      step: 'token_exchange_failed',
      error: caughtError instanceof Error ? caughtError.message : 'Unknown token exchange error',
    })
  }
}
