export const CHAT_SEND_DEBUG_PREFIX = '[chat-send-debug]'
// TEMP: force debug ON for mobile debugging, revert after investigation
export const CHAT_SEND_DEBUG = true
const MAX_CHAT_SEND_DEBUG_EVENTS = 50

export type ChatSendDebugErrorCategory =
  | 'network_error'
  | 'non_200_response'
  | 'invalid_json'
  | 'api_error'
  | 'attachment_upload_error'
  | 'optimistic_reconcile_error'
  | 'unknown_error'

type ChatSendDebugPayload = Record<string, unknown>

export type ChatSendDebugEvent = {
  id: string
  timestamp: string
  level: 'log' | 'error'
  phase: string
  payload: ChatSendDebugPayload
}

type ChatSendDebugError = Error & {
  chatSendCategory?: ChatSendDebugErrorCategory
  chatSendDetails?: ChatSendDebugPayload
}

const chatSendDebugEvents: ChatSendDebugEvent[] = []
const chatSendDebugListeners = new Set<() => void>()

function toSerializableValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }

  if (Array.isArray(value)) {
    return value.map(toSerializableValue)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, toSerializableValue(nestedValue)])
    )
  }

  return value
}

function emitChatSendDebugLog(
  level: 'log' | 'error',
  phase: string,
  payload?: ChatSendDebugPayload
) {
  if (!CHAT_SEND_DEBUG) {
    return
  }
  const serializedPayload = (payload ? toSerializableValue(payload) : {}) as ChatSendDebugPayload

  if (typeof window !== 'undefined') {
    chatSendDebugEvents.unshift({
      id:
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      timestamp: new Date().toISOString(),
      level,
      phase,
      payload: serializedPayload,
    })

    if (chatSendDebugEvents.length > MAX_CHAT_SEND_DEBUG_EVENTS) {
      chatSendDebugEvents.length = MAX_CHAT_SEND_DEBUG_EVENTS
    }

    chatSendDebugListeners.forEach((listener) => {
      listener()
    })
  }

  console[level](CHAT_SEND_DEBUG_PREFIX, phase, serializedPayload)
}

export function logChatSendDebug(phase: string, payload?: ChatSendDebugPayload) {
  emitChatSendDebugLog('log', phase, payload)
}

export function logChatSendDebugError(phase: string, payload?: ChatSendDebugPayload) {
  emitChatSendDebugLog('error', phase, payload)
}

export function createChatSendDebugError(
  category: ChatSendDebugErrorCategory,
  message: string,
  details?: ChatSendDebugPayload
) {
  const error = new Error(message) as ChatSendDebugError
  error.chatSendCategory = category
  error.chatSendDetails = details
  return error
}

export function getChatSendDebugErrorCategory(error: unknown): ChatSendDebugErrorCategory {
  if (
    error &&
    typeof error === 'object' &&
    'chatSendCategory' in error &&
    typeof (error as ChatSendDebugError).chatSendCategory === 'string'
  ) {
    return (error as ChatSendDebugError).chatSendCategory as ChatSendDebugErrorCategory
  }

  return 'unknown_error'
}

export function getChatSendDebugErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(typeof (error as ChatSendDebugError).chatSendDetails === 'object'
        ? { details: toSerializableValue((error as ChatSendDebugError).chatSendDetails) }
        : {}),
    }
  }

  if (typeof error === 'object' && error !== null) {
    return {
      raw: toSerializableValue(error),
    }
  }

  return {
    raw: String(error),
  }
}

export function getRecentChatSendDebugEvents() {
  return [...chatSendDebugEvents]
}

export function subscribeChatSendDebugEvents(listener: () => void) {
  if (!CHAT_SEND_DEBUG || typeof window === 'undefined') {
    return () => {}
  }

  chatSendDebugListeners.add(listener)

  return () => {
    chatSendDebugListeners.delete(listener)
  }
}
