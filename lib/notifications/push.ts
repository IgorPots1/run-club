export const PUSH_LEVEL_VALUES = ['all', 'important_only', 'mute'] as const

export type PushLevel = (typeof PUSH_LEVEL_VALUES)[number]

export const PUSH_PRIORITY_VALUES = ['normal', 'important'] as const

export type PushPriority = (typeof PUSH_PRIORITY_VALUES)[number]

export type ThreadPushLevelRow = {
  muted?: boolean | null
  push_level?: string | null
}

export type ChatMessagePushPriorityRow = {
  push_priority?: string | null
}

function isPushLevel(value: string | null | undefined): value is PushLevel {
  return value === 'all' || value === 'important_only' || value === 'mute'
}

function isPushPriority(value: string | null | undefined): value is PushPriority {
  return value === 'normal' || value === 'important'
}

export function normalizeThreadPushLevel(row: ThreadPushLevelRow | null | undefined): PushLevel {
  const pushLevel = row?.push_level

  if (isPushLevel(pushLevel)) {
    return pushLevel
  }

  return row?.muted ? 'mute' : 'all'
}

export function isThreadPushMuted(row: ThreadPushLevelRow | null | undefined): boolean {
  return normalizeThreadPushLevel(row) === 'mute'
}

export function normalizeChatMessagePushPriority(
  row: ChatMessagePushPriorityRow | null | undefined
): PushPriority {
  const pushPriority = row?.push_priority

  return isPushPriority(pushPriority) ? pushPriority : 'normal'
}
