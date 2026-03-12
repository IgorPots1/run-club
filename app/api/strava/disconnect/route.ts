import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export async function DELETE() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        ok: false,
        step: 'auth_required',
      },
      { status: 401 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const { error: deleteError } = await supabaseAdmin
    .from('strava_connections')
    .delete()
    .eq('user_id', user.id)

  if (deleteError) {
    return NextResponse.json(
      {
        ok: false,
        step: 'disconnect_failed',
        error: deleteError.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
  })
}
