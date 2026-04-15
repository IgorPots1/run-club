import { getProfileDisplayName } from '@/lib/profiles'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import CoachLabClient from './CoachLabClient'
import type { CoachLabUserOption } from './types'

type ProfileRow = {
  id: string
  name: string | null
  app_access_status: 'active' | 'blocked' | null
}

function normalizeUserOptions(data: ProfileRow[] | null): CoachLabUserOption[] {
  return (data ?? []).flatMap((profile) => {
    if (typeof profile?.id !== 'string') {
      return []
    }

    return [
      {
        id: profile.id,
        label: getProfileDisplayName({ name: profile.name }, profile.id),
        appAccessStatus: profile.app_access_status === 'blocked' ? 'blocked' : 'active',
      },
    ]
  })
}

export default async function AdminCoachLabPage() {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, app_access_status')
    .order('name', { ascending: true })
    .limit(500)

  if (error) {
    throw error
  }

  return <CoachLabClient users={normalizeUserOptions((data as ProfileRow[] | null) ?? [])} />
}
