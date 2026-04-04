import 'server-only'

import { redirect } from 'next/navigation'
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

type ForbiddenError = Error & {
  code: 'FORBIDDEN'
  status: 403
}

function createForbiddenError() {
  const error = new Error('Forbidden') as ForbiddenError
  error.code = 'FORBIDDEN'
  error.status = 403
  return error
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
    throw profileError
  }

  if (!profile || profile.role !== 'admin') {
    throw createForbiddenError()
  }

  return {
    user,
    profile: {
      id: profile.id,
      role: profile.role,
    },
  }
}
