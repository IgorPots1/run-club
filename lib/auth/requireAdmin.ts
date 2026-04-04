import 'server-only'

import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type ProfileRole = 'user' | 'coach' | 'admin'

type AdminProfile = {
  id: string
  role: ProfileRole | null
}

type RequireAdminResult = {
  user: User
  profile: AdminProfile | null
}

export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  console.log('[admin-auth] getUser result', {
    hasUser: Boolean(user),
    userId: user?.id ?? null,
    userError: userError?.message ?? null,
  })

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle()

  console.log('[admin-auth] profile result', {
    userId: user.id,
    profile: profile ?? null,
    profileError: profileError
      ? {
          code: profileError.code ?? null,
          message: profileError.message,
          details: profileError.details ?? null,
        }
      : null,
  })

  return {
    user,
    profile: profile
      ? {
          id: profile.id,
          role: profile.role,
        }
      : null,
  }
}
