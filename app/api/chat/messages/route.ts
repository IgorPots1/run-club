import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAppEvent } from '@/lib/events/createAppEvent'
import { getProfileDisplayName } from '@/lib/profiles'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthenticatedUser } from '@/lib/supabase-server'

type TextChatMessageRequestBody = {
  kind?: 'text'
  text?: string
  replyToId?: string | null
  threadId?: string | null
  imageUrl?: string | null
}

type VoiceChatMessageRequestBody = {
  kind: 'voice'
  mediaPath?: string
  mediaDurationSeconds?: number | null
  replyToId?: string | null
  threadId?: string | null
}

type CreateChatMessageRequestBody = TextChatMessageRequestBody | VoiceChatMessageRequestBody

type InsertedChatMessageRow = {
  id: string
  user_id: string
  text: string | null
  message_type: string | null
  image_url: string | null
  media_url: string | null
  thread_id: string | null
}

type ChatThreadRow = {
  id: string
  type: 'club' | 'direct_coach'
  owner_user_id: string | null
  coach_user_id: string | null
}

type SenderProfileRow = {
  name: string | null
  nickname: string | null
  email: string | null
}

async function resolveSafeReplyToId(
  supabase: SupabaseClient,
  replyToId?: string | null,
  threadId?: string | null
) {
  if (!replyToId) {
    return null
  }

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, thread_id')
    .eq('id', replyToId)
    .maybeSingle()

  if (error) {
    throw error
  }

  const originalThreadId = ((data as { id: string; thread_id: string | null } | null) ?? null)?.thread_id ?? null
  const currentThreadId = threadId ?? null

  return originalThreadId === currentThreadId ? replyToId : null
}

function getMessagePreview(message: Pick<InsertedChatMessageRow, 'text' | 'message_type' | 'image_url' | 'media_url'>) {
  const trimmedText = message.text?.trim() ?? ''

  if (trimmedText) {
    return trimmedText
  }

  if (message.message_type === 'voice') {
    return 'Голосовое сообщение'
  }

  if (message.image_url || message.media_url) {
    return 'Фото'
  }

  return ''
}

async function emitChatMessageCreatedEvent(message: InsertedChatMessageRow) {
  if (!message.thread_id) {
    return
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient()
    const { data: thread, error: threadError } = await supabaseAdmin
      .from('chat_threads')
      .select('id, type, owner_user_id, coach_user_id')
      .eq('id', message.thread_id)
      .maybeSingle()

    if (threadError) {
      throw threadError
    }

    const directThread = (thread as ChatThreadRow | null) ?? null

    if (!directThread || directThread.type !== 'direct_coach') {
      return
    }

    const recipientUserIds = Array.from(
      new Set([directThread.owner_user_id, directThread.coach_user_id].filter((userId): userId is string => Boolean(userId)))
    ).filter((userId) => userId !== message.user_id)

    if (recipientUserIds.length === 0) {
      return
    }

    const { data: senderProfile, error: senderProfileError } = await supabaseAdmin
      .from('profiles')
      .select('name, nickname, email')
      .eq('id', message.user_id)
      .maybeSingle()

    if (senderProfileError) {
      throw senderProfileError
    }

    const senderName = getProfileDisplayName((senderProfile as SenderProfileRow | null) ?? null, 'Бегун')
    const messagePreview = getMessagePreview(message)

    await Promise.all(
      recipientUserIds.map((recipientUserId) =>
        createAppEvent({
          type: 'chat_message.created',
          actorUserId: message.user_id,
          targetUserId: recipientUserId,
          entityType: 'chat_message',
          entityId: message.id,
          payload: {
            threadId: message.thread_id,
            messagePreview,
            senderName,
          },
        })
      )
    )
  } catch (error) {
    console.error('Failed to create chat message app event', {
      messageId: message.id,
      threadId: message.thread_id,
      actorUserId: message.user_id,
      error: error instanceof Error ? error.message : 'unknown_error',
    })
  }
}

export async function POST(request: Request) {
  const { user, error: userError, supabase } = await getAuthenticatedUser()

  if (userError || !user) {
    return NextResponse.json(
      {
        ok: false,
        error: userError?.message ?? 'auth_required',
      },
      { status: 401 }
    )
  }

  const body = await request.json().catch(() => null) as CreateChatMessageRequestBody | null
  const kind = body?.kind === 'voice' ? 'voice' : 'text'
  const threadId = body?.threadId?.trim() || null
  const replyToId = body?.replyToId?.trim() || null
  const voiceBody = kind === 'voice' ? (body as VoiceChatMessageRequestBody | null) : null
  const textBody = kind === 'text' ? (body as TextChatMessageRequestBody | null) : null

  try {
    const safeReplyToId = await resolveSafeReplyToId(supabase, replyToId, threadId)

    const insertPayload =
      kind === 'voice'
        ? (() => {
            const mediaPath = voiceBody?.mediaPath?.trim() ?? ''

            if (!mediaPath) {
              throw new Error('empty_voice_message')
            }

            return {
              user_id: user.id,
              text: '',
              message_type: 'voice',
              media_url: mediaPath,
              media_duration_seconds: voiceBody?.mediaDurationSeconds ?? null,
              image_url: null,
              reply_to_id: safeReplyToId,
              thread_id: threadId,
            }
          })()
        : (() => {
            const text = textBody?.text?.trim() ?? ''
            const imageUrl = textBody?.imageUrl?.trim() || null

            if (!text && !imageUrl) {
              throw new Error('empty_message')
            }

            if (text.length > 500) {
              throw new Error('message_too_long')
            }

            return {
              user_id: user.id,
              text,
              image_url: imageUrl,
              reply_to_id: safeReplyToId,
              thread_id: threadId,
            }
          })()

    const { data, error } = await supabase
      .from('chat_messages')
      .insert(insertPayload)
      .select('id, user_id, text, message_type, image_url, media_url, thread_id')
      .single()

    if (error) {
      throw error
    }

    const message = data as InsertedChatMessageRow
    await emitChatMessageCreatedEvent(message)

    return NextResponse.json({
      ok: true,
      message,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'chat_message_create_failed'
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 400 }
    )
  }
}
