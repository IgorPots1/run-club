import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getProfileDisplayName } from '@/lib/profiles'

export const INBOX_APP_EVENT_TYPES = [
  'run_like.created',
  'run_comment.created',
  'run_comment.reply_created',
  'challenge.completed',
] as const

type AppEventRow = {
  id: string
  type: string
  actor_user_id: string | null
  entity_type: string | null
  entity_id: string | null
  target_path: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

type ActivityInboxReadStateRow = {
  activity_inbox_last_read_at: string | null
}

type AppEventActorProfileRow = {
  id: string
  name: string | null
  nickname: string | null
  email: string | null
  avatar_url: string | null
}

type EventPayloadPreview = {
  title: string | null
  body: string | null
}

type EventPayload = {
  targetPath: string | null
  preview: EventPayloadPreview
}

export type InboxEventItem = {
  id: string
  type: string
  createdAt: string
  targetPath: string | null
  actorName: string | null
  actorAvatarUrl: string | null
  title: string
  body: string | null
}

function asRecord(value: unknown) {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function getPayloadPreview(value: unknown): EventPayloadPreview {
  const preview = asRecord(asRecord(value)?.preview)

  return {
    title: typeof preview?.title === 'string' && preview.title.trim() ? preview.title.trim() : null,
    body: typeof preview?.body === 'string' && preview.body.trim() ? preview.body.trim() : null,
  }
}

function getPayload(value: unknown): EventPayload {
  const payload = asRecord(value)

  return {
    targetPath:
      typeof payload?.targetPath === 'string' && payload.targetPath.startsWith('/')
        ? payload.targetPath
        : null,
    preview: getPayloadPreview(payload),
  }
}

function getFallbackEventCopy(type: string) {
  switch (type) {
    case 'run_like.created':
      return {
        title: 'Вашу пробежку лайкнули',
        body: null,
      }
    case 'run_comment.created':
      return {
        title: 'Новый комментарий к вашей пробежке',
        body: null,
      }
    case 'run_comment.reply_created':
      return {
        title: 'Новый ответ на ваш комментарий',
        body: null,
      }
    case 'challenge.completed':
      return {
        title: 'Челлендж выполнен',
        body: null,
      }
    default:
      return {
        title: 'Новое событие',
        body: null,
      }
  }
}

async function getActivityInboxLastReadAt(
  userId: string,
  supabaseAdmin = createSupabaseAdminClient()
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('activity_inbox_last_read_at')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return ((data as ActivityInboxReadStateRow | null) ?? null)?.activity_inbox_last_read_at ?? null
}

function buildInboxEventItem(
  event: AppEventRow,
  actorProfilesById: Map<string, AppEventActorProfileRow>
): InboxEventItem {
  const payload = getPayload(event.payload)
  const actorProfile = event.actor_user_id ? actorProfilesById.get(event.actor_user_id) ?? null : null
  const actorName = actorProfile ? getProfileDisplayName(actorProfile, 'Бегун') : null
  const fallback = getFallbackEventCopy(event.type)

  return {
    id: event.id,
    type: event.type,
    createdAt: event.created_at,
    targetPath: event.target_path ?? payload.targetPath,
    actorName,
    actorAvatarUrl: actorProfile?.avatar_url ?? null,
    title: payload.preview.title ?? fallback.title,
    body: payload.preview.body ?? fallback.body,
  }
}

export async function loadInboxEventItems(userId: string, limit = 50): Promise<InboxEventItem[]> {
  const supabaseAdmin = createSupabaseAdminClient()
  const { data, error } = await supabaseAdmin
    .from('app_events')
    .select('id, type, actor_user_id, entity_type, entity_id, target_path, payload, created_at')
    .eq('target_user_id', userId)
    .in('type', INBOX_APP_EVENT_TYPES)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw error
  }

  const rows = (data as AppEventRow[] | null) ?? []

  const actorUserIds = Array.from(
    new Set(
      rows
        .map((row) => row.actor_user_id)
        .filter((value): value is string => Boolean(value))
    )
  )

  const actorProfilesById = new Map<string, AppEventActorProfileRow>()

  if (actorUserIds.length > 0) {
    const actorProfilesQuery = supabaseAdmin
      .from('profiles')
      .select('id, name, nickname, email, avatar_url')

    if (actorUserIds.length === 1) {
      actorProfilesQuery.eq('id', actorUserIds[0]!)
    } else {
      actorProfilesQuery.in('id', actorUserIds)
    }

    const { data: actorProfiles, error: actorProfilesError } = await actorProfilesQuery

    if (actorProfilesError) {
      throw actorProfilesError
    }

    for (const profile of (actorProfiles as AppEventActorProfileRow[] | null) ?? []) {
      actorProfilesById.set(profile.id, profile)
    }
  }

  return rows.map((event) => buildInboxEventItem(event, actorProfilesById))
}

export async function getInboxUnreadCount(userId: string): Promise<number> {
  const supabaseAdmin = createSupabaseAdminClient()
  const lastReadAt = await getActivityInboxLastReadAt(userId, supabaseAdmin)
  const unreadCountQuery = supabaseAdmin
    .from('app_events')
    .select('id', { count: 'exact', head: true })
    .eq('target_user_id', userId)
    .in('type', INBOX_APP_EVENT_TYPES)

  if (lastReadAt) {
    unreadCountQuery.gt('created_at', lastReadAt)
  }

  const { count, error } = await unreadCountQuery

  if (error) {
    throw error
  }

  return Math.max(0, Number(count ?? 0))
}

export async function markInboxEventsAsRead(userId: string): Promise<void> {
  const supabaseAdmin = createSupabaseAdminClient()
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      activity_inbox_last_read_at: new Date().toISOString(),
    })
    .eq('id', userId)

  if (error) {
    throw error
  }
}
