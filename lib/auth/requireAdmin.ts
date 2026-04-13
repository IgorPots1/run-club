import 'server-only'

import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type ProfileRole = 'user' | 'coach' | 'admin'

type AdminProfile = {
  id: string
  app_access_status: 'active' | 'blocked'
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
    .select('id, role, app_access_status')
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
    redirect('/dashboard')
  }

  if (profile.app_access_status !== 'active') {
    redirect('/blocked')
  }

  if (profile.role !== 'admin') {
    redirect('/dashboard')
  }

  return {
    user,
    profile: {
      id: profile.id,
      app_access_status: profile.app_access_status,
      role: profile.role,
    },
  }
}
