import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type UserNotificationSettingRow = {
  muted: boolean
}

export async function isThreadMuted(userId: string, threadId: string): Promise<boolean> {
  const supabaseAdmin = createSupabaseAdminClient()
  const { data, error } = await supabaseAdmin
    .from('user_notification_settings')
    .select('muted')
    .eq('user_id', userId)
    .eq('thread_id', threadId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return ((data as UserNotificationSettingRow | null) ?? null)?.muted ?? false
}
