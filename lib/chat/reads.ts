import { getBootstrapUser } from '../auth'
import { supabase } from '../supabase'

type ChatThreadRow = {
  id: string
}

type ChatThreadReadRow = {
  thread_id: string
  user_id: string
  last_read_at: string | null
}

type ChatMessageReadMarkerRow = {
  id: string
  created_at: string
}

export type UnreadCountsByThread = Record<string, number>

async function requireCurrentUserId() {
  const user = await getBootstrapUser()

  if (!user) {
    throw new Error('auth_required')
  }

  return user.id
}

async function getAccessibleThreadIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('chat_threads')
    .select('id')

  if (error) {
    throw error
  }

  return ((data as ChatThreadRow[] | null) ?? []).map((thread) => thread.id)
}

async function getThreadReadRows(userId: string, threadIds: string[]) {
  if (threadIds.length === 0) {
    return {}
  }

  const { data, error } = await supabase
    .from('chat_thread_reads')
    .select('thread_id, user_id, last_read_at')
    .eq('user_id', userId)
    .in('thread_id', threadIds)

  if (error) {
    throw error
  }

  return Object.fromEntries(
    ((data as ChatThreadReadRow[] | null) ?? []).map((row) => [row.thread_id, row])
  ) as Record<string, ChatThreadReadRow>
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
  const threadIds = await getAccessibleThreadIds()

  if (threadIds.length === 0) {
    return {}
  }

  const readStateByThreadId = await getThreadReadRows(userId, threadIds)
  const unreadCountsEntries = await Promise.all(
    threadIds.map(async (threadId) => {
      const lastReadAt = readStateByThreadId[threadId]?.last_read_at ?? null
      const unreadMessagesQuery = supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('thread_id', threadId)
        .eq('is_deleted', false)
        .neq('user_id', userId)

      if (lastReadAt) {
        unreadMessagesQuery.gt('created_at', lastReadAt)
      }

      const { count, error } = await unreadMessagesQuery

      if (error) {
        throw error
      }

      return [threadId, count ?? 0] as const
    })
  )

  return Object.fromEntries(unreadCountsEntries)
}

export async function getTotalUnreadCount(): Promise<number> {
  const unreadCountsByThread = await getUnreadCountsByThread()

  return Object.values(unreadCountsByThread).reduce((total, count) => total + count, 0)
}
