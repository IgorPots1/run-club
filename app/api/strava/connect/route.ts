import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { buildStravaAuthorizeUrl } from '@/lib/strava/strava-client'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return NextResponse.redirect(new URL('/login?error=strava_auth_required', process.env.NEXT_PUBLIC_APP_URL))
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

  return NextResponse.redirect(buildStravaAuthorizeUrl(state))
}
