import 'server-only'

import {
  normalizeAppEventChannel,
  normalizeAppEventPriority,
  normalizeAppEventTargetPath,
  type AppEventChannel,
  type AppEventPriority,
} from '@/lib/events/appEventRouting'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export type AppEventPayload = Record<string, unknown>

export type CreateAppEventInput = {
  type: string
  actorUserId?: string | null
  targetUserId?: string | null
  entityType?: string | null
  entityId?: string | null
  payload?: AppEventPayload
  category?: string | null
  channel?: AppEventChannel | null
  priority?: AppEventPriority | null
  targetPath?: string | null
  dedupeKey?: string | null
}

export type AppEvent = {
  id: string
  type: string
  actorUserId: string | null
  targetUserId: string | null
  entityType: string | null
  entityId: string | null
  category: string | null
  channel: AppEventChannel | null
  priority: AppEventPriority | null
  targetPath: string | null
  dedupeKey: string | null
  payload: AppEventPayload
  createdAt: string
}

type AppEventRow = {
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

function normalizeAppEventType(type: string) {
  return type.trim()
}

function toInsertableAppEvent(input: CreateAppEventInput) {
  const type = normalizeAppEventType(input.type)
  const payloadTargetPath = normalizeAppEventTargetPath(
    typeof input.payload?.targetPath === 'string' ? input.payload.targetPath : null
  )

  if (!type) {
    throw new Error('app_event_type_required')
  }

  return {
    type,
    actor_user_id: input.actorUserId ?? null,
    target_user_id: input.targetUserId ?? null,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    category: input.category?.trim() || null,
    channel: input.channel ? normalizeAppEventChannel(input.channel) : null,
    priority: input.priority ? normalizeAppEventPriority(input.priority) : null,
    target_path: normalizeAppEventTargetPath(input.targetPath) ?? payloadTargetPath,
    dedupe_key: input.dedupeKey?.trim() || null,
    payload: input.payload ?? {},
  }
}

function toAppEvent(row: AppEventRow): AppEvent {
  return {
    id: row.id,
    type: row.type,
    actorUserId: row.actor_user_id,
    targetUserId: row.target_user_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    category: row.category?.trim() || null,
    channel: row.channel ? normalizeAppEventChannel(row.channel) : null,
    priority: row.priority ? normalizeAppEventPriority(row.priority) : null,
    targetPath: normalizeAppEventTargetPath(row.target_path),
    dedupeKey: row.dedupe_key?.trim() || null,
    payload: row.payload ?? {},
    createdAt: row.created_at,
  }
}

export async function createAppEvent(input: CreateAppEventInput): Promise<AppEvent> {
  const row = toInsertableAppEvent(input)

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('app_events')
    .insert(row)
    .select(
      'id, type, actor_user_id, target_user_id, entity_type, entity_id, category, channel, priority, target_path, dedupe_key, payload, created_at'
    )
    .single()

  if (error) {
    throw error
  }

  return toAppEvent(data as AppEventRow)
}

export async function createAppEvents(inputs: CreateAppEventInput[]): Promise<void> {
  if (inputs.length === 0) {
    return
  }

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('app_events')
    .insert(inputs.map(toInsertableAppEvent))

  if (error) {
    throw error
  }
}

// Example future usage for chat notifications fan-out:
// await createAppEvent({
//   type: 'chat_message.created',
//   actorUserId: senderUserId,
//   targetUserId: recipientUserId,
//   entityType: 'chat_message',
//   entityId: messageId,
//   payload: { threadId, previewText },
// })
