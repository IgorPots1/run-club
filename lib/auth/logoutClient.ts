'use client'

import { unsubscribeFromPush, isPushSupportedInCurrentContext } from '@/lib/push/subscribeToPush'
import { supabase } from '@/lib/supabase'
import { stopVoiceStream } from '@/lib/voice/voiceStream'

type LogoutRouterLike = {
  replace: (href: string, options?: { scroll?: boolean }) => void
}

type LogoutCurrentUserOptions = {
  router?: LogoutRouterLike
  redirectTo?: string
  onSignedOut?: () => void
}

const LOGOUT_PUSH_UNSUBSCRIBE_TIMEOUT_MS = 1500

let logoutInFlightPromise: Promise<void> | null = null

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function runBestEffortPushCleanup() {
  if (!isPushSupportedInCurrentContext()) {
    return
  }

  await Promise.race([
    unsubscribeFromPush().catch((error) => {
      console.warn('[auth] push unsubscribe failed during logout', {
        error: error instanceof Error ? error.message : 'unknown_error',
      })
    }),
    sleep(LOGOUT_PUSH_UNSUBSCRIBE_TIMEOUT_MS),
  ])
}

export async function logoutCurrentUser(options: LogoutCurrentUserOptions = {}) {
  if (logoutInFlightPromise) {
    return logoutInFlightPromise
  }

  logoutInFlightPromise = (async () => {
    stopVoiceStream()
    await runBestEffortPushCleanup()

    const { error } = await supabase.auth.signOut()

    if (error) {
      throw error
    }

    options.onSignedOut?.()
    options.router?.replace(options.redirectTo ?? '/login')
  })()

  try {
    await logoutInFlightPromise
  } finally {
    if (logoutInFlightPromise) {
      logoutInFlightPromise = null
    }
  }
}
