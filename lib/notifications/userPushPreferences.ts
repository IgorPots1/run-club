import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export type UserPushPreferencesRow = {
  user_id: string
  push_enabled: boolean
  chat_enabled: boolean
  chat_important_enabled: boolean
  run_like_enabled: boolean
  run_comment_enabled: boolean
  challenge_completed_enabled: boolean
  created_at: string
  updated_at: string
}

export const DEFAULT_USER_PUSH_PREFERENCES = {
  push_enabled: true,
  chat_enabled: true,
  chat_important_enabled: true,
  run_like_enabled: false,
  run_comment_enabled: true,
  challenge_completed_enabled: true,
} as const

const USER_PUSH_PREFERENCES_SELECT = [
  'user_id',
  'push_enabled',
  'chat_enabled',
  'chat_important_enabled',
  'run_like_enabled',
  'run_comment_enabled',
  'challenge_completed_enabled',
  'created_at',
  'updated_at',
].join(', ')

function normalizeUserPushPreferencesRow(
  userId: string,
  row: Partial<UserPushPreferencesRow> | null | undefined
): UserPushPreferencesRow {
  const now = new Date().toISOString()

  return {
    user_id: userId,
    push_enabled: row?.push_enabled ?? DEFAULT_USER_PUSH_PREFERENCES.push_enabled,
    chat_enabled: row?.chat_enabled ?? DEFAULT_USER_PUSH_PREFERENCES.chat_enabled,
    chat_important_enabled:
      row?.chat_important_enabled ?? DEFAULT_USER_PUSH_PREFERENCES.chat_important_enabled,
    run_like_enabled: row?.run_like_enabled ?? DEFAULT_USER_PUSH_PREFERENCES.run_like_enabled,
    run_comment_enabled:
      row?.run_comment_enabled ?? DEFAULT_USER_PUSH_PREFERENCES.run_comment_enabled,
    challenge_completed_enabled:
      row?.challenge_completed_enabled ?? DEFAULT_USER_PUSH_PREFERENCES.challenge_completed_enabled,
    created_at: row?.created_at ?? now,
    updated_at: row?.updated_at ?? now,
  }
}

async function loadOrCreateUserPushPreferences(
  supabase: SupabaseClient,
  userId: string
): Promise<UserPushPreferencesRow> {
  const { data, error: loadError } = await supabase
    .from('user_push_preferences')
    .select(USER_PUSH_PREFERENCES_SELECT)
    .eq('user_id', userId)
    .maybeSingle()

  if (loadError) {
    throw loadError
  }

  if (data) {
    return normalizeUserPushPreferencesRow(userId, data as Partial<UserPushPreferencesRow>)
  }

  const { data: inserted, error: insertError } = await supabase
    .from('user_push_preferences')
    .upsert(
      {
        user_id: userId,
      },
      {
        onConflict: 'user_id',
        ignoreDuplicates: false,
      }
    )
    .select(USER_PUSH_PREFERENCES_SELECT)
    .single()

  if (!insertError && inserted) {
    return normalizeUserPushPreferencesRow(userId, inserted as Partial<UserPushPreferencesRow>)
  }

  const { data: reloaded, error: reloadError } = await supabase
    .from('user_push_preferences')
    .select(USER_PUSH_PREFERENCES_SELECT)
    .eq('user_id', userId)
    .single()

  if (reloadError) {
    throw insertError ?? reloadError
  }

  return normalizeUserPushPreferencesRow(userId, reloaded as Partial<UserPushPreferencesRow>)
}

export async function getUserPushPreferencesForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<UserPushPreferencesRow> {
  return loadOrCreateUserPushPreferences(supabase, userId)
}

export async function getCurrentUserPushPreferences(): Promise<UserPushPreferencesRow> {
  const { user, error, supabase } = await getAuthenticatedUser()

  if (error || !user) {
    throw new Error(error?.message ?? 'auth_required')
  }

  return loadOrCreateUserPushPreferences(supabase, user.id)
}
