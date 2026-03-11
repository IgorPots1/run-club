import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { exchangeStravaCodeForToken } from '@/lib/strava/strava-client'

function buildAppRedirect(path: string) {
  return new URL(path, process.env.NEXT_PUBLIC_APP_URL)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieStore = await cookies()
  const storedState = cookieStore.get('strava_oauth_state')?.value

  if (!code || !state || !storedState || state !== storedState) {
    const response = NextResponse.redirect(buildAppRedirect('/profile?error=strava_callback'))
    response.cookies.delete('strava_oauth_state')
    return response
  }

  const { supabase, user, error } = await getAuthenticatedUser()

  if (error || !user) {
    const response = NextResponse.redirect(buildAppRedirect('/login?error=strava_auth_required'))
    response.cookies.delete('strava_oauth_state')
    return response
  }

  try {
    const tokenResponse = await exchangeStravaCodeForToken(code)
    const { error: upsertError } = await supabase.from('strava_connections').upsert(
      {
        user_id: user.id,
        strava_athlete_id: tokenResponse.athlete.id,
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token,
        expires_at: new Date(tokenResponse.expires_at * 1000).toISOString(),
        last_synced_at: null,
        status: 'connected',
      },
      {
        onConflict: 'user_id',
        ignoreDuplicates: false,
      }
    )

    if (upsertError) {
      const response = NextResponse.redirect(buildAppRedirect('/profile?error=strava_save_failed'))
      response.cookies.delete('strava_oauth_state')
      return response
    }

    const response = NextResponse.redirect(buildAppRedirect('/profile?strava=connected'))
    response.cookies.delete('strava_oauth_state')
    return response
  } catch {
    const response = NextResponse.redirect(buildAppRedirect('/profile?error=strava_exchange_failed'))
    response.cookies.delete('strava_oauth_state')
    return response
  }
}
