import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getProfileDisplayName } from '@/lib/profiles'

type AppEventRow = {
  id: string
  type: string
  actor_user_id: string | null
  entity_type: string | null
  entity_id: string | null
  payload: Record<string, unknown> | null
  created_at: string
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
  const targetPath =
    typeof payload?.targetPath === 'string' && payload.targetPath.startsWith('/')
      ? payload.targetPath
      : null

  return {
    targetPath,
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
    targetPath: payload.targetPath,
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
    .select('id, type, actor_user_id, entity_type, entity_id, payload, created_at')
    .eq('target_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw error
  }

  const rows = ((data as AppEventRow[] | null) ?? []).filter((row) =>
    row.type === 'run_like.created' ||
    row.type === 'run_comment.created' ||
    row.type === 'run_comment.reply_created' ||
    row.type === 'challenge.completed'
  )

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
