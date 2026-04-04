import 'server-only'

import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type AppAccessStatus = 'active' | 'blocked'

type AppAccessProfile = {
  id: string
  app_access_status: AppAccessStatus
}

type RequireAppAccessResult = {
  user: User
  profile: AppAccessProfile
}

export async function requireAppAccess(): Promise<RequireAppAccessResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, app_access_status')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    throw profileError
  }

  if (!profile) {
    redirect('/login')
  }

  if (profile.app_access_status !== 'active') {
    redirect('/blocked')
  }

  return {
    user,
    profile: {
      id: profile.id,
      app_access_status: profile.app_access_status,
    },
  }
}
