import { NextResponse } from 'next/server'
import { recoverKnownHistoricalPersonalRecord } from '@/app/api/admin/personal-records/recover-known-historical-pr/route'

const TEMP_RECOVERY_USER_ID = '9c831c40-928d-4d0c-99f7-393b2b985290'

// TEMP route for manual browser-triggered PR recovery.
export async function GET() {
  await recoverKnownHistoricalPersonalRecord(TEMP_RECOVERY_USER_ID)

  return NextResponse.json({
    success: true,
  })
}
