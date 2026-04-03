import { NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type ChatReadersRequestBody = {
  messageId?: string | null
}

type ChatMessageReaderRow = {
  user_id: string
  name: string | null
  nickname: string | null
  avatar_url: string | null
  last_read_at: string | null
}

const CHAT_READERS_API_ERROR_MESSAGE_BY_CODE: Record<string, string> = {
  auth_required: 'Authentication is required.',
  invalid_message_id: 'Message id is invalid.',
  chat_message_not_found: 'Chat message not found.',
  thread_not_found: 'Chat thread not found.',
  thread_access_denied: 'You do not have access to this chat thread.',
}

function getChatReadersApiErrorStatus(errorCode: string) {
  switch (errorCode) {
    case 'auth_required':
      return 401
    case 'chat_message_not_found':
    case 'thread_not_found':
      return 404
    case 'thread_access_denied':
      return 403
    default:
      return 400
  }
}

function createChatReadersApiErrorResponse(errorCode: string) {
  return NextResponse.json(
    {
      ok: false,
      error: errorCode,
      message: CHAT_READERS_API_ERROR_MESSAGE_BY_CODE[errorCode] ?? 'Chat readers request failed.',
    },
    {
      status: getChatReadersApiErrorStatus(errorCode),
    }
  )
}

function resolveChatReadersErrorCode(error: { message?: string | null } | null) {
  const message = error?.message ?? ''

  if (message.includes('invalid_message_id')) {
    return 'invalid_message_id'
  }

  if (message.includes('chat_message_not_found')) {
    return 'chat_message_not_found'
  }

  if (message.includes('thread_not_found')) {
    return 'thread_not_found'
  }

  if (message.includes('thread_access_denied')) {
    return 'thread_access_denied'
  }

  return null
}

export async function POST(request: Request) {
  const { supabase, user, error: userError } = await getAuthenticatedUser()
  const body = await request.json().catch(() => null) as ChatReadersRequestBody | null
  const messageId = body?.messageId?.trim() ?? ''

  if (userError || !user) {
    return createChatReadersApiErrorResponse('auth_required')
  }

  if (!messageId) {
    return createChatReadersApiErrorResponse('invalid_message_id')
  }

  const { data, error } = await supabase.rpc('get_message_readers', {
    p_message_id: messageId,
  })

  if (error) {
    const errorCode = resolveChatReadersErrorCode(error)

    if (errorCode) {
      return createChatReadersApiErrorResponse(errorCode)
    }

    return NextResponse.json(
      {
        ok: false,
        error: error.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    readers: ((data as ChatMessageReaderRow[] | null) ?? []).map((reader) => ({
      user_id: reader.user_id,
      name: reader.name ?? null,
      nickname: reader.nickname ?? null,
      avatar_url: reader.avatar_url ?? null,
      last_read_at: reader.last_read_at ?? null,
    })),
  })
}
