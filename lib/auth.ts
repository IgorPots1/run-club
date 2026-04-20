import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

const SESSION_BOOTSTRAP_TIMEOUT_MS = 2500
const BOOTSTRAP_USER_CACHE_TTL_MS = 10000

let cachedBootstrapUser: User | null = null
let cachedBootstrapUserExpiresAt = 0
let bootstrapUserPromise: Promise<User | null> | null = null
let authListenerInitialized = false

function clearBootstrapUserCache() {
  cachedBootstrapUser = null
  cachedBootstrapUserExpiresAt = 0
  bootstrapUserPromise = null
}

function ensureBootstrapUserListener() {
  if (authListenerInitialized) {
    return
  }

  authListenerInitialized = true
  supabase.auth.onAuthStateChange(() => {
    clearBootstrapUserCache()
  })
}

async function getSessionWithTimeout() {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({ timedOut: true })
    }, SESSION_BOOTSTRAP_TIMEOUT_MS)
  })

  try {
    return await Promise.race([supabase.auth.getSession(), timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

export async function getBootstrapUser(): Promise<User | null> {
  ensureBootstrapUserListener()

  if (Date.now() < cachedBootstrapUserExpiresAt) {
    return cachedBootstrapUser
  }

  if (!bootstrapUserPromise) {
    bootstrapUserPromise = (async () => {
      try {
        const sessionResult = await getSessionWithTimeout()
        const { data } =
          'timedOut' in sessionResult ? await supabase.auth.getSession() : sessionResult
        const user = data.session?.user ?? null

        if (user) {
          cachedBootstrapUser = user
          cachedBootstrapUserExpiresAt = Date.now() + BOOTSTRAP_USER_CACHE_TTL_MS
        } else {
          cachedBootstrapUser = null
          cachedBootstrapUserExpiresAt = 0
        }

        return user
      } catch {
        cachedBootstrapUser = null
        cachedBootstrapUserExpiresAt = 0
        return null
      } finally {
        bootstrapUserPromise = null
      }
    })()
  }

  return bootstrapUserPromise
}
