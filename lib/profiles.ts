import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type ProfileIdentity = {
  name?: string | null
  nickname?: string | null
  email?: string | null
}

export function getProfileDisplayName(profile: ProfileIdentity | null | undefined, fallback = 'Бегун') {
  const name = profile?.name?.trim()
  const nickname = profile?.nickname?.trim()
  const email = profile?.email?.trim()

  return name || nickname || email || fallback
}

function normalizeProfileValue(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export async function upsertProfile(input: {
  id: string
  email?: string | null
  name?: string | null
  nickname?: string | null
  avatar_url?: string | null
}) {
  return supabase.from('profiles').upsert(
    {
      id: input.id,
      email: normalizeProfileValue(input.email),
      name: normalizeProfileValue(input.name),
      nickname: normalizeProfileValue(input.nickname),
      avatar_url: input.avatar_url ?? null,
    },
    {
      onConflict: 'id',
      ignoreDuplicates: false,
    }
  )
}

export async function ensureProfileExists(user: User) {
  const email = normalizeProfileValue(user.email)
  const metadata = user.user_metadata as { name?: string | null; nickname?: string | null } | undefined

  if (!user.id) {
    return
  }

  const { error } = await upsertProfile({
    id: user.id,
    email,
    name: metadata?.name ?? null,
    nickname: metadata?.nickname ?? null,
  })

  if (error) {
    throw error
  }
}
