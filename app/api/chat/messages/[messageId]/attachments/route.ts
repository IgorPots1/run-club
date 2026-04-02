import { NextResponse } from 'next/server'
import { CHAT_PERF_DEBUG_PREFIX } from '@/lib/chatPerfDebug'
import { decodeRequestUserId } from '@/lib/server/chatRequestAuth'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type ChatMessageAttachmentRequestBody = {
  type?: 'image'
  threadId?: string | null
  storagePath?: string
  width?: number | null
  height?: number | null
  sortOrder?: number | null
}

const CHAT_MEDIA_BUCKET = 'chat-media'
const CHAT_MESSAGE_MAX_ATTACHMENTS = 8
const SAFE_STORAGE_PATH_SEGMENT_REGEX = /^[A-Za-z0-9_-]+$/
const SAFE_STORAGE_FILE_NAME_REGEX = /^[A-Za-z0-9._-]+$/

function logChatAttachmentPerf(event: string, extra?: Record<string, unknown>) {
  console.log(CHAT_PERF_DEBUG_PREFIX, {
    now: Date.now(),
    scope: 'chat-attachment-api',
    event,
    ...extra,
  })
}

function sanitizeStoragePathSegment(value: string) {
  const trimmedValue = value.trim()

  if (!trimmedValue || !SAFE_STORAGE_PATH_SEGMENT_REGEX.test(trimmedValue)) {
    throw new Error('invalid_media_path_segment')
  }

  return trimmedValue
}

function sanitizeStorageFileName(value: string) {
  const trimmedValue = value.trim()

  if (!trimmedValue || !SAFE_STORAGE_FILE_NAME_REGEX.test(trimmedValue)) {
    throw new Error('invalid_media_file_name')
  }

  return trimmedValue
}

function getSupabaseOrigin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()

  if (!supabaseUrl) {
    throw new Error('chat_media_validation_unavailable')
  }

  return new URL(supabaseUrl).origin
}

function getChatMediaPublicUrl(storagePath: string) {
  const encodedPath = storagePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `${getSupabaseOrigin()}/storage/v1/object/public/${CHAT_MEDIA_BUCKET}/${encodedPath}`
}

function sanitizeAttachmentDimension(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null
  }

  if (!Number.isFinite(value)) {
    throw new Error('invalid_chat_attachment_dimensions')
  }

  const roundedValue = Math.round(value)

  if (roundedValue <= 0 || roundedValue > 20000) {
    throw new Error('invalid_chat_attachment_dimensions')
  }

  return roundedValue
}

function validateChatImageStoragePath(storagePath: string, userId: string, threadId?: string | null) {
  const trimmedPath = storagePath.trim()

  if (!trimmedPath || trimmedPath.includes('://') || trimmedPath.startsWith('/')) {
    throw new Error('invalid_chat_image_path')
  }

  const pathSegments = trimmedPath.split('/').filter(Boolean)

  if (pathSegments.length !== 3) {
    throw new Error('invalid_chat_image_path')
  }

  const [pathUserId, pathThreadId, fileName] = pathSegments
  const expectedThreadSegment = threadId ? sanitizeStoragePathSegment(threadId) : 'club'

  if (
    sanitizeStoragePathSegment(pathUserId ?? '') !== sanitizeStoragePathSegment(userId) ||
    sanitizeStoragePathSegment(pathThreadId ?? '') !== expectedThreadSegment
  ) {
    throw new Error('chat_image_not_owned_by_user')
  }

  sanitizeStorageFileName(fileName ?? '')

  return trimmedPath
}

export async function POST(
  request: Request,
  context: { params: Promise<{ messageId: string }> }
) {
  const requestStartedAt = performance.now()
  let previousStageAt = requestStartedAt
  const userId = decodeRequestUserId(request)
  const body = await request.json().catch(() => null) as ChatMessageAttachmentRequestBody | null
  const params = await context.params
  const messageId = params.messageId?.trim() ?? ''
  const threadId = body?.threadId?.trim() || null
  const sortOrder = typeof body?.sortOrder === 'number' ? Math.round(body.sortOrder) : -1

  function logStage(event: string, extra?: Record<string, unknown>) {
    const now = performance.now()
    logChatAttachmentPerf(event, {
      elapsedMs: Math.round(now - requestStartedAt),
      stageDurationMs: Math.round(now - previousStageAt),
      userId,
      messageId: messageId || null,
      threadId,
      sortOrder,
      ...extra,
    })
    previousStageAt = now
  }

  if (!userId) {
    logStage('response-error', {
      status: 401,
      error: 'auth_required',
    })
    return NextResponse.json(
      {
        ok: false,
        error: 'auth_required',
      },
      { status: 401 }
    )
  }

  if (!messageId) {
    logStage('response-error', {
      status: 400,
      error: 'invalid_message_id',
    })
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_message_id',
      },
      { status: 400 }
    )
  }

  try {
    if (body?.type !== 'image') {
      throw new Error('invalid_chat_attachment_type')
    }

    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder >= CHAT_MESSAGE_MAX_ATTACHMENTS) {
      throw new Error('invalid_chat_attachment_sort_order')
    }

    const validatedStoragePath = validateChatImageStoragePath(body?.storagePath?.trim() ?? '', userId, threadId)
    const validatedWidth = sanitizeAttachmentDimension(body?.width)
    const validatedHeight = sanitizeAttachmentDimension(body?.height)
    const publicUrl = getChatMediaPublicUrl(validatedStoragePath)
    logStage('validation-end')

    const supabaseAdmin = createSupabaseAdminClient()
    const { data: message, error: messageError } = await supabaseAdmin
      .from('chat_messages')
      .select('id, thread_id, user_id, is_deleted')
      .eq('id', messageId)
      .eq('user_id', userId)
      .maybeSingle()

    if (messageError) {
      throw messageError
    }

    const ownedMessage = (message as {
      id: string
      thread_id: string | null
      user_id: string
      is_deleted?: boolean
    } | null) ?? null

    if (!ownedMessage || ownedMessage.is_deleted) {
      throw new Error('chat_message_not_found')
    }

    if ((ownedMessage.thread_id ?? null) !== threadId) {
      throw new Error('thread_access_denied')
    }
    logStage('message-ownership-end')

    const { error: attachmentError } = await supabaseAdmin
      .from('chat_message_attachments')
      .upsert(
        {
          message_id: messageId,
          attachment_type: 'image',
          storage_path: validatedStoragePath,
          public_url: publicUrl,
          width: validatedWidth,
          height: validatedHeight,
          sort_order: sortOrder,
        },
        {
          onConflict: 'message_id,sort_order',
        }
      )

    if (attachmentError) {
      throw attachmentError
    }
    logStage('attachment-upsert-end')

    const { error: touchError } = await supabaseAdmin
      .from('chat_messages')
      .update({
        updated_at: new Date().toISOString(),
      })
      .eq('id', messageId)
      .eq('user_id', userId)

    if (touchError) {
      throw touchError
    }
    logStage('message-touch-end')

    logStage('response-sent')
    return NextResponse.json({
      ok: true,
      storagePath: validatedStoragePath,
      publicUrl,
      sortOrder,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'chat_message_attachment_failed'
    logStage('response-error', {
      status: 400,
      error: message,
    })
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 400 }
    )
  }
}
