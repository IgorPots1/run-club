'use client'

export const CHAT_OPEN_DEBUG = true
export const CHAT_OPEN_DEBUG_PREFIX = '[chat-open-debug]'
export const CHAT_OPEN_DEBUG_EVENT = 'run-club:chat-open-debug'
const CHAT_OPEN_DEBUG_MAX_ENTRIES = 15

export type ChatOpenDebugPayload = {
  now: number
  scope: string
  event?: string
  source?: string | null
  reason?: string | null
  threadId?: string | null
  [key: string]: unknown
}

export type ChatOpenDebugOverlayEntry = {
  id: string
  now: number
  label: string
}

declare global {
  interface Window {
    __chatOpenDebugEntries?: ChatOpenDebugOverlayEntry[]
  }
}

function toOverlayLabel(payload: ChatOpenDebugPayload) {
  const parts = [payload.scope, payload.event, payload.source, payload.reason]
    .filter((part) => typeof part === 'string' && part.length > 0)

  return parts.join(' | ')
}

export function getChatOpenDebugEntries() {
  if (typeof window === 'undefined') {
    return []
  }

  return window.__chatOpenDebugEntries ?? []
}

export function pushChatOpenDebug(payload: ChatOpenDebugPayload) {
  if (!CHAT_OPEN_DEBUG) {
    return
  }

  console.log(CHAT_OPEN_DEBUG_PREFIX, payload)

  if (typeof window === 'undefined') {
    return
  }

  const nextEntry: ChatOpenDebugOverlayEntry = {
    id: `${payload.now}-${Math.random().toString(36).slice(2, 8)}`,
    now: payload.now,
    label: toOverlayLabel(payload),
  }

  const nextEntries = [...getChatOpenDebugEntries(), nextEntry].slice(-CHAT_OPEN_DEBUG_MAX_ENTRIES)
  window.__chatOpenDebugEntries = nextEntries
  window.dispatchEvent(new CustomEvent(CHAT_OPEN_DEBUG_EVENT, { detail: nextEntries }))
}
