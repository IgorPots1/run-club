import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { buildStravaAuthorizeUrl } from '@/lib/strava/strava-client'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const userId = url.searchParams.get('userId')?.trim() ?? ''

  if (!userId) {
    return NextResponse.json({
      ok: false,
      step: 'missing_user_id',
    })
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

  cookieStore.set('strava_connect_user_id', userId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 10,
  })

  return NextResponse.redirect(buildStravaAuthorizeUrl(state))
}