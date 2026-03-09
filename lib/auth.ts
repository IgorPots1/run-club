import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

const SESSION_BOOTSTRAP_TIMEOUT_MS = 2500

async function getSessionWithTimeout() {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<{ data: { session: null }; error: null }>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({
        data: { session: null },
        error: null,
      })
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
  try {
    const { data } = await getSessionWithTimeout()
    return data.session?.user ?? null
  } catch {
    return null
  }
}
