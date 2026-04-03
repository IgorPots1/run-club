'use client'

declare global {
  interface Window {
    __RUN_CLUB_APP_VISIBLE__?: boolean
    __RUN_CLUB_ACTIVE_THREAD_ID__?: string | null
  }
}

type ClientPresenceState = {
  isAppVisible: boolean
  activeThreadId: string | null
}

const DEFAULT_CLIENT_PRESENCE_STATE: ClientPresenceState = {
  isAppVisible: false,
  activeThreadId: null,
}

let clientPresenceState: ClientPresenceState = DEFAULT_CLIENT_PRESENCE_STATE

function syncWindowPresenceState() {
  if (typeof window === 'undefined') {
    return
  }

  window.__RUN_CLUB_APP_VISIBLE__ = clientPresenceState.isAppVisible
  window.__RUN_CLUB_ACTIVE_THREAD_ID__ = clientPresenceState.activeThreadId
}

export function getClientPresenceState(): ClientPresenceState {
  return clientPresenceState
}

export function setAppVisibilityState(isAppVisible: boolean) {
  clientPresenceState = {
    ...clientPresenceState,
    isAppVisible,
  }
  syncWindowPresenceState()
}

export function setActiveThreadId(activeThreadId: string | null) {
  clientPresenceState = {
    ...clientPresenceState,
    activeThreadId: activeThreadId?.trim() || null,
  }
  syncWindowPresenceState()
}
