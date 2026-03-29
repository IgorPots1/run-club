'use client'

import { supabase } from '@/lib/supabase'

type ToggleThreadMuteResponse = {
  ok: boolean
  muted: boolean
  error?: string
}

export async function loadThreadMuteState(threadId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_notification_settings')
    .select('muted')
    .eq('thread_id', threadId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return Boolean((data as { muted?: boolean } | null)?.muted)
}

export async function toggleThreadMute(threadId: string, muted: boolean): Promise<boolean> {
  const response = await fetch(muted ? '/api/notifications/mute' : '/api/notifications/unmute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({
      threadId,
    }),
  })

  const payload = await response.json().catch(() => null) as ToggleThreadMuteResponse | null

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? 'thread_notification_toggle_failed')
  }

  return payload.muted
}
