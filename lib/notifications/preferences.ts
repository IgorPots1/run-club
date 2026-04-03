export const PUSH_PREFERENCE_KEYS = [
  'push_enabled',
  'chat_enabled',
  'chat_important_enabled',
  'run_like_enabled',
  'run_comment_enabled',
  'challenge_completed_enabled',
] as const

export type PushPreferenceKey = (typeof PUSH_PREFERENCE_KEYS)[number]

export type PushPreferences = {
  push_enabled: boolean
  chat_enabled: boolean
  chat_important_enabled: boolean
  run_like_enabled: boolean
  run_comment_enabled: boolean
  challenge_completed_enabled: boolean
}

export type PushPreferencesUpdate = Partial<PushPreferences>

export const DEFAULT_PUSH_PREFERENCES: PushPreferences = {
  push_enabled: true,
  chat_enabled: true,
  chat_important_enabled: true,
  run_like_enabled: false,
  run_comment_enabled: true,
  challenge_completed_enabled: true,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function pickPushPreferences(value: PushPreferences) {
  return {
    push_enabled: value.push_enabled,
    chat_enabled: value.chat_enabled,
    chat_important_enabled: value.chat_important_enabled,
    run_like_enabled: value.run_like_enabled,
    run_comment_enabled: value.run_comment_enabled,
    challenge_completed_enabled: value.challenge_completed_enabled,
  } satisfies PushPreferences
}

export function parsePushPreferencesUpdate(value: unknown):
  | { ok: true; value: PushPreferencesUpdate }
  | { ok: false; error: string } {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: 'invalid_push_preferences_update',
    }
  }

  const updates: PushPreferencesUpdate = {}

  for (const key of PUSH_PREFERENCE_KEYS) {
    const nextValue = value[key]

    if (nextValue === undefined) {
      continue
    }

    if (typeof nextValue !== 'boolean') {
      return {
        ok: false,
        error: `invalid_${key}`,
      }
    }

    updates[key] = nextValue
  }

  if (Object.keys(updates).length === 0) {
    return {
      ok: false,
      error: 'push_preferences_update_required',
    }
  }

  return {
    ok: true,
    value: updates,
  }
}
