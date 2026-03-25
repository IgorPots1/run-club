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

export async function markThreadAsRead(threadId: string) {
  const userId = await requireCurrentUserId()

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
  const lastReadAt = latestMessageRow?.created_at ?? new Date().toISOString()

  const { error: upsertError } = await supabase
    .from('chat_thread_reads')
    .upsert(
      {
        thread_id: threadId,
        user_id: userId,
        last_read_message_id: latestMessageRow?.id ?? null,
        last_read_at: lastReadAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'thread_id,user_id' }
    )

  if (upsertError) {
    throw upsertError
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
