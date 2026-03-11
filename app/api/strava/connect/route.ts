import { NextResponse } from 'next/server'
import { buildStravaAuthorizeUrl } from '@/lib/strava/strava-client'

export async function GET() {
  return NextResponse.redirect(buildStravaAuthorizeUrl('debug-state'))
}