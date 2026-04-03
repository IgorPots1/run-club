'use client'

import type { PushPreferences, PushPreferencesUpdate } from '@/lib/notifications/preferences'
import type { PushLevel } from '@/lib/notifications/push'

type PushPreferencesApiResponse = {
  ok: boolean
  preferences?: PushPreferences
  error?: string
}

type ThreadPushSettingsApiResponse = {
  ok: boolean
  threadId?: string
  push_level?: PushLevel
  muted?: boolean
  error?: string
}

export type ThreadPushSettings = {
  threadId: string
  push_level: PushLevel
  muted: boolean
}

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  return await response.json().catch(() => null) as T | null
}

export async function loadPushPreferences(): Promise<PushPreferences> {
  const response = await fetch('/api/push/preferences', {
    method: 'GET',
    cache: 'no-store',
    credentials: 'include',
  })
  const payload = await parseJsonResponse<PushPreferencesApiResponse>(response)

  if (!response.ok || !payload?.ok || !payload.preferences) {
    throw new Error(payload?.error ?? 'push_preferences_load_failed')
  }

  return payload.preferences
}

export async function updatePushPreferences(
  updates: PushPreferencesUpdate
): Promise<PushPreferences> {
  const response = await fetch('/api/push/preferences', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(updates),
  })
  const payload = await parseJsonResponse<PushPreferencesApiResponse>(response)

  if (!response.ok || !payload?.ok || !payload.preferences) {
    throw new Error(payload?.error ?? 'push_preferences_update_failed')
  }

  return payload.preferences
}

export async function loadThreadPushSettings(threadId: string): Promise<ThreadPushSettings> {
  const response = await fetch(`/api/notifications/thread-settings?threadId=${encodeURIComponent(threadId)}`, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'include',
  })
  const payload = await parseJsonResponse<ThreadPushSettingsApiResponse>(response)

  if (!response.ok || !payload?.ok || !payload.threadId || !payload.push_level) {
    throw new Error(payload?.error ?? 'thread_push_settings_load_failed')
  }

  return {
    threadId: payload.threadId,
    push_level: payload.push_level,
    muted: Boolean(payload.muted),
  }
}

export async function updateThreadPushSettings(
  threadId: string,
  pushLevel: PushLevel
): Promise<ThreadPushSettings> {
  const response = await fetch('/api/notifications/thread-settings', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({
      threadId,
      push_level: pushLevel,
    }),
  })
  const payload = await parseJsonResponse<ThreadPushSettingsApiResponse>(response)

  if (!response.ok || !payload?.ok || !payload.threadId || !payload.push_level) {
    throw new Error(payload?.error ?? 'thread_push_settings_update_failed')
  }

  return {
    threadId: payload.threadId,
    push_level: payload.push_level,
    muted: Boolean(payload.muted),
  }
}
