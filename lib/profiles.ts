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

  return nickname || name || email || fallback
}

function isMissingNicknameColumnError(error: { code?: string | null; message?: string | null }) {
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    Boolean(error.message?.includes('profiles.nickname')) ||
    Boolean(error.message?.includes("'nickname' column of 'profiles'"))
  )
}

function normalizeProfileValue(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function getAuthMetadataProfileFields(user: User) {
  const metadata = (user.user_metadata ?? {}) as {
    name?: string | null
    full_name?: string | null
    nickname?: string | null
    avatar_url?: string | null
    picture?: string | null
  }

  return {
    name: normalizeProfileValue(metadata.name ?? metadata.full_name ?? null),
    nickname: normalizeProfileValue(metadata.nickname),
    avatar_url: normalizeProfileValue(metadata.avatar_url ?? metadata.picture ?? null),
  }
}

export async function upsertProfile(input: {
  id: string
  email?: string | null
  name?: string | null
  nickname?: string | null
  avatar_url?: string | null
}) {
  const payload = {
    id: input.id,
    email: normalizeProfileValue(input.email),
    name: normalizeProfileValue(input.name),
    nickname: normalizeProfileValue(input.nickname),
    avatar_url: input.avatar_url ?? null,
  }

  const result = await supabase.from('profiles').upsert(payload, {
    onConflict: 'id',
    ignoreDuplicates: false,
  })

  if (!result.error || !isMissingNicknameColumnError(result.error)) {
    return result
  }

  return supabase.from('profiles').upsert(
    {
      id: payload.id,
      email: payload.email,
      name: payload.name,
      avatar_url: payload.avatar_url,
    },
    {
      onConflict: 'id',
      ignoreDuplicates: false,
    }
  )
}

export async function ensureProfileExists(user: User) {
  const email = normalizeProfileValue(user.email)
  const metadataProfile = getAuthMetadataProfileFields(user)

  if (!user.id) {
    return
  }

  const { error } = await upsertProfile({
    id: user.id,
    email,
    name: metadataProfile.name,
    nickname: metadataProfile.nickname,
    avatar_url: metadataProfile.avatar_url,
  })

  if (error) {
    throw error
  }
}
