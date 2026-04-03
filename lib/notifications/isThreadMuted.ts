import 'server-only'

import { isThreadPushMuted, type ThreadPushLevelRow } from '@/lib/notifications/push'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export async function isThreadMuted(userId: string, threadId: string): Promise<boolean> {
  const supabaseAdmin = createSupabaseAdminClient()
  const { data, error } = await supabaseAdmin
    .from('user_notification_settings')
    .select('muted, push_level')
    .eq('user_id', userId)
    .eq('thread_id', threadId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return isThreadPushMuted((data as ThreadPushLevelRow | null) ?? null)
}
