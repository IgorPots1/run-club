import 'server-only'

import { getChatPushEnvelopeFromAppEvent } from '@/lib/events/chatAppEvents'
import { type AppEvent, type AppEventPayload } from '@/lib/events/createAppEvent'
import { getUserPushPreferencesForUser } from '@/lib/notifications/userPushPreferences'
import { normalizeThreadPushLevel } from '@/lib/notifications/push'
import { sendWebPush } from '@/lib/push/sendWebPush'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type PushCapableAppEventRow = {
  id: string
  type: string
  actor_user_id: string | null
  target_user_id: string | null
  entity_type: string | null
  entity_id: string | null
  category: string | null
  channel: string | null
  priority: string | null
  target_path: string | null
  dedupe_key: string | null
  payload: AppEventPayload
  created_at: string
}

type PushSubscriptionRow = {
  endpoint: string
  p256dh: string
  auth: string
}

type UserNotificationSettingRow = {
  muted?: boolean | null
  push_level?: string | null
}

type AppEventPushDeliveryStatus = 'processing' | 'sent' | 'failed' | 'skipped' | 'expired'

type ProcessAppEventPushDeliveriesOptions = {
  appEventIds?: string[]
  limit?: number
}

const EVENT_MARKER_PREFIX = '__event__'
const DEFAULT_PROCESS_LIMIT = 50
const DELIVERY_CLAIM_STALE_AFTER_MS = 15 * 60 * 1000
type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>

function toAppEvent(row: PushCapableAppEventRow): AppEvent {
  return {
    id: row.id,
    type: row.type,
    actorUserId: row.actor_user_id,
    targetUserId: row.target_user_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    category: row.category?.trim() || null,
    channel: row.channel === 'push' || row.channel === 'both' || row.channel === 'inbox' ? row.channel : null,
    priority: row.priority === 'important' || row.priority === 'normal' ? row.priority : null,
    targetPath: row.target_path?.trim() || null,
    dedupeKey: row.dedupe_key?.trim() || null,
    payload: row.payload ?? {},
    createdAt: row.created_at,
  }
}

function getEventMarkerEndpoint(eventId: string, userId: string) {
  return `${EVENT_MARKER_PREFIX}:${eventId}:${userId}`
}

async function loadPushEligibleAppEvents(
  supabaseAdmin: SupabaseAdminClient,
  options: ProcessAppEventPushDeliveriesOptions
): Promise<AppEvent[]> {
  const normalizedIds = Array.from(
    new Set((options.appEventIds ?? []).map((value) => value.trim()).filter(Boolean))
  )
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_PROCESS_LIMIT, 200))
  const query = supabaseAdmin
    .from('app_events')
    .select(
      'id, type, actor_user_id, target_user_id, entity_type, entity_id, category, channel, priority, target_path, dedupe_key, payload, created_at'
    )
    .eq('category', 'chat')
    .eq('type', 'chat_message.created')
    .in('channel', ['push', 'both'])
    .order('created_at', { ascending: true })

  if (normalizedIds.length > 0) {
    query.in('id', normalizedIds)
  } else {
    query.limit(limit)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return ((data as PushCapableAppEventRow[] | null) ?? []).map(toAppEvent)
}

async function loadThreadPushLevel(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  threadId: string
) {
  const { data, error } = await supabaseAdmin
    .from('user_notification_settings')
    .select('muted, push_level')
    .eq('user_id', userId)
    .eq('thread_id', threadId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return normalizeThreadPushLevel((data as UserNotificationSettingRow | null) ?? null)
}

async function loadUserSubscriptions(
  supabaseAdmin: SupabaseAdminClient,
  userId: string
): Promise<PushSubscriptionRow[]> {
  const { data, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (error) {
    throw error
  }

  return Array.from(
    new Map(
      ((data as PushSubscriptionRow[] | null) ?? []).map((subscription) => [subscription.endpoint, subscription])
    ).values()
  )
}

async function claimDeliveryAttempt(input: {
  supabaseAdmin: SupabaseAdminClient
  appEventId: string
  userId: string
  subscriptionEndpoint: string
}) {
  const staleThreshold = new Date(Date.now() - DELIVERY_CLAIM_STALE_AFTER_MS).toISOString()
  const { error: staleClaimCleanupError } = await input.supabaseAdmin
    .from('app_event_push_deliveries')
    .delete()
    .eq('app_event_id', input.appEventId)
    .eq('subscription_endpoint', input.subscriptionEndpoint)
    .eq('status', 'processing')
    .lt('attempted_at', staleThreshold)

  if (staleClaimCleanupError) {
    throw staleClaimCleanupError
  }

  const attemptedAt = new Date().toISOString()
  const { data, error } = await input.supabaseAdmin
    .from('app_event_push_deliveries')
    .insert({
      app_event_id: input.appEventId,
      user_id: input.userId,
      subscription_endpoint: input.subscriptionEndpoint,
      status: 'processing',
      attempted_at: attemptedAt,
    })
    .select('id')
    .maybeSingle()

  if (!error && data) {
    return {
      deliveryId: (data as { id: string }).id,
      claimed: true,
    }
  }

  if (error && error.code === '23505') {
    return {
      deliveryId: null,
      claimed: false,
    }
  }

  if (error) {
    throw error
  }

  return {
    deliveryId: null,
    claimed: false,
  }
}

async function finalizeDeliveryAttempt(input: {
  supabaseAdmin: SupabaseAdminClient
  deliveryId: string
  status: Exclude<AppEventPushDeliveryStatus, 'processing'>
  statusCode?: number | null
  errorBody?: string | null
}) {
  const { error } = await input.supabaseAdmin
    .from('app_event_push_deliveries')
    .update({
      status: input.status,
      status_code: input.statusCode ?? null,
      error_body: input.errorBody ?? null,
      attempted_at: new Date().toISOString(),
    })
    .eq('id', input.deliveryId)
    .eq('status', 'processing')

  if (error) {
    throw error
  }
}

async function recordEventLevelOutcome(input: {
  supabaseAdmin: SupabaseAdminClient
  appEventId: string
  userId: string
  status: 'skipped' | 'failed'
  errorBody?: string | null
}) {
  const claim = await claimDeliveryAttempt({
    supabaseAdmin: input.supabaseAdmin,
    appEventId: input.appEventId,
    userId: input.userId,
    subscriptionEndpoint: getEventMarkerEndpoint(input.appEventId, input.userId),
  })

  if (!claim.claimed || !claim.deliveryId) {
    return false
  }

  await finalizeDeliveryAttempt({
    supabaseAdmin: input.supabaseAdmin,
    deliveryId: claim.deliveryId,
    status: input.status,
    errorBody: input.errorBody ?? null,
  })

  return true
}

async function deleteDeadSubscription(supabaseAdmin: SupabaseAdminClient, endpoint: string) {
  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)

  if (error) {
    throw error
  }
}

async function processChatAppEventPush(supabaseAdmin: SupabaseAdminClient, event: AppEvent) {
  const targetUserId = event.targetUserId

  if (!targetUserId) {
    console.error('Cannot process chat app event push without target user', {
      appEventId: event.id,
      type: event.type,
    })
    return
  }

  const pushEnvelope = getChatPushEnvelopeFromAppEvent({
    payload: event.payload,
    targetPath: event.targetPath,
    priority: event.priority,
  })

  if (!pushEnvelope) {
    await recordEventLevelOutcome({
      supabaseAdmin,
      appEventId: event.id,
      userId: targetUserId,
      status: 'failed',
      errorBody: 'invalid_chat_push_event_payload',
    })
    return
  }

  const userPreferences = await getUserPushPreferencesForUser(supabaseAdmin, targetUserId)

  if (!userPreferences.push_enabled) {
    await recordEventLevelOutcome({
      supabaseAdmin,
      appEventId: event.id,
      userId: targetUserId,
      status: 'skipped',
      errorBody: 'push_disabled',
    })
    return
  }

  if (pushEnvelope.priority === 'important') {
    if (!userPreferences.chat_important_enabled) {
      await recordEventLevelOutcome({
        supabaseAdmin,
        appEventId: event.id,
        userId: targetUserId,
        status: 'skipped',
        errorBody: 'chat_important_disabled',
      })
      return
    }
  } else if (!userPreferences.chat_enabled) {
    await recordEventLevelOutcome({
      supabaseAdmin,
      appEventId: event.id,
      userId: targetUserId,
      status: 'skipped',
      errorBody: 'chat_disabled',
    })
    return
  }

  const threadPushLevel = await loadThreadPushLevel(supabaseAdmin, targetUserId, pushEnvelope.threadId)

  if (threadPushLevel === 'mute') {
    await recordEventLevelOutcome({
      supabaseAdmin,
      appEventId: event.id,
      userId: targetUserId,
      status: 'skipped',
      errorBody: 'thread_muted',
    })
    return
  }

  if (threadPushLevel === 'important_only' && pushEnvelope.priority !== 'important') {
    await recordEventLevelOutcome({
      supabaseAdmin,
      appEventId: event.id,
      userId: targetUserId,
      status: 'skipped',
      errorBody: 'thread_important_only',
    })
    return
  }

  const subscriptions = await loadUserSubscriptions(supabaseAdmin, targetUserId)

  if (subscriptions.length === 0) {
    await recordEventLevelOutcome({
      supabaseAdmin,
      appEventId: event.id,
      userId: targetUserId,
      status: 'skipped',
      errorBody: 'no_push_subscriptions',
    })
    return
  }

  for (const subscription of subscriptions) {
    const claim = await claimDeliveryAttempt({
      supabaseAdmin,
      appEventId: event.id,
      userId: targetUserId,
      subscriptionEndpoint: subscription.endpoint,
    })

    if (!claim.claimed || !claim.deliveryId) {
      continue
    }

    const result = await sendWebPush({
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      payload: {
        title: pushEnvelope.title,
        body: pushEnvelope.body,
        targetUrl: pushEnvelope.targetPath,
        threadId: pushEnvelope.threadId,
        threadType: pushEnvelope.threadType,
      },
    })

    if (result.ok) {
      await finalizeDeliveryAttempt({
        supabaseAdmin,
        deliveryId: claim.deliveryId,
        status: 'sent',
      })
      continue
    }

    const isExpiredEndpoint = result.statusCode === 404 || result.statusCode === 410

    if (isExpiredEndpoint) {
      try {
        await deleteDeadSubscription(supabaseAdmin, subscription.endpoint)
      } catch (error) {
        console.error('Failed to delete expired push subscription', {
          appEventId: event.id,
          userId: targetUserId,
          endpoint: subscription.endpoint,
          error: error instanceof Error ? error.message : 'unknown_error',
        })
      }
    }

    await finalizeDeliveryAttempt({
      supabaseAdmin,
      deliveryId: claim.deliveryId,
      status: isExpiredEndpoint ? 'expired' : 'failed',
      statusCode: result.statusCode ?? null,
      errorBody: result.errorBody ?? null,
    })
  }
}

export async function processAppEventPushDeliveries(
  options: ProcessAppEventPushDeliveriesOptions = {}
): Promise<void> {
  const supabaseAdmin = createSupabaseAdminClient()
  const events = await loadPushEligibleAppEvents(supabaseAdmin, options)

  for (const event of events) {
    try {
      await processChatAppEventPush(supabaseAdmin, event)
    } catch (error) {
      console.error('Failed to process app event push delivery', {
        appEventId: event.id,
        type: event.type,
        targetUserId: event.targetUserId,
        error: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }
}
