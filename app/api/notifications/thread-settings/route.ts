import { NextResponse } from 'next/server'
import {
  isPushLevel,
  normalizeThreadPushLevel,
  type PushLevel,
  type ThreadPushLevelRow,
} from '@/lib/notifications/push'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type ThreadSettingsResponse = {
  ok: true
  threadId: string
  push_level: PushLevel
  muted: boolean
}

type ThreadSettingsPatchRequestBody = {
  threadId?: string | null
  push_level?: string | null
}

function createAuthRequiredResponse(errorMessage?: string) {
  return NextResponse.json(
    {
      ok: false,
      error: errorMessage ?? 'auth_required',
    },
    { status: 401 }
  )
}

function createThreadSettingsResponse(threadId: string, row: ThreadPushLevelRow | null | undefined) {
  const pushLevel = normalizeThreadPushLevel(row)

  return {
    ok: true,
    threadId,
    push_level: pushLevel,
    muted: pushLevel === 'mute',
  } satisfies ThreadSettingsResponse
}

export async function GET(request: Request) {
  const { user, error, supabase } = await getAuthenticatedUser()

  if (error || !user) {
    return createAuthRequiredResponse(error?.message)
  }

  const url = new URL(request.url)
  const threadId = url.searchParams.get('threadId')?.trim() ?? ''

  if (!threadId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'thread_id_required',
      },
      { status: 400 }
    )
  }

  const { data, error: loadError } = await supabase
    .from('user_notification_settings')
    .select('muted, push_level')
    .eq('user_id', user.id)
    .eq('thread_id', threadId)
    .maybeSingle()

  if (loadError) {
    return NextResponse.json(
      {
        ok: false,
        error: loadError.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json(
    createThreadSettingsResponse(threadId, (data as ThreadPushLevelRow | null) ?? null)
  )
}

export async function PATCH(request: Request) {
  const { user, error, supabase } = await getAuthenticatedUser()

  if (error || !user) {
    return createAuthRequiredResponse(error?.message)
  }

  const body = await request.json().catch(() => null) as ThreadSettingsPatchRequestBody | null
  const threadId = body?.threadId?.trim() ?? ''
  const pushLevel = body?.push_level?.trim() ?? ''

  if (!threadId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'thread_id_required',
      },
      { status: 400 }
    )
  }

  if (!isPushLevel(pushLevel)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_push_level',
      },
      { status: 400 }
    )
  }

  const { data, error: upsertError } = await supabase
    .from('user_notification_settings')
    .upsert(
      {
        user_id: user.id,
        thread_id: threadId,
        push_level: pushLevel,
        muted: pushLevel === 'mute',
      },
      {
        onConflict: 'user_id,thread_id',
        ignoreDuplicates: false,
      }
    )
    .select('muted, push_level')
    .single()

  if (upsertError) {
    const status = upsertError.code === '23503' ? 400 : 500
    const errorCode = upsertError.code === '23503' ? 'thread_not_found' : upsertError.message

    return NextResponse.json(
      {
        ok: false,
        error: errorCode,
      },
      { status }
    )
  }

  return NextResponse.json(
    createThreadSettingsResponse(threadId, (data as ThreadPushLevelRow | null) ?? null)
  )
}
