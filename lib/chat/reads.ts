import { getBootstrapUser } from '../auth'
import { supabase } from '../supabase'

type UnreadCountRpcRow = {
  thread_id: string
  unread_count: number | string | null
}

export type UnreadCountsByThread = Record<string, number>

async function requireCurrentUserId() {
  const user = await getBootstrapUser()

  if (!user) {
    throw new Error('auth_required')
  }

  return user.id
}

type ChatMessageReadMarkerRow = {
  id: string
  created_at: string
}

type ChatThreadReadRow = {
  last_read_at: string | null
}

export async function markThreadAsRead(threadId: string) {
  const userId = await requireCurrentUserId()
  const { data: existingReadMarker, error: existingReadMarkerError } = await supabase
    .from('chat_thread_reads')
    .select('last_read_at')
    .eq('thread_id', threadId)
    .eq('user_id', userId)
    .maybeSingle()

  if (existingReadMarkerError) {
    throw existingReadMarkerError
  }

  const previousLastReadAt = ((existingReadMarker as ChatThreadReadRow | null) ?? null)?.last_read_at ?? null
  const unreadMessagesQuery = supabase
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('thread_id', threadId)
    .eq('is_deleted', false)
    .neq('user_id', userId)

  if (previousLastReadAt) {
    unreadMessagesQuery.gt('created_at', previousLastReadAt)
  }

  const { count: clearedUnreadCount, error: unreadMessagesError } = await unreadMessagesQuery

  if (unreadMessagesError) {
    throw unreadMessagesError
  }

  const { data: latestMessage, error: latestMessageError } = await supabase
    .from('chat_messages')
    .select('id, created_at')
    .eq('thread_id', threadId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestMessageError) {
    throw latestMessageError
  }

  const latestMessageRow = (latestMessage as ChatMessageReadMarkerRow | null) ?? null
  const nextLastReadAt = latestMessageRow?.created_at ?? new Date().toISOString()

  const { error: upsertError } = await supabase
    .from('chat_thread_reads')
    .upsert(
      {
        thread_id: threadId,
        user_id: userId,
        last_read_message_id: latestMessageRow?.id ?? null,
        last_read_at: nextLastReadAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'thread_id,user_id' }
    )

  if (upsertError) {
    throw upsertError
  }

  return {
    clearedUnreadCount: clearedUnreadCount ?? 0,
  }
}

export async function getUnreadCountsByThread(): Promise<UnreadCountsByThread> {
  const userId = await requireCurrentUserId()
  const { data, error } = await supabase.rpc('get_unread_counts_by_thread', {
    p_user_id: userId,
  })

  if (error) {
    throw error
  }

  return Object.fromEntries(
    ((data as UnreadCountRpcRow[] | null) ?? []).map((row) => [
      row.thread_id,
      typeof row.unread_count === 'string'
        ? Number(row.unread_count)
        : Number(row.unread_count ?? 0),
    ])
  )
}

export async function getTotalUnreadCount(): Promise<number> {
  const unreadCountsByThread = await getUnreadCountsByThread()

  return Object.values(unreadCountsByThread).reduce((total, count) => total + count, 0)
}
