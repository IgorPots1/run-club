export const APP_EVENT_PRIORITY_VALUES = ['normal', 'important'] as const

export type AppEventPriority = (typeof APP_EVENT_PRIORITY_VALUES)[number]

export const APP_EVENT_CHANNEL_VALUES = ['inbox', 'push', 'both'] as const

export type AppEventChannel = (typeof APP_EVENT_CHANNEL_VALUES)[number]

export function isAppEventPriority(value: string | null | undefined): value is AppEventPriority {
  return value === 'normal' || value === 'important'
}

export function isAppEventChannel(value: string | null | undefined): value is AppEventChannel {
  return value === 'inbox' || value === 'push' || value === 'both'
}

export function normalizeAppEventPriority(
  value: string | null | undefined,
  fallback: AppEventPriority = 'normal'
): AppEventPriority {
  return isAppEventPriority(value) ? value : fallback
}

export function normalizeAppEventChannel(
  value: string | null | undefined,
  fallback: AppEventChannel = 'inbox'
): AppEventChannel {
  return isAppEventChannel(value) ? value : fallback
}

export function normalizeAppEventTargetPath(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim()

  return trimmedValue && trimmedValue.startsWith('/') ? trimmedValue : null
}
