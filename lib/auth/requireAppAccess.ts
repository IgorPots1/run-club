import 'server-only'

import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
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

function normalizeProfileValue(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function splitProfileName(name: string | null | undefined) {
  const normalizedName = normalizeProfileValue(name)

  if (!normalizedName) {
    return {
      firstName: null,
      lastName: null,
    }
  }

  const [firstName, ...rest] = normalizedName.split(/\s+/)
  const lastName = rest.join(' ').trim()

  return {
    firstName: firstName || null,
    lastName: lastName || null,
  }
}

function buildProfileFullName(firstName: string | null | undefined, lastName: string | null | undefined) {
  const normalizedFirstName = normalizeProfileValue(firstName)
  const normalizedLastName = normalizeProfileValue(lastName)

  if (!normalizedFirstName && !normalizedLastName) {
    return null
  }

  return [normalizedFirstName, normalizedLastName].filter(Boolean).join(' ')
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
    try {
      const adminSupabase = createSupabaseAdminClient()
      const metadata = user.user_metadata as {
        first_name?: string | null
        last_name?: string | null
        name?: string | null
        full_name?: string | null
      } | undefined
      const normalizedFirstName = normalizeProfileValue(metadata?.first_name)
      const normalizedLastName = normalizeProfileValue(metadata?.last_name)
      const fallbackNameParts =
        normalizedFirstName || normalizedLastName
          ? {
              firstName: normalizedFirstName,
              lastName: normalizedLastName,
            }
          : splitProfileName(metadata?.name?.trim() || metadata?.full_name?.trim() || null)
      const { error: upsertError } = await adminSupabase.from('profiles').upsert(
        {
          id: user.id,
          email: user.email?.trim() || null,
          first_name: fallbackNameParts.firstName,
          last_name: fallbackNameParts.lastName,
          name:
            buildProfileFullName(fallbackNameParts.firstName, fallbackNameParts.lastName) ||
            normalizeProfileValue(metadata?.name) ||
            normalizeProfileValue(metadata?.full_name),
        },
        {
          onConflict: 'id',
          ignoreDuplicates: false,
        }
      )

      if (upsertError) {
        redirect('/auth/error?reason=profile')
      }
    } catch {
      redirect('/auth/error?reason=profile')
    }

    const { data: recoveredProfile, error: recoveredProfileError } = await supabase
      .from('profiles')
      .select('id, app_access_status')
      .eq('id', user.id)
      .maybeSingle()

    if (recoveredProfileError) {
      throw recoveredProfileError
    }

    if (!recoveredProfile) {
      redirect('/auth/error?reason=profile')
    }

    if (recoveredProfile.app_access_status !== 'active') {
      redirect('/blocked')
    }

    return {
      user,
      profile: {
        id: recoveredProfile.id,
        app_access_status: recoveredProfile.app_access_status,
      },
    }
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
