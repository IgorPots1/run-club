import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type PushUnsubscribeRequestBody = {
  endpoint?: string
}

export async function POST(request: Request) {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? 'auth_required',
      },
      { status: 401 }
    )
  }

  const body = await request.json().catch(() => null) as PushUnsubscribeRequestBody | null
  const endpoint = body?.endpoint?.trim() ?? ''

  if (!endpoint) {
    return NextResponse.json(
      {
        ok: false,
        error: 'endpoint_required',
      },
      { status: 400 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const { error: deleteError } = await supabaseAdmin
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', endpoint)

  if (deleteError) {
    return NextResponse.json(
      {
        ok: false,
        error: deleteError.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
  })
}
