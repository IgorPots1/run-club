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
type ChatThreadReadStateRow = {
  last_read_at: string | null
}

type AppEventPushDeliveryStatus = 'processing' | 'sent' | 'failed' | 'skipped' | 'expired'
type HandledAppEventPushDeliveryStatus = Extract<AppEventPushDeliveryStatus, 'sent' | 'skipped' | 'expired'>
type ChatPushEnvelope = NonNullable<ReturnType<typeof getChatPushEnvelopeFromAppEvent>>
type ChatPushDeliveryPayload = {
  title: string
  body: string
  targetUrl: string
  messageId?: string
  threadId: string
  threadType: 'club' | 'direct_coach'
  priority: 'normal' | 'important'
  hasMentions?: boolean
  isMentioned?: boolean
  threadUnreadCount?: number
  badgeCount?: number
  unreadScope?: 'thread'
  tag?: string
  timestamp?: number
}
type GenericPushDeliveryPayload = {
  title: string
  body: string
  targetUrl: string
  priority?: 'normal' | 'important'
  tag?: string
  timestamp?: number
}
type AppEventPushDeliveryRow = {
  app_event_id: string
  status: AppEventPushDeliveryStatus
  status_code: number | null
  error_body: string | null
  attempted_at: string
}
type ChatPushCoalescingDescriptor = {
  key: string
  targetUserId: string
  threadId: string
  bucketStartMs: number
  bucketEndMs: number
  envelope: ChatPushEnvelope
}
type ChatPushCoalescedGroup = {
  key: string
  targetUserId: string
  threadId: string
  bucketStartMs: number
  bucketEndMs: number
  events: AppEvent[]
  envelopes: Map<string, ChatPushEnvelope>
  leaderEvent: AppEvent
  latestEvent: AppEvent
}

type ProcessAppEventPushDeliveriesOptions = {
  appEventIds?: string[]
  limit?: number
}

const EVENT_MARKER_PREFIX = '__event__'
const DEFAULT_PROCESS_LIMIT = 50
const DELIVERY_CLAIM_STALE_AFTER_MS = 15 * 60 * 1000
const CHAT_PUSH_COALESCE_WINDOW_MS = 15 * 1000
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

function sleep(ms: number) {
  if (ms <= 0) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function compareAppEventsByCreatedAt(left: AppEvent, right: AppEvent) {
  const leftMs = Date.parse(left.createdAt)
  const rightMs = Date.parse(right.createdAt)

  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) {
    return left.id.localeCompare(right.id)
  }

  if (leftMs !== rightMs) {
    return leftMs - rightMs
  }

  return left.id.localeCompare(right.id)
}

function isHandledDeliveryStatus(status: AppEventPushDeliveryStatus): status is HandledAppEventPushDeliveryStatus {
  return status === 'sent' || status === 'skipped' || status === 'expired'
}

function getChatPushCoalescingDescriptor(event: AppEvent): ChatPushCoalescingDescriptor | null {
  if (
    event.type !== 'chat_message.created' ||
    event.category !== 'chat' ||
    event.priority !== 'normal' ||
    !event.targetUserId
  ) {
    return null
  }

  const envelope = getChatPushEnvelopeFromAppEvent({
    payload: event.payload,
    targetPath: event.targetPath,
    priority: event.priority,
  })

  if (!envelope) {
    return null
  }

  const createdAtMs = Date.parse(event.createdAt)

  if (Number.isNaN(createdAtMs)) {
    return null
  }

  const bucketStartMs =
    Math.floor(createdAtMs / CHAT_PUSH_COALESCE_WINDOW_MS) * CHAT_PUSH_COALESCE_WINDOW_MS

  return {
    key: `${event.targetUserId}:${envelope.threadId}:${bucketStartMs}`,
    targetUserId: event.targetUserId,
    threadId: envelope.threadId,
    bucketStartMs,
    bucketEndMs: bucketStartMs + CHAT_PUSH_COALESCE_WINDOW_MS,
    envelope,
  }
}

function buildGroupedChatPushPayload(group: ChatPushCoalescedGroup) {
  const latestEnvelope = group.envelopes.get(group.latestEvent.id)

  if (!latestEnvelope) {
    return null
  }

  const hasMentions = Array.from(group.envelopes.values()).some((envelope) => envelope.hasMentions)
  const isMentioned = Array.from(group.envelopes.values()).some((envelope) => envelope.isMentioned)

  const timestamp = Date.parse(group.latestEvent.createdAt)
  const basePayload: ChatPushDeliveryPayload = {
    title: latestEnvelope.title,
    body: latestEnvelope.body,
    targetUrl: latestEnvelope.targetPath,
    messageId: latestEnvelope.messageId || undefined,
    threadId: latestEnvelope.threadId,
    threadType: latestEnvelope.threadType,
    priority: latestEnvelope.priority,
    hasMentions,
    isMentioned,
    tag: latestEnvelope.priority === 'normal' ? `chat:${latestEnvelope.threadId}` : undefined,
    timestamp: Number.isNaN(timestamp) ? undefined : timestamp,
  }

  if (group.events.length === 1) {
    return basePayload
  }

  return {
    ...basePayload,
    body: `${group.events.length} новых сообщений`,
  }
}

async function loadPushEligibleAppEvents(
  supabaseAdmin: SupabaseAdminClient,
  options: ProcessAppEventPushDeliveriesOptions
): Promise<AppEvent[]> {
  const normalizedIds = Array.from(
    new Set((options.appEventIds ?? []).map((value) => value.trim()).filter(Boolean))
  )
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_PROCESS_LIMIT, 200))

  if (normalizedIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('app_events')
      .select(
        'id, type, actor_user_id, target_user_id, entity_type, entity_id, category, channel, priority, target_path, dedupe_key, payload, created_at'
      )
      .in('id', normalizedIds)
      .order('created_at', { ascending: true })

    if (error) {
      throw error
    }

    return ((data as PushCapableAppEventRow[] | null) ?? []).map(toAppEvent)
  }

  const { data, error } = await supabaseAdmin
    .from('app_events')
    .select(
      'id, type, actor_user_id, target_user_id, entity_type, entity_id, category, channel, priority, target_path, dedupe_key, payload, created_at'
    )
    .eq('category', 'chat')
    .eq('type', 'chat_message.created')
    .in('channel', ['push', 'both'])
    .order('created_at', { ascending: true })
    .limit(limit)

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

async function loadThreadUnreadCount(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  threadId: string
) {
  const { data: existingReadMarker, error: existingReadMarkerError } = await supabaseAdmin
    .from('chat_thread_reads')
    .select('last_read_at')
    .eq('thread_id', threadId)
    .eq('user_id', userId)
    .maybeSingle()

  if (existingReadMarkerError) {
    throw existingReadMarkerError
  }

  const previousLastReadAt =
    ((existingReadMarker as ChatThreadReadStateRow | null) ?? null)?.last_read_at ?? null
  const unreadMessagesQuery = supabaseAdmin
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('thread_id', threadId)
    .eq('is_deleted', false)
    .neq('user_id', userId)

  if (previousLastReadAt) {
    unreadMessagesQuery.gt('created_at', previousLastReadAt)
  }

  const { count, error: unreadMessagesError } = await unreadMessagesQuery

  if (unreadMessagesError) {
    throw unreadMessagesError
  }

  return count ?? 0
}

async function loadChatPushDeliveryPayloadMetadata(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  threadId: string
) {
  try {
    const threadUnreadCount = await loadThreadUnreadCount(supabaseAdmin, userId, threadId)

    return {
      threadUnreadCount,
      badgeCount: threadUnreadCount,
      unreadScope: 'thread' as const,
    }
  } catch (error) {
    console.error('Failed to load chat push unread metadata', {
      userId,
      threadId,
      error: error instanceof Error ? error.message : 'unknown_error',
    })

    return {}
  }
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

function getGenericEventPreview(event: AppEvent) {
  const payload = typeof event.payload === 'object' && event.payload !== null
    ? event.payload as Record<string, unknown>
    : null
  const preview = payload?.preview
  const previewRecord = typeof preview === 'object' && preview !== null
    ? preview as Record<string, unknown>
    : null

  return {
    title:
      typeof previewRecord?.title === 'string' && previewRecord.title.trim()
        ? previewRecord.title.trim()
        : null,
    body:
      typeof previewRecord?.body === 'string' && previewRecord.body.trim()
        ? previewRecord.body.trim()
        : null,
  }
}

function buildRaceEventLikedPushPayload(event: AppEvent): GenericPushDeliveryPayload | null {
  if (!event.targetPath) {
    return null
  }

  const preview = getGenericEventPreview(event)
  const timestamp = Date.parse(event.createdAt)

  return {
    title: preview.title ?? 'Твой старт получил лайк',
    body: preview.body ?? 'Поставили лайк на старт',
    targetUrl: event.targetPath,
    priority: 'normal',
    tag: event.entityId ? `race_event_like:${event.entityId}` : undefined,
    timestamp: Number.isNaN(timestamp) ? undefined : timestamp,
  }
}

async function loadCoalescedChatPushGroup(
  supabaseAdmin: SupabaseAdminClient,
  descriptor: ChatPushCoalescingDescriptor
): Promise<ChatPushCoalescedGroup | null> {
  const { data, error } = await supabaseAdmin
    .from('app_events')
    .select(
      'id, type, actor_user_id, target_user_id, entity_type, entity_id, category, channel, priority, target_path, dedupe_key, payload, created_at'
    )
    .eq('category', 'chat')
    .eq('type', 'chat_message.created')
    .eq('target_user_id', descriptor.targetUserId)
    .eq('priority', 'normal')
    .in('channel', ['push', 'both'])
    .gte('created_at', new Date(descriptor.bucketStartMs).toISOString())
    .lt('created_at', new Date(descriptor.bucketEndMs).toISOString())
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  const groupedEvents: AppEvent[] = []
  const envelopes = new Map<string, ChatPushEnvelope>()

  for (const event of ((data as PushCapableAppEventRow[] | null) ?? []).map(toAppEvent)) {
    const envelope = getChatPushEnvelopeFromAppEvent({
      payload: event.payload,
      targetPath: event.targetPath,
      priority: event.priority,
    })

    if (!envelope || envelope.threadId !== descriptor.threadId) {
      continue
    }

    groupedEvents.push(event)
    envelopes.set(event.id, envelope)
  }

  if (groupedEvents.length === 0) {
    return null
  }

  groupedEvents.sort(compareAppEventsByCreatedAt)

  return {
    key: descriptor.key,
    targetUserId: descriptor.targetUserId,
    threadId: descriptor.threadId,
    bucketStartMs: descriptor.bucketStartMs,
    bucketEndMs: descriptor.bucketEndMs,
    events: groupedEvents,
    envelopes,
    leaderEvent: groupedEvents[0],
    latestEvent: groupedEvents[groupedEvents.length - 1],
  }
}

async function loadLatestDeliveryStatesForEndpoint(input: {
  supabaseAdmin: SupabaseAdminClient
  appEventIds: string[]
  subscriptionEndpoint: string
}) {
  if (input.appEventIds.length === 0) {
    return new Map<string, AppEventPushDeliveryRow>()
  }

  const { data, error } = await input.supabaseAdmin
    .from('app_event_push_deliveries')
    .select('app_event_id, status, status_code, error_body, attempted_at')
    .eq('subscription_endpoint', input.subscriptionEndpoint)
    .in('app_event_id', input.appEventIds)
    .order('attempted_at', { ascending: false })

  if (error) {
    throw error
  }

  const latestStates = new Map<string, AppEventPushDeliveryRow>()

  for (const row of (data as AppEventPushDeliveryRow[] | null) ?? []) {
    if (!latestStates.has(row.app_event_id)) {
      latestStates.set(row.app_event_id, row)
    }
  }

  return latestStates
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

async function recordGroupedEventLevelOutcome(input: {
  supabaseAdmin: SupabaseAdminClient
  events: AppEvent[]
  userId: string
  status: 'skipped' | 'failed'
  errorBody?: string | null
}) {
  for (const event of input.events) {
    await recordEventLevelOutcome({
      supabaseAdmin: input.supabaseAdmin,
      appEventId: event.id,
      userId: input.userId,
      status: input.status,
      errorBody: input.errorBody ?? null,
    })
  }
}

async function backfillGroupedEndpointOutcome(input: {
  supabaseAdmin: SupabaseAdminClient
  events: AppEvent[]
  userId: string
  subscriptionEndpoint: string
  status: HandledAppEventPushDeliveryStatus
  statusCode?: number | null
  errorBody?: string | null
  skipAppEventIds?: string[]
}) {
  const skipEventIds = new Set(input.skipAppEventIds ?? [])

  for (const event of input.events) {
    if (skipEventIds.has(event.id)) {
      continue
    }

    const claim = await claimDeliveryAttempt({
      supabaseAdmin: input.supabaseAdmin,
      appEventId: event.id,
      userId: input.userId,
      subscriptionEndpoint: input.subscriptionEndpoint,
    })

    if (!claim.claimed || !claim.deliveryId) {
      continue
    }

    await finalizeDeliveryAttempt({
      supabaseAdmin: input.supabaseAdmin,
      deliveryId: claim.deliveryId,
      status: input.status,
      statusCode: input.statusCode ?? null,
      errorBody: input.errorBody ?? null,
    })
  }
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

async function processSingleChatAppEventPush(supabaseAdmin: SupabaseAdminClient, event: AppEvent) {
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

  const unreadMetadata = await loadChatPushDeliveryPayloadMetadata(
    supabaseAdmin,
    targetUserId,
    pushEnvelope.threadId
  )
  const timestamp = Date.parse(event.createdAt)
  const payload: ChatPushDeliveryPayload = {
    title: pushEnvelope.title,
    body: pushEnvelope.body,
    targetUrl: pushEnvelope.targetPath,
    messageId: pushEnvelope.messageId || undefined,
    threadId: pushEnvelope.threadId,
    threadType: pushEnvelope.threadType,
    priority: pushEnvelope.priority,
    hasMentions: pushEnvelope.hasMentions,
    isMentioned: pushEnvelope.isMentioned,
    tag: pushEnvelope.priority === 'normal' ? `chat:${pushEnvelope.threadId}` : undefined,
    timestamp: Number.isNaN(timestamp) ? undefined : timestamp,
    ...unreadMetadata,
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
      payload,
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

async function processSingleGenericAppEventPush(
  supabaseAdmin: SupabaseAdminClient,
  event: AppEvent
) {
  const targetUserId = event.targetUserId

  if (!targetUserId) {
    return
  }

  let pushPayload: GenericPushDeliveryPayload | null = null
  let preferenceEnabled = true
  let preferenceDisabledError = 'notification_disabled'

  if (event.type === 'race_event.liked') {
    pushPayload = buildRaceEventLikedPushPayload(event)
    preferenceEnabled = false
    preferenceDisabledError = 'run_like_disabled'
  }

  if (!pushPayload) {
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

  if (event.type === 'race_event.liked') {
    preferenceEnabled = userPreferences.run_like_enabled
  }

  if (!preferenceEnabled) {
    await recordEventLevelOutcome({
      supabaseAdmin,
      appEventId: event.id,
      userId: targetUserId,
      status: 'skipped',
      errorBody: preferenceDisabledError,
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
      payload: pushPayload,
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

async function processCoalescedChatAppEventPush(
  supabaseAdmin: SupabaseAdminClient,
  event: AppEvent,
  descriptor: ChatPushCoalescingDescriptor
) {
  const waitMs = descriptor.bucketEndMs - Date.now()

  if (waitMs > 0) {
    await sleep(waitMs)
  }

  const group = await loadCoalescedChatPushGroup(supabaseAdmin, descriptor)

  if (!group) {
    await recordEventLevelOutcome({
      supabaseAdmin,
      appEventId: event.id,
      userId: descriptor.targetUserId,
      status: 'failed',
      errorBody: 'chat_push_group_missing',
    })
    return
  }

  const basePushPayload = buildGroupedChatPushPayload(group)

  if (!basePushPayload) {
    await recordGroupedEventLevelOutcome({
      supabaseAdmin,
      events: group.events,
      userId: descriptor.targetUserId,
      status: 'failed',
      errorBody: 'invalid_chat_push_event_payload',
    })
    return
  }

  const userPreferences = await getUserPushPreferencesForUser(supabaseAdmin, descriptor.targetUserId)

  if (!userPreferences.push_enabled) {
    await recordGroupedEventLevelOutcome({
      supabaseAdmin,
      events: group.events,
      userId: descriptor.targetUserId,
      status: 'skipped',
      errorBody: 'push_disabled',
    })
    return
  }

  if (!userPreferences.chat_enabled) {
    await recordGroupedEventLevelOutcome({
      supabaseAdmin,
      events: group.events,
      userId: descriptor.targetUserId,
      status: 'skipped',
      errorBody: 'chat_disabled',
    })
    return
  }

  const threadPushLevel = await loadThreadPushLevel(supabaseAdmin, descriptor.targetUserId, descriptor.threadId)

  if (threadPushLevel === 'mute') {
    await recordGroupedEventLevelOutcome({
      supabaseAdmin,
      events: group.events,
      userId: descriptor.targetUserId,
      status: 'skipped',
      errorBody: 'thread_muted',
    })
    return
  }

  if (threadPushLevel === 'important_only') {
    await recordGroupedEventLevelOutcome({
      supabaseAdmin,
      events: group.events,
      userId: descriptor.targetUserId,
      status: 'skipped',
      errorBody: 'thread_important_only',
    })
    return
  }

  const subscriptions = await loadUserSubscriptions(supabaseAdmin, descriptor.targetUserId)

  if (subscriptions.length === 0) {
    await recordGroupedEventLevelOutcome({
      supabaseAdmin,
      events: group.events,
      userId: descriptor.targetUserId,
      status: 'skipped',
      errorBody: 'no_push_subscriptions',
    })
    return
  }

  const unreadMetadata = await loadChatPushDeliveryPayloadMetadata(
    supabaseAdmin,
    descriptor.targetUserId,
    descriptor.threadId
  )
  const pushPayload = {
    ...basePushPayload,
    ...unreadMetadata,
  }

  for (const subscription of subscriptions) {
    const latestStates = await loadLatestDeliveryStatesForEndpoint({
      supabaseAdmin,
      appEventIds: group.events.map((groupEvent) => groupEvent.id),
      subscriptionEndpoint: subscription.endpoint,
    })
    const leaderState = latestStates.get(group.leaderEvent.id)

    if (leaderState?.status === 'processing') {
      continue
    }

    if (leaderState && isHandledDeliveryStatus(leaderState.status)) {
      await backfillGroupedEndpointOutcome({
        supabaseAdmin,
        events: group.events,
        userId: descriptor.targetUserId,
        subscriptionEndpoint: subscription.endpoint,
        status: leaderState.status,
        statusCode: leaderState.status_code,
        errorBody: leaderState.error_body,
        skipAppEventIds: [group.leaderEvent.id],
      })
      continue
    }

    const claim = await claimDeliveryAttempt({
      supabaseAdmin,
      appEventId: group.leaderEvent.id,
      userId: descriptor.targetUserId,
      subscriptionEndpoint: subscription.endpoint,
    })

    if (!claim.claimed || !claim.deliveryId) {
      continue
    }

    const result = await sendWebPush({
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      payload: pushPayload,
    })

    if (result.ok) {
      await finalizeDeliveryAttempt({
        supabaseAdmin,
        deliveryId: claim.deliveryId,
        status: 'sent',
      })
      await backfillGroupedEndpointOutcome({
        supabaseAdmin,
        events: group.events,
        userId: descriptor.targetUserId,
        subscriptionEndpoint: subscription.endpoint,
        status: 'sent',
        skipAppEventIds: [group.leaderEvent.id],
      })
      continue
    }

    const isExpiredEndpoint = result.statusCode === 404 || result.statusCode === 410

    if (isExpiredEndpoint) {
      try {
        await deleteDeadSubscription(supabaseAdmin, subscription.endpoint)
      } catch (error) {
        console.error('Failed to delete expired push subscription', {
          appEventId: group.leaderEvent.id,
          userId: descriptor.targetUserId,
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

    if (isExpiredEndpoint) {
      await backfillGroupedEndpointOutcome({
        supabaseAdmin,
        events: group.events,
        userId: descriptor.targetUserId,
        subscriptionEndpoint: subscription.endpoint,
        status: 'expired',
        statusCode: result.statusCode ?? null,
        errorBody: result.errorBody ?? null,
        skipAppEventIds: [group.leaderEvent.id],
      })
    }
  }
}

async function processChatAppEventPush(supabaseAdmin: SupabaseAdminClient, event: AppEvent) {
  const descriptor = getChatPushCoalescingDescriptor(event)

  if (!descriptor) {
    await processSingleChatAppEventPush(supabaseAdmin, event)
    return
  }

  await processCoalescedChatAppEventPush(supabaseAdmin, event, descriptor)
}

export async function processAppEventPushDeliveries(
  options: ProcessAppEventPushDeliveriesOptions = {}
): Promise<void> {
  const supabaseAdmin = createSupabaseAdminClient()
  const events = await loadPushEligibleAppEvents(supabaseAdmin, options)
  const processedCoalescedGroups = new Set<string>()

  for (const event of events) {
    const descriptor = getChatPushCoalescingDescriptor(event)

    if (descriptor && processedCoalescedGroups.has(descriptor.key)) {
      continue
    }

    if (descriptor) {
      processedCoalescedGroups.add(descriptor.key)
    }

    try {
      if (event.type === 'chat_message.created') {
        await processChatAppEventPush(supabaseAdmin, event)
      } else {
        await processSingleGenericAppEventPush(supabaseAdmin, event)
      }
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
