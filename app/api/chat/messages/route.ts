import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAppEvent } from '@/lib/events/createAppEvent'
import { isThreadMuted } from '@/lib/notifications/isThreadMuted'
import { sendWebPush } from '@/lib/push/sendWebPush'
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

type PushSubscriptionRow = {
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

type ChatDeliveryContext = {
  threadType: 'club' | 'direct_coach'
  recipientUserIds: string[]
  senderName: string
  messagePreview: string
  threadId: string
}

type ChatNotificationContent = {
  title: string
  body: string
}

type PushDeliveryLogRow = {
  user_id: string
}

const PUSH_DELIVERY_THROTTLE_WINDOW_MS = 15_000

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

function getChatNotificationContent(context: Pick<ChatDeliveryContext, 'threadType' | 'senderName' | 'messagePreview'>): ChatNotificationContent {
  const senderName = context.senderName || 'Run Club'
  const messagePreview = context.messagePreview.trim()

  if (context.threadType === 'club') {
    return {
      title: 'Клуб',
      body: messagePreview ? `${senderName}: ${messagePreview}` : 'Новое сообщение в клубе',
    }
  }

  return {
    title: senderName,
    body: messagePreview || 'Новое сообщение',
  }
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
    .select('id, type, owner_user_id, coach_user_id')
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
    recipientUserIds: uniqueRecipientUserIds,
    senderName: getProfileDisplayName((senderProfile as SenderProfileRow | null) ?? null, 'Run Club'),
    messagePreview: getMessagePreview(message),
    threadId: message.thread_id,
  }
}

async function emitChatMessageCreatedEvent(
  message: InsertedChatMessageRow,
  context: ChatDeliveryContext
) {
  try {
    await Promise.all(
      context.recipientUserIds.map((recipientUserId) =>
        createAppEvent({
          type: 'chat_message.created',
          actorUserId: message.user_id,
          targetUserId: recipientUserId,
          entityType: 'chat_message',
          entityId: message.id,
          payload: {
            threadId: context.threadId,
            messagePreview: context.messagePreview,
            senderName: context.senderName,
          },
        })
      )
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

async function sendChatMessagePushNotifications(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  context: ChatDeliveryContext
) {
  try {
    const muteChecks = await Promise.all(
      context.recipientUserIds.map(async (recipientUserId) => ({
        recipientUserId,
        muted: await isThreadMuted(recipientUserId, context.threadId),
      }))
    )
    const unmutedRecipientUserIds = muteChecks
      .filter((entry) => {
        if (entry.muted) {
          console.log('[push] skipped_muted_thread', {
            recipientId: entry.recipientUserId,
            threadId: context.threadId,
          })
        }

        return !entry.muted
      })
      .map((entry) => entry.recipientUserId)

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
    const notificationContent = getChatNotificationContent(context)

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
    const supabaseAdmin = createSupabaseAdminClient()
    const chatDeliveryContext = await loadChatDeliveryContext(supabaseAdmin, message)

    if (chatDeliveryContext) {
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
      await emitChatMessageCreatedEvent(message, chatDeliveryContext)
      await sendChatMessagePushNotifications(supabaseAdmin, chatDeliveryContext)
    }

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
