import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type PushSubscriptionRequestBody = {
  endpoint?: string
  keys?: {
    p256dh?: string
    auth?: string
  }
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

  const body = await request.json().catch(() => null) as PushSubscriptionRequestBody | null
  const endpoint = body?.endpoint?.trim() ?? ''
  const p256dh = body?.keys?.p256dh?.trim() ?? ''
  const auth = body?.keys?.auth?.trim() ?? ''
  const userAgent = request.headers.get('user-agent')

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_push_subscription',
      },
      { status: 400 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const now = new Date().toISOString()
  const { error: upsertError } = await supabaseAdmin
    .from('push_subscriptions')
    .upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
        updated_at: now,
      },
      {
        onConflict: 'endpoint',
        ignoreDuplicates: false,
      }
    )

  if (upsertError) {
    return NextResponse.json(
      {
        ok: false,
        error: upsertError.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
  })
}
