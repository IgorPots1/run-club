import { NextResponse } from 'next/server'
import { logChatSendDebug, logChatSendDebugError } from '@/lib/chatSendDebug'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type ChatMessageAttachmentRequestBody = {
  type?: 'image'
  threadId?: string | null
  storagePath?: string
  width?: number | null
  height?: number | null
  sortOrder?: number | null
}

type ChatMessageManagePermissionRow = boolean

const CHAT_MEDIA_BUCKET = 'chat-media'
const CHAT_MESSAGE_MAX_ATTACHMENTS = 8
const SAFE_STORAGE_PATH_SEGMENT_REGEX = /^[A-Za-z0-9_-]+$/
const SAFE_STORAGE_FILE_NAME_REGEX = /^[A-Za-z0-9._-]+$/
const CHAT_ATTACHMENT_API_ERROR_MESSAGE_BY_CODE: Record<string, string> = {
  auth_required: 'Authentication is required.',
  invalid_message_id: 'Message id is invalid.',
  thread_access_denied: 'You do not have access to this chat thread.',
  chat_message_not_found: 'Chat message not found.',
  message_manage_not_allowed: 'You cannot manage attachments for this message.',
}

function getChatAttachmentApiErrorStatus(errorCode: string) {
  switch (errorCode) {
    case 'auth_required':
      return 401
    case 'chat_message_not_found':
      return 404
    case 'thread_access_denied':
    case 'message_manage_not_allowed':
      return 403
    default:
      return 400
  }
}

function createChatAttachmentApiErrorResponse(errorCode: string) {
  return NextResponse.json(
    {
      ok: false,
      error: errorCode,
      message: CHAT_ATTACHMENT_API_ERROR_MESSAGE_BY_CODE[errorCode] ?? 'Chat attachment request failed.',
    },
    {
      status: getChatAttachmentApiErrorStatus(errorCode),
    }
  )
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
  const routeStartedAt = Date.now()
  const [auth, body, params] = await Promise.all([
    getAuthenticatedUser(),
    request.json().catch(() => null) as Promise<ChatMessageAttachmentRequestBody | null>,
    context.params,
  ])
  const userId = auth.user?.id ?? null
  const messageId = params.messageId?.trim() ?? ''
  const threadId = body?.threadId?.trim() || null
  const sortOrder = typeof body?.sortOrder === 'number' ? Math.round(body.sortOrder) : -1
  const routeMeta = {
    userId: userId ?? null,
    messageId,
    threadId,
    sortOrder,
    attachmentType: body?.type ?? null,
  }

  logChatSendDebug('attachment_route_enter', routeMeta)

  if (!userId) {
    logChatSendDebug('attachment_auth_resolved', {
      ...routeMeta,
      authenticated: false,
    })
    return createChatAttachmentApiErrorResponse('auth_required')
  }

  if (!messageId) {
    logChatSendDebugError('attachment_catch_error', {
      ...routeMeta,
      error: 'invalid_message_id',
    })
    return createChatAttachmentApiErrorResponse('invalid_message_id')
  }

  try {
    logChatSendDebug('attachment_auth_resolved', {
      ...routeMeta,
      authenticated: true,
    })
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
    logChatSendDebug('attachment_payload_validated', {
      ...routeMeta,
      storagePath: validatedStoragePath,
      width: validatedWidth,
      height: validatedHeight,
    })

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

    const { data: canManageMessage, error: canManageMessageError } = await supabaseAdmin
      .rpc('can_manage_chat_message', {
        p_message_id: messageId,
        p_user_id: userId,
      })

    if (canManageMessageError) {
      throw canManageMessageError
    }

    if (!(canManageMessage as ChatMessageManagePermissionRow | null)) {
      throw new Error('message_manage_not_allowed')
    }

    logChatSendDebug('attachment_message_lookup_success', {
      ...routeMeta,
      elapsedMs: Date.now() - routeStartedAt,
    })

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

    logChatSendDebug('attachment_upsert_success', {
      ...routeMeta,
      storagePath: validatedStoragePath,
      publicUrl,
    })

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

    logChatSendDebug('attachment_response_ready', {
      ...routeMeta,
      storagePath: validatedStoragePath,
      publicUrl,
      elapsedMs: Date.now() - routeStartedAt,
    })

    return NextResponse.json({
      ok: true,
      storagePath: validatedStoragePath,
      publicUrl,
      sortOrder,
    })
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : 'chat_message_attachment_failed'
    logChatSendDebugError('attachment_catch_error', {
      ...routeMeta,
      error: errorCode,
      elapsedMs: Date.now() - routeStartedAt,
    })
    return createChatAttachmentApiErrorResponse(errorCode)
  }
}
