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

function isAdminAccessDeniedError(error: { code?: string | null; message?: string | null }) {
  const normalizedMessage = error.message?.toLowerCase() ?? ''

  return (
    error.code === '42501' ||
    normalizedMessage.includes('permission denied') ||
    normalizedMessage.includes('row-level security')
  )
}

export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
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
    })

    if (isAdminAccessDeniedError(profileError)) {
      forbidden()
    }

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
