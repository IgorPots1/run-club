import { CHAT_OPEN_DEBUG } from './chatOpenDebug'

export const CHAT_PERF_DEBUG = CHAT_OPEN_DEBUG
export const CHAT_PERF_DEBUG_PREFIX = '[chat-perf-debug]'
export const CHAT_PERF_DEBUG_EVENT = 'run-club:chat-perf-debug'
const CHAT_PERF_DEBUG_MAX_ENTRIES = 15

export type ChatPerfDebugPayload = {
  now: number
  scope: string
  event: string
  threadId?: string | null
  traceId?: string | null
  messageId?: string | null
  messageType?: string | null
  attachmentCount?: number | null
  messageCount?: number | null
  source?: string | null
  cacheStatus?: 'hit' | 'miss' | 'prefetch-hit' | 'prefetch-miss' | null
  durationMs?: number | null
  [key: string]: unknown
}

export type ChatPerfDebugOverlayEntry = {
  id: string
  now: number
  label: string
}

declare global {
  interface Window {
    __chatPerfDebugEntries?: ChatPerfDebugOverlayEntry[]
  }
}

function toOverlayLabel(payload: ChatPerfDebugPayload) {
  const parts = [
    payload.scope,
    payload.event,
    payload.source,
    typeof payload.durationMs === 'number' ? `${payload.durationMs}ms` : null,
    payload.cacheStatus,
    payload.traceId,
  ].filter((part) => typeof part === 'string' && part.length > 0)

  return parts.join(' | ')
}

export function getChatPerfDebugEntries() {
  if (typeof window === 'undefined') {
    return []
  }

  return window.__chatPerfDebugEntries ?? []
}

export function pushChatPerfDebug(payload: ChatPerfDebugPayload) {
  if (!CHAT_PERF_DEBUG) {
    return
  }

  console.log(CHAT_PERF_DEBUG_PREFIX, payload)

  if (typeof window === 'undefined') {
    return
  }

  const nextEntry: ChatPerfDebugOverlayEntry = {
    id: `${payload.now}-${Math.random().toString(36).slice(2, 8)}`,
    now: payload.now,
    label: toOverlayLabel(payload),
  }

  const nextEntries = [...getChatPerfDebugEntries(), nextEntry].slice(-CHAT_PERF_DEBUG_MAX_ENTRIES)
  window.__chatPerfDebugEntries = nextEntries
  window.dispatchEvent(new CustomEvent(CHAT_PERF_DEBUG_EVENT, { detail: nextEntries }))
}
