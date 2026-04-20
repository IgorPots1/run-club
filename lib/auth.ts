import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

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

export async function getBootstrapUser(): Promise<User | null> {
  ensureBootstrapUserListener()

  if (Date.now() < cachedBootstrapUserExpiresAt) {
    return cachedBootstrapUser
  }

  if (!bootstrapUserPromise) {
    bootstrapUserPromise = (async () => {
      try {
        const { data } = await supabase.auth.getSession()
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
        cachedBootstrapUserExpiresAt = Date.now() + BOOTSTRAP_USER_CACHE_TTL_MS
        return null
      } finally {
        bootstrapUserPromise = null
      }
    })()
  }

  return bootstrapUserPromise
}
