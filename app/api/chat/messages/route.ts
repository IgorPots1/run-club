import { after, NextResponse } from 'next/server'
import { createAppEvents } from '@/lib/events/createAppEvent'
import { buildChatMessageCreatedAppEvent, buildChatPushPreview } from '@/lib/events/chatAppEvents'
import type { CommonChannelKey } from '@/lib/chat/commonChannels'
import {
  isThreadPushMuted,
  normalizeChatMessagePushPriority,
  type PushPriority,
  type ThreadPushLevelRow,
} from '@/lib/notifications/push'
import { logChatSendDebug, logChatSendDebugError } from '@/lib/chatSendDebug'
import { sendWebPush } from '@/lib/push/sendWebPush'
import { getProfileDisplayName } from '@/lib/profiles'
import { decodeRequestUserId } from '@/lib/server/chatRequestAuth'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type TextChatMessageRequestBody = {
  kind?: 'text'
  text?: string
  replyToId?: string | null
  threadId?: string | null
  imageUrl?: string | null
  pendingAttachmentCount?: number | null
  attachments?: {
    type?: 'image'
    storagePath?: string
    width?: number | null
    height?: number | null
  }[]
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
  push_priority: PushPriority
}

type ChatThreadRow = {
  id: string
  type: 'club' | 'direct_coach'
  channel_key: CommonChannelKey | null
  owner_user_id: string | null
  coach_user_id: string | null
}

type SenderProfileRow = {
  name: string | null
  nickname: string | null
  email: string | null
}

type PushSubscriptionRow = {
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

type ChatDeliveryContext = {
  threadType: 'club' | 'direct_coach'
  threadChannelKey: CommonChannelKey | null
  recipientUserIds: string[]
  senderName: string
  senderIsCoach: boolean
  messagePreview: string
  threadId: string
}

type ValidatedImageAttachment = {
  type: 'image'
  storagePath: string
  publicUrl: string
  width: number | null
  height: number | null
  sortOrder: number
}

type ChatMessageInsertPayload = {
  user_id: string
  text: string
  message_type: 'text' | 'image' | 'voice'
  image_url: string | null
  media_url?: string | null
  media_duration_seconds?: number | null
  reply_to_id: string | null
  thread_id: string | null
}

type ChatMessageValidationRow = {
  thread_exists: boolean
  can_access: boolean
  safe_reply_to_id: string | null
  can_post: boolean
  thread_channel_key: CommonChannelKey | null
}

type ChatNotificationContent = {
  title: string
  body: string
}

type PushDeliveryLogRow = {
  user_id: string
}

type UserNotificationSettingRow = {
  user_id: string
} & ThreadPushLevelRow

const PUSH_DELIVERY_THROTTLE_WINDOW_MS = 15_000
const CHAT_MEDIA_BUCKET = 'chat-media'
const CHAT_MESSAGE_MAX_ATTACHMENTS = 8
const SAFE_STORAGE_PATH_SEGMENT_REGEX = /^[A-Za-z0-9_-]+$/
const SAFE_STORAGE_FILE_NAME_REGEX = /^[A-Za-z0-9._-]+$/
const CHAT_API_ERROR_MESSAGE_BY_CODE: Record<string, string> = {
  auth_required: 'Authentication is required.',
  thread_not_found: 'Chat thread not found.',
  thread_access_denied: 'You do not have access to this chat thread.',
  posting_not_allowed: 'Posting is not allowed in this chat thread.',
  empty_message: 'Message cannot be empty.',
  empty_voice_message: 'Voice message cannot be empty.',
  message_too_long: 'Message is too long.',
}

function getChatApiErrorStatus(errorCode: string) {
  switch (errorCode) {
    case 'auth_required':
      return 401
    case 'thread_not_found':
      return 404
    case 'thread_access_denied':
    case 'posting_not_allowed':
      return 403
    default:
      return 400
  }
}

function createChatApiErrorResponse(errorCode: string) {
  return NextResponse.json(
    {
      ok: false,
      error: errorCode,
      message: CHAT_API_ERROR_MESSAGE_BY_CODE[errorCode] ?? 'Chat message request failed.',
    },
    {
      status: getChatApiErrorStatus(errorCode),
    }
  )
}

function getChatThreadTargetUrl(threadId: string) {
  return `/messages/${threadId}`
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

function validateChatImageUrl(imageUrl: string, userId: string, threadId?: string | null) {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(imageUrl)
  } catch {
    throw new Error('invalid_chat_image_url')
  }

  if (parsedUrl.origin !== getSupabaseOrigin()) {
    throw new Error('invalid_chat_image_url')
  }

  if (parsedUrl.search || parsedUrl.hash) {
    throw new Error('invalid_chat_image_url')
  }

  const publicBucketPathPrefix = `/storage/v1/object/public/${CHAT_MEDIA_BUCKET}/`

  if (!parsedUrl.pathname.startsWith(publicBucketPathPrefix)) {
    throw new Error('invalid_chat_image_url')
  }

  let objectPath = ''

  try {
    objectPath = decodeURIComponent(parsedUrl.pathname.slice(publicBucketPathPrefix.length))
  } catch {
    throw new Error('invalid_chat_image_url')
  }

  const pathSegments = objectPath.split('/').filter(Boolean)

  if (pathSegments.length !== 3) {
    throw new Error('invalid_chat_image_url')
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

  return imageUrl
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

function validateImageAttachments(
  attachments: TextChatMessageRequestBody['attachments'],
  userId: string,
  threadId?: string | null
) {
  const normalizedAttachments = Array.isArray(attachments) ? attachments : []

  if (normalizedAttachments.length > CHAT_MESSAGE_MAX_ATTACHMENTS) {
    throw new Error('too_many_attachments')
  }

  return normalizedAttachments.map((attachment, index) => {
    if (attachment?.type !== 'image') {
      throw new Error('invalid_chat_attachment_type')
    }

    const storagePath = validateChatImageStoragePath(attachment.storagePath?.trim() ?? '', userId, threadId)

    return {
      type: 'image',
      storagePath,
      publicUrl: getChatMediaPublicUrl(storagePath),
      width: sanitizeAttachmentDimension(attachment.width),
      height: sanitizeAttachmentDimension(attachment.height),
      sortOrder: index,
    } satisfies ValidatedImageAttachment
  })
}

function validateVoiceMediaPath(mediaPath: string, userId: string) {
  const trimmedPath = mediaPath.trim()

  if (!trimmedPath || trimmedPath.includes('://') || trimmedPath.startsWith('/')) {
    throw new Error('invalid_voice_media_path')
  }

  const pathSegments = trimmedPath.split('/').filter(Boolean)
  const safeUserId = sanitizeStoragePathSegment(userId)
  const isLegacyVoicePath = pathSegments[0] === 'voice'
  const expectedLength = isLegacyVoicePath ? 3 : 2

  if (pathSegments.length !== expectedLength) {
    throw new Error('invalid_voice_media_path')
  }

  const ownerSegment = sanitizeStoragePathSegment(
    isLegacyVoicePath ? pathSegments[1] ?? '' : pathSegments[0] ?? ''
  )
  const fileName = sanitizeStorageFileName(
    isLegacyVoicePath ? pathSegments[2] ?? '' : pathSegments[1] ?? ''
  )

  if (ownerSegment !== safeUserId) {
    throw new Error('voice_media_not_owned_by_user')
  }

  if (!fileName.toLowerCase().endsWith('.webm')) {
    throw new Error('invalid_voice_media_path')
  }

  return trimmedPath
}

async function validateChatMessageRequest(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  threadId?: string | null,
  replyToId?: string | null
) {
  if (!threadId) {
    return {
      safeReplyToId: null,
      canPost: true,
      threadChannelKey: null,
    }
  }

  const { data, error } = await supabaseAdmin
    .rpc('validate_chat_message_request', {
      p_user_id: userId,
      p_thread_id: threadId,
      p_reply_to_id: replyToId ?? null,
    })
    .maybeSingle()

  if (error) {
    throw error
  }

  const validation = (data as ChatMessageValidationRow | null) ?? null

  if (!validation?.thread_exists) {
    throw new Error('thread_not_found')
  }

  if (!validation.can_access) {
    throw new Error('thread_access_denied')
  }

  if (!validation.can_post) {
    throw new Error('posting_not_allowed')
  }

  return {
    safeReplyToId: validation.safe_reply_to_id ?? null,
    canPost: validation.can_post,
    threadChannelKey: validation.thread_channel_key ?? null,
  }
}

function toInsertedMessageRow(
  insertedRow: { id: string; thread_id?: string | null; push_priority?: string | null },
  payload: ChatMessageInsertPayload
): InsertedChatMessageRow {
  return {
    id: insertedRow.id,
    user_id: payload.user_id,
    text: payload.text,
    message_type: payload.message_type,
    image_url: payload.image_url,
    media_url: payload.media_url ?? null,
    thread_id: insertedRow.thread_id ?? payload.thread_id,
    push_priority: normalizeChatMessagePushPriority(insertedRow),
  }
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

function getChatNotificationContent(
  context: Pick<
    ChatDeliveryContext,
    'threadType' | 'threadChannelKey' | 'senderName' | 'senderIsCoach' | 'messagePreview'
  >,
  priority: PushPriority
): ChatNotificationContent {
  return buildChatPushPreview({
    threadType: context.threadType,
    threadChannelKey: context.threadChannelKey,
    senderName: context.senderName,
    senderIsCoach: context.senderIsCoach,
    messagePreview: context.messagePreview,
    priority,
  })
}

async function loadChatDeliveryContext(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  message: InsertedChatMessageRow
): Promise<ChatDeliveryContext | null> {
  if (!message.thread_id) {
    return null
  }

  const { data: thread, error: threadError } = await supabaseAdmin
    .from('chat_threads')
    .select('id, type, channel_key, owner_user_id, coach_user_id')
    .eq('id', message.thread_id)
    .maybeSingle()

  if (threadError) {
    throw threadError
  }

  const chatThread = (thread as ChatThreadRow | null) ?? null

  if (!chatThread) {
    return null
  }

  const { data: senderProfile, error: senderProfileError } = await supabaseAdmin
    .from('profiles')
    .select('name, nickname, email')
    .eq('id', message.user_id)
    .maybeSingle()

  if (senderProfileError) {
    throw senderProfileError
  }

  const recipientUserIds =
    chatThread.type === 'direct_coach'
      ? [chatThread.owner_user_id, chatThread.coach_user_id].filter(
          (userId): userId is string => Boolean(userId) && userId !== message.user_id
        )
      : (
          (
            await supabaseAdmin
              .from('push_subscriptions')
              .select('user_id')
              .neq('user_id', message.user_id)
          ).data as { user_id: string }[] | null
        )?.map((row) => row.user_id) ?? []

  const uniqueRecipientUserIds = Array.from(new Set(recipientUserIds))

  if (uniqueRecipientUserIds.length === 0) {
    return null
  }

  return {
    threadType: chatThread.type,
    threadChannelKey: chatThread.channel_key,
    recipientUserIds: uniqueRecipientUserIds,
    senderName: getProfileDisplayName((senderProfile as SenderProfileRow | null) ?? null, 'Run Club'),
    senderIsCoach: chatThread.coach_user_id === message.user_id,
    messagePreview: getMessagePreview(message),
    threadId: message.thread_id,
  }
}

async function emitChatMessageCreatedEvent(
  message: InsertedChatMessageRow,
  context: ChatDeliveryContext
) {
  try {
    await createAppEvents(
      context.recipientUserIds.map((recipientUserId) => ({
        ...buildChatMessageCreatedAppEvent({
          actorUserId: message.user_id,
          recipientUserId,
          messageId: message.id,
          threadId: context.threadId,
          senderName: context.senderName,
          senderIsCoach: context.senderIsCoach,
          messagePreview: context.messagePreview,
          priority: message.push_priority,
          threadType: context.threadType,
          threadChannelKey: context.threadChannelKey,
        }),
      }))
    )
  } catch (error) {
    console.error('Failed to create chat message app event', {
      messageId: message.id,
      threadId: context.threadId,
      actorUserId: message.user_id,
      error: error instanceof Error ? error.message : 'unknown_error',
    })
  }
}

async function loadMutedRecipientUserIds(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  recipientUserIds: string[],
  threadId: string
) {
  if (recipientUserIds.length === 0) {
    return new Set<string>()
  }

  const mutedRecipientsQuery = supabaseAdmin
    .from('user_notification_settings')
    .select('user_id, muted, push_level')
    .eq('thread_id', threadId)
    .or('muted.eq.true,push_level.eq.mute')

  if (recipientUserIds.length === 1) {
    mutedRecipientsQuery.eq('user_id', recipientUserIds[0]!)
  } else {
    mutedRecipientsQuery.in('user_id', recipientUserIds)
  }

  const { data, error } = await mutedRecipientsQuery

  if (error) {
    throw error
  }

  return new Set(
    ((data as UserNotificationSettingRow[] | null) ?? [])
      .filter((row) => isThreadPushMuted(row))
      .map((row) => row.user_id)
  )
}

async function sendChatMessagePushNotifications(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  message: InsertedChatMessageRow,
  context: ChatDeliveryContext
) {
  try {
    const mutedRecipientUserIds = await loadMutedRecipientUserIds(
      supabaseAdmin,
      context.recipientUserIds,
      context.threadId
    )
    const unmutedRecipientUserIds = context.recipientUserIds
      .filter((recipientUserId) => {
        if (mutedRecipientUserIds.has(recipientUserId)) {
          console.log('[push] skipped_muted_thread', {
            recipientId: recipientUserId,
            threadId: context.threadId,
          })
        }

        return !mutedRecipientUserIds.has(recipientUserId)
      })

    if (unmutedRecipientUserIds.length === 0) {
      return
    }

    const recentDeliveryThreshold = new Date(Date.now() - PUSH_DELIVERY_THROTTLE_WINDOW_MS).toISOString()
    const recentDeliveriesQuery = supabaseAdmin
      .from('push_delivery_log')
      .select('user_id')
      .eq('thread_id', context.threadId)
      .gte('sent_at', recentDeliveryThreshold)

    if (unmutedRecipientUserIds.length === 1) {
      recentDeliveriesQuery.eq('user_id', unmutedRecipientUserIds[0]!)
    } else {
      recentDeliveriesQuery.in('user_id', unmutedRecipientUserIds)
    }

    const { data: recentDeliveries, error: recentDeliveriesError } = await recentDeliveriesQuery

    if (recentDeliveriesError) {
      throw recentDeliveriesError
    }

    const recentlyDeliveredUserIds = new Set(
      ((recentDeliveries as PushDeliveryLogRow[] | null) ?? []).map((delivery) => delivery.user_id)
    )
    const allowedRecipientUserIds = unmutedRecipientUserIds.filter((recipientUserId) => {
      if (recentlyDeliveredUserIds.has(recipientUserId)) {
        console.log('[push] skipped_recent_delivery', {
          recipientId: recipientUserId,
          threadId: context.threadId,
        })
        return false
      }

      console.log('[push] push_allowed', {
        recipientId: recipientUserId,
        threadId: context.threadId,
      })
      return true
    })

    if (allowedRecipientUserIds.length === 0) {
      return
    }

    console.log('[push] recipients_resolved', {
      threadType: context.threadType,
      recipientUserCount: allowedRecipientUserIds.length,
    })

    const subscriptionsQuery = supabaseAdmin
      .from('push_subscriptions')
      .select('user_id, endpoint, p256dh, auth')

    if (allowedRecipientUserIds.length === 1) {
      subscriptionsQuery.eq('user_id', allowedRecipientUserIds[0]!)
    } else {
      subscriptionsQuery.in('user_id', allowedRecipientUserIds)
    }

    const { data: subscriptions, error: subscriptionsError } = await subscriptionsQuery

    if (subscriptionsError) {
      throw subscriptionsError
    }

    const subscriptionRows = (subscriptions as PushSubscriptionRow[] | null) ?? []
    console.log('[push] subscriptions_loaded', {
      threadType: context.threadType,
      count: subscriptionRows.length,
    })

    if (subscriptionRows.length === 0) {
      return
    }

    const uniqueSubscriptions = Array.from(
      new Map(subscriptionRows.map((subscription) => [subscription.endpoint, subscription])).values()
    )
    const notificationContent = getChatNotificationContent(context, message.push_priority)

    const results = await Promise.all(
      uniqueSubscriptions.map(async (subscription) => ({
        userId: subscription.user_id,
        endpoint: subscription.endpoint,
        result: await (async () => {
          const endpointShort = subscription.endpoint.slice(0, 50)
          console.log('[push] sending', {
            endpointShort,
          })

          const result = await sendWebPush({
            endpoint: subscription.endpoint,
            p256dh: subscription.p256dh,
            auth: subscription.auth,
            payload: {
              title: notificationContent.title,
              body: notificationContent.body,
              targetUrl: getChatThreadTargetUrl(context.threadId),
              threadId: context.threadId,
              threadType: context.threadType,
            },
          })

          if (result.ok) {
            console.log('[push] success', {
              endpointShort,
            })
          } else {
            console.error('[push] error', {
              statusCode: result.statusCode,
              message: 'send_failed',
            })
          }

          return result
        })(),
      }))
    )

    const successfulRecipientUserIds = Array.from(
      new Set(
        results
          .filter(({ result }) => result.ok)
          .map(({ userId }) => userId)
      )
    )

    if (successfulRecipientUserIds.length > 0) {
      const { error: deliveryLogInsertError } = await supabaseAdmin
        .from('push_delivery_log')
        .insert(
          successfulRecipientUserIds.map((recipientUserId) => ({
            user_id: recipientUserId,
            thread_id: context.threadId,
          }))
        )

      if (deliveryLogInsertError) {
        console.error('Failed to record push delivery log', {
          threadId: context.threadId,
          recipientUserIds: successfulRecipientUserIds,
          error: deliveryLogInsertError.message,
        })
      }
    }

    const deadEndpoints = results
      .filter(({ result }) => result.statusCode === 404 || result.statusCode === 410)
      .map(({ endpoint }) => endpoint)

    if (deadEndpoints.length === 0) {
      console.log('[push] send_summary', {
        threadType: context.threadType,
        recipientUserCount: allowedRecipientUserIds.length,
        subscriptionCount: uniqueSubscriptions.length,
        deadSubscriptionCount: 0,
      })
      return
    }

    deadEndpoints.forEach((endpoint) => {
      console.log('[push] deleting_dead_subscription', {
        endpointShort: endpoint.slice(0, 50),
      })
    })

    const { error: deleteError } = await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .in('endpoint', deadEndpoints)

    if (deleteError) {
      console.error('Failed to delete dead push subscriptions', {
        endpoints: deadEndpoints,
        error: deleteError.message,
      })
    }

    console.log('[push] send_summary', {
      threadType: context.threadType,
      recipientUserCount: allowedRecipientUserIds.length,
      subscriptionCount: uniqueSubscriptions.length,
      deadSubscriptionCount: deadEndpoints.length,
    })
  } catch (error) {
    console.error('Failed to send chat message push notifications', {
      recipientUserIds: context.recipientUserIds,
      threadId: context.threadId,
      error: error instanceof Error ? error.message : 'unknown_error',
    })
  }
}

async function runChatMessageFanout(message: InsertedChatMessageRow) {
  try {
    const supabaseAdmin = createSupabaseAdminClient()
    const chatDeliveryContext = await loadChatDeliveryContext(supabaseAdmin, message)

    if (!chatDeliveryContext) {
      return
    }

    console.log('[push] message_created', {
      messageId: message.id,
      threadId: chatDeliveryContext.threadId,
      senderId: message.user_id,
      recipientId:
        chatDeliveryContext.recipientUserIds.length === 1
          ? chatDeliveryContext.recipientUserIds[0]
          : undefined,
      recipientCount: chatDeliveryContext.recipientUserIds.length,
      threadType: chatDeliveryContext.threadType,
    })

    await Promise.allSettled([
      emitChatMessageCreatedEvent(message, chatDeliveryContext),
      sendChatMessagePushNotifications(supabaseAdmin, message, chatDeliveryContext),
    ])
  } catch (error) {
    console.error('Failed to fan out chat message side effects', {
      messageId: message.id,
      threadId: message.thread_id,
      actorUserId: message.user_id,
      error: error instanceof Error ? error.message : 'unknown_error',
    })
  }
}

export async function POST(request: Request) {
  const routeStartedAt = Date.now()
  const [body, userId] = await Promise.all([
    request.json().catch(() => null) as Promise<CreateChatMessageRequestBody | null>,
    Promise.resolve(decodeRequestUserId(request)),
  ])

  const kind = body?.kind === 'voice' ? 'voice' : 'text'
  const threadId = body?.threadId?.trim() || null
  const replyToId = body?.replyToId?.trim() || null
  const voiceBody = kind === 'voice' ? (body as VoiceChatMessageRequestBody | null) : null
  const textBody = kind === 'text' ? (body as TextChatMessageRequestBody | null) : null
  const pendingAttachmentCount = kind === 'voice'
    ? 0
    : Math.max(0, Math.min(CHAT_MESSAGE_MAX_ATTACHMENTS, Math.round(textBody?.pendingAttachmentCount ?? 0)))
  const routeMeta = {
    kind,
    userId: userId ?? null,
    threadId,
    textLength: kind === 'voice' ? 0 : textBody?.text?.trim().length ?? 0,
    attachmentCount: kind === 'voice'
      ? 0
      : Array.isArray(textBody?.attachments) && textBody.attachments.length > 0
        ? textBody.attachments.length
        : pendingAttachmentCount,
    attachmentKinds:
      kind === 'voice'
        ? ['voice']
        : (
            Array.isArray(textBody?.attachments) && textBody.attachments.length > 0
              ? ['image']
              : pendingAttachmentCount > 0 || Boolean(textBody?.imageUrl?.trim())
                ? ['image']
                : []
          ),
  }
  let lastPhaseAt = routeStartedAt
  const logPhase = (phase: string, payload: Record<string, unknown> = {}) => {
    const now = Date.now()
    logChatSendDebug(phase, {
      ...routeMeta,
      ...payload,
      elapsedMs: now - routeStartedAt,
      phaseDurationMs: now - lastPhaseAt,
    })
    lastPhaseAt = now
  }
  const logPhaseError = (phase: string, payload: Record<string, unknown> = {}) => {
    const now = Date.now()
    logChatSendDebugError(phase, {
      ...routeMeta,
      ...payload,
      elapsedMs: now - routeStartedAt,
      phaseDurationMs: now - lastPhaseAt,
    })
    lastPhaseAt = now
  }

  logPhase('route_enter')

  if (!userId) {
    logPhase('auth_resolved', {
      authenticated: false,
    })
    return createChatApiErrorResponse('auth_required')
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient()
    logPhase('auth_resolved', {
      authenticated: true,
    })
    const { safeReplyToId, canPost, threadChannelKey } = await validateChatMessageRequest(
      supabaseAdmin,
      userId,
      threadId,
      replyToId
    )
    let validatedTextAttachments: ValidatedImageAttachment[] = []

    const insertPayload: ChatMessageInsertPayload =
      kind === 'voice'
        ? (() => {
            const mediaPath = voiceBody?.mediaPath?.trim() ?? ''

            if (!mediaPath) {
              throw new Error('empty_voice_message')
            }

            const validatedMediaPath = validateVoiceMediaPath(mediaPath, userId)

            return {
              user_id: userId,
              text: '',
              message_type: 'voice',
              media_url: validatedMediaPath,
              media_duration_seconds: voiceBody?.mediaDurationSeconds ?? null,
              image_url: null,
              reply_to_id: safeReplyToId,
              thread_id: threadId,
            }
          })()
        : (() => {
            const text = textBody?.text?.trim() ?? ''
            const imageUrl = textBody?.imageUrl?.trim() || null
            validatedTextAttachments = validateImageAttachments(textBody?.attachments, userId, threadId)
            logPhase('validation_check', {
              hasText: Boolean(text),
              attachmentCount: validatedTextAttachments.length > 0
                ? validatedTextAttachments.length
                : imageUrl
                  ? 1
                  : pendingAttachmentCount,
            })

            if (!text && !imageUrl && validatedTextAttachments.length === 0 && pendingAttachmentCount === 0) {
              throw new Error('empty_message')
            }

            if (text.length > 500) {
              throw new Error('message_too_long')
            }

            const validatedImageUrl = validatedTextAttachments.length > 0
              ? null
              : imageUrl
              ? validateChatImageUrl(imageUrl, userId, threadId)
              : null

            return {
              user_id: userId,
              text,
              message_type: validatedTextAttachments.length > 0 || validatedImageUrl || pendingAttachmentCount > 0
                ? 'image'
                : 'text',
              image_url: validatedImageUrl,
              reply_to_id: safeReplyToId,
              thread_id: threadId,
            }
          })()

    logPhase('payload_validated', {
      messageType: insertPayload.message_type,
      attachmentCount: kind === 'voice' ? 0 : Math.max(validatedTextAttachments.length, pendingAttachmentCount),
      attachmentKinds:
        kind === 'voice'
          ? ['voice']
          : validatedTextAttachments.length > 0 || pendingAttachmentCount > 0 || Boolean(insertPayload.image_url)
            ? ['image']
            : [],
    })
    logPhase('thread_access_checked', {
      safeReplyToId,
      canPost,
      threadChannelKey,
    })

    logPhase('message_insert_start', {
      messageType: insertPayload.message_type,
    })
    const { data, error } = await supabaseAdmin
      .from('chat_messages')
      .insert(insertPayload)
      .select('id, push_priority')
      .single()

    if (error) {
      throw error
    }

    const message = toInsertedMessageRow(data as { id: string; thread_id?: string | null }, insertPayload)
    logPhase('message_insert_success', {
      messageId: message.id,
    })

    if (kind === 'text') {
      logPhase('attachment_phase_start', {
        attachmentCount: validatedTextAttachments.length,
        pendingAttachmentCount,
      })
    }

    if (kind === 'text' && validatedTextAttachments.length > 0) {
      const { error: attachmentsInsertError } = await supabaseAdmin
        .from('chat_message_attachments')
        .insert(
          validatedTextAttachments.map((attachment) => ({
            message_id: message.id,
            attachment_type: attachment.type,
            storage_path: attachment.storagePath,
            public_url: attachment.publicUrl,
            width: attachment.width,
            height: attachment.height,
            sort_order: attachment.sortOrder,
          }))
        )

      if (attachmentsInsertError) {
        await supabaseAdmin
          .from('chat_messages')
          .delete()
          .eq('id', message.id)
          .eq('user_id', userId)

        throw attachmentsInsertError
      }
    }

    if (kind === 'text') {
      logPhase('attachment_phase_result', {
        attachmentCount: validatedTextAttachments.length,
        pendingAttachmentCount,
        attachedImmediately: validatedTextAttachments.length,
      })
    }

    after(async () => {
      const afterStartedAt = Date.now()
      logChatSendDebug('after_fanout_start', {
        ...routeMeta,
        messageId: message.id,
        elapsedMs: afterStartedAt - routeStartedAt,
      })

      if (kind === 'text' && validatedTextAttachments.length > 0) {
        const { error: touchMessageError } = await supabaseAdmin
          .from('chat_messages')
          .update({
            updated_at: new Date().toISOString(),
          })
          .eq('id', message.id)
          .eq('user_id', userId)

        if (touchMessageError) {
          console.error('Failed to touch chat message after attachments insert', {
            messageId: message.id,
            error: touchMessageError.message,
          })
        }
      }

      await runChatMessageFanout(message)

      logChatSendDebug('after_fanout_done', {
        ...routeMeta,
        messageId: message.id,
        elapsedMs: Date.now() - routeStartedAt,
        phaseDurationMs: Date.now() - afterStartedAt,
      })
    })

    logPhase('response_ready', {
      messageId: message.id,
      status: 200,
    })
    return NextResponse.json({
      ok: true,
      messageId: message.id,
    })
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : 'chat_message_create_failed'
    logPhaseError('catch_error', {
      error: errorCode,
    })
    return createChatApiErrorResponse(errorCode)
  }
}
