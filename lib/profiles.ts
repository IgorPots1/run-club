import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

export async function ensureProfileExists(user: User) {
  const email = user.email?.trim() || null

  if (!user.id) {
    return
  }

  const { error } = await supabase.from('profiles').upsert(
    {
      id: user.id,
      email,
    },
    {
      onConflict: 'id',
      ignoreDuplicates: false,
    }
  )

  if (error) {
    throw error
  }
}
