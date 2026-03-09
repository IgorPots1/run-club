import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

const SESSION_BOOTSTRAP_TIMEOUT_MS = 2500

async function getSessionWithTimeout() {
  const timeoutPromise = new Promise<{ data: { session: null }; error: null }>((resolve) => {
    setTimeout(() => {
      resolve({
        data: { session: null },
        error: null,
      })
    }, SESSION_BOOTSTRAP_TIMEOUT_MS)
  })

  return Promise.race([supabase.auth.getSession(), timeoutPromise])
}

export async function getBootstrapUser(): Promise<User | null> {
  try {
    const { data } = await getSessionWithTimeout()
    return data.session?.user ?? null
  } catch {
    return null
  }
}
