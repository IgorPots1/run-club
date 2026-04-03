import { NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type NotificationUnmuteRequestBody = {
  threadId?: string | null
}

export async function POST(request: Request) {
  const { user, error, supabase } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? 'auth_required',
      },
      { status: 401 }
    )
  }

  const body = await request.json().catch(() => null) as NotificationUnmuteRequestBody | null
  const threadId = body?.threadId?.trim() ?? ''

  if (!threadId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'thread_id_required',
      },
      { status: 400 }
    )
  }

  const { error: upsertError } = await supabase
    .from('user_notification_settings')
    .upsert(
      {
        user_id: user.id,
        thread_id: threadId,
        muted: false,
        push_level: 'all',
      },
      {
        onConflict: 'user_id,thread_id',
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
    muted: false,
  })
}
