import 'server-only'

import { forbidden, redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type ProfileRole = 'user' | 'coach' | 'admin'

type AdminProfile = {
  id: string
  role: ProfileRole
}

type RequireAdminResult = {
  user: User
  profile: AdminProfile
}

export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    console.error('[admin-auth] profile lookup failed', {
      userId: user.id,
      code: profileError.code ?? null,
      message: profileError.message,
      details: profileError.details ?? null,
    })

    throw profileError
  }

  if (!profile) {
    forbidden()
  }

  if (profile.role !== 'admin') {
    forbidden()
  }

  return {
    user,
    profile: {
      id: profile.id,
      role: profile.role,
    },
  }
}
