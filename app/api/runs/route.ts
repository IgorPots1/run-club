import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export async function GET() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        ok: false,
        step: 'auth_required',
        error: error?.message ?? null,
      },
      { status: 401 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const { data, error: runsError } = await supabaseAdmin
    .from('runs')
    .select('id, user_id, name, title, distance_km, duration_minutes, duration_seconds, xp, created_at, external_source')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  if (runsError) {
    return NextResponse.json(
      {
        ok: false,
        step: 'runs_load_failed',
        error: runsError.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    runs: data ?? [],
  })
}
