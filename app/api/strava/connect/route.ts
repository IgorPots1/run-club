import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getServerAuthDebug } from '@/lib/supabase-server'
import { buildStravaAuthorizeUrl } from '@/lib/strava/strava-client'

export async function GET() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    const debug = await getServerAuthDebug('/api/strava/connect')

    return NextResponse.json(
      {
        ok: false,
        step: 'auth_required',
        authUserId: null,
        error: error?.message ?? null,
        ...debug,
      },
      { status: 401 }
    )
  }

  const state = crypto.randomUUID()
  const cookieStore = await cookies()

  cookieStore.set('strava_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 10,
  })

  cookieStore.set('strava_connect_user_id', user.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 10,
  })

  return NextResponse.redirect(buildStravaAuthorizeUrl(state))
}