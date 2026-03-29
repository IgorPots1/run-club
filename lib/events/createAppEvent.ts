import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export type AppEventPayload = Record<string, unknown>

export type CreateAppEventInput = {
  type: string
  actorUserId?: string | null
  targetUserId?: string | null
  entityType?: string | null
  entityId?: string | null
  payload?: AppEventPayload
}

export type AppEvent = {
  id: string
  type: string
  actorUserId: string | null
  targetUserId: string | null
  entityType: string | null
  entityId: string | null
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
  payload: AppEventPayload
  created_at: string
}

function normalizeAppEventType(type: string) {
  return type.trim()
}

function toAppEvent(row: AppEventRow): AppEvent {
  return {
    id: row.id,
    type: row.type,
    actorUserId: row.actor_user_id,
    targetUserId: row.target_user_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: row.payload ?? {},
    createdAt: row.created_at,
  }
}

export async function createAppEvent(input: CreateAppEventInput): Promise<AppEvent> {
  const type = normalizeAppEventType(input.type)

  if (!type) {
    throw new Error('app_event_type_required')
  }

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('app_events')
    .insert({
      type,
      actor_user_id: input.actorUserId ?? null,
      target_user_id: input.targetUserId ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      payload: input.payload ?? {},
    })
    .select('id, type, actor_user_id, target_user_id, entity_type, entity_id, payload, created_at')
    .single()

  if (error) {
    throw error
  }

  return toAppEvent(data as AppEventRow)
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
