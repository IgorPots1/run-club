import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getProfileDisplayName } from '@/lib/profiles'

export const INBOX_APP_EVENT_TYPES = [
  'run_like.created',
  'run_comment.created',
  'run_comment.reply_created',
  'challenge.completed',
  'race_event.created',
  'race_event.completed',
] as const

export type InboxAppEventType = typeof INBOX_APP_EVENT_TYPES[number]

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
  type: InboxAppEventType
  createdAt: string
  targetPath: string | null
  entityId: string | null
  actorName: string | null
  actorAvatarUrl: string | null
  title: string
  body: string | null
}

export type GroupedRunLikeInboxItem = {
  id: string
  type: 'grouped_run_like'
  createdAt: string
  targetPath: string | null
  entityId: string
  actorCount: number
  actorPreviewNames: string[]
  actorPreviewAvatarUrls: string[]
  title: string
  body: string | null
}

export type InboxListItem =
  | InboxEventItem
  | GroupedRunLikeInboxItem

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
    case 'race_event.created':
      return {
        title: 'Новый старт',
        body: null,
      }
    case 'race_event.completed':
      return {
        title: 'Старт завершен',
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
    type: event.type as InboxAppEventType,
    createdAt: event.created_at,
    targetPath: event.target_path ?? payload.targetPath,
    entityId: event.entity_id ?? null,
    actorName,
    actorAvatarUrl: actorProfile?.avatar_url ?? null,
    title: payload.preview.title ?? fallback.title,
    body: payload.preview.body ?? fallback.body,
  }
}

function isGroupableRunLikeItem(item: InboxEventItem): item is InboxEventItem & {
  type: 'run_like.created'
  entityId: string
} {
  return item.type === 'run_like.created' && typeof item.entityId === 'string' && item.entityId.trim().length > 0
}

function buildGroupedRunLikeInboxItem(
  items: Array<InboxEventItem & { type: 'run_like.created'; entityId: string }>
): GroupedRunLikeInboxItem {
  const newestItem = items[0]!

  return {
    id: `grouped-run-like:${newestItem.id}`,
    type: 'grouped_run_like',
    createdAt: newestItem.createdAt,
    targetPath: newestItem.targetPath,
    entityId: newestItem.entityId,
    actorCount: items.length,
    actorPreviewNames: items
      .map((item) => item.actorName?.trim() ?? '')
      .filter(Boolean)
      .slice(0, 2),
    actorPreviewAvatarUrls: items
      .map((item) => item.actorAvatarUrl?.trim() ?? '')
      .filter(Boolean)
      .slice(0, 2),
    title: newestItem.title,
    body: newestItem.body,
  }
}

function groupInboxItemsForDisplay(items: InboxEventItem[]): InboxListItem[] {
  const groupedItems: InboxListItem[] = []

  for (let index = 0; index < items.length; index += 1) {
    const currentItem = items[index]

    if (!isGroupableRunLikeItem(currentItem)) {
      groupedItems.push(currentItem)
      continue
    }

    const runLikeGroup = [currentItem]
    let nextIndex = index + 1

    while (nextIndex < items.length) {
      const nextItem = items[nextIndex]

      if (!isGroupableRunLikeItem(nextItem) || nextItem.entityId !== currentItem.entityId) {
        break
      }

      runLikeGroup.push(nextItem)
      nextIndex += 1
    }

    if (runLikeGroup.length >= 2) {
      groupedItems.push(buildGroupedRunLikeInboxItem(runLikeGroup))
      index = nextIndex - 1
      continue
    }

    groupedItems.push(currentItem)
  }

  return groupedItems
}

export async function loadInboxEventItems(userId: string, limit = 50): Promise<InboxListItem[]> {
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

  const items = rows.map((event) => buildInboxEventItem(event, actorProfilesById))

  return groupInboxItemsForDisplay(items)
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
