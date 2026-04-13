import { supabase } from './supabase'

export type ProfileIdentity = {
  first_name?: string | null
  last_name?: string | null
  name?: string | null
  nickname?: string | null
  email?: string | null
}

export function normalizeProfileValue(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export function splitProfileName(name: string | null | undefined) {
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

export function buildProfileFullName(firstName: string | null | undefined, lastName: string | null | undefined) {
  const normalizedFirstName = normalizeProfileValue(firstName)
  const normalizedLastName = normalizeProfileValue(lastName)

  if (!normalizedFirstName && !normalizedLastName) {
    return null
  }

  return [normalizedFirstName, normalizedLastName].filter(Boolean).join(' ')
}

export function getProfileDisplayName(profile: ProfileIdentity | null | undefined, fallback = 'Бегун') {
  const name = buildProfileFullName(profile?.first_name, profile?.last_name) ?? normalizeProfileValue(profile?.name)
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

function isMissingProfileColumnError(
  error: { code?: string | null; message?: string | null },
  columnName: 'nickname' | 'first_name' | 'last_name'
) {
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    Boolean(error.message?.includes(`profiles.${columnName}`)) ||
    Boolean(error.message?.includes(`'${columnName}' column of 'profiles'`))
  )
}

function stripUnsupportedProfileColumns(
  payload: {
    id: string
    email: string | null
    first_name: string | null
    last_name: string | null
    name: string | null
    nickname: string | null
    avatar_url: string | null
  },
  error: { code?: string | null; message?: string | null }
) {
  const fallbackPayload = { ...payload }

  if (isMissingProfileColumnError(error, 'nickname')) {
    delete (fallbackPayload as { nickname?: string | null }).nickname
  }

  if (isMissingProfileColumnError(error, 'first_name')) {
    delete (fallbackPayload as { first_name?: string | null }).first_name
    delete (fallbackPayload as { last_name?: string | null }).last_name
  }

  if (isMissingProfileColumnError(error, 'last_name')) {
    delete (fallbackPayload as { first_name?: string | null }).first_name
    delete (fallbackPayload as { last_name?: string | null }).last_name
  }

  return fallbackPayload
}

export async function upsertProfile(input: {
  id: string
  email?: string | null
  first_name?: string | null
  last_name?: string | null
  name?: string | null
  nickname?: string | null
  avatar_url?: string | null
}) {
  const normalizedFirstName = normalizeProfileValue(input.first_name)
  const normalizedLastName = normalizeProfileValue(input.last_name)
  const derivedNameParts =
    normalizedFirstName || normalizedLastName
      ? {
          firstName: normalizedFirstName,
          lastName: normalizedLastName,
        }
      : splitProfileName(input.name)
  const fullName = buildProfileFullName(derivedNameParts.firstName, derivedNameParts.lastName) ?? normalizeProfileValue(input.name)
  const payload = {
    id: input.id,
    email: normalizeProfileValue(input.email),
    first_name: derivedNameParts.firstName,
    last_name: derivedNameParts.lastName,
    name: fullName,
    nickname: normalizeProfileValue(input.nickname),
    avatar_url: input.avatar_url ?? null,
  }

  const result = await supabase.from('profiles').upsert(payload, {
    onConflict: 'id',
    ignoreDuplicates: false,
  })

  if (!result.error) {
    return result
  }

  const fallbackPayload = stripUnsupportedProfileColumns(payload, result.error)

  if (Object.keys(fallbackPayload).length === Object.keys(payload).length && !isMissingNicknameColumnError(result.error)) {
    return result
  }

  return supabase.from('profiles').upsert(fallbackPayload, {
    onConflict: 'id',
    ignoreDuplicates: false,
  })
}

export async function updateProfileById(input: {
  id: string
  first_name?: string | null
  last_name?: string | null
  name?: string | null
  nickname?: string | null
  avatar_url?: string | null
}) {
  const { error } = await upsertProfile({
    id: input.id,
    first_name: input.first_name,
    last_name: input.last_name,
    name: input.name,
    nickname: input.nickname,
    avatar_url: input.avatar_url,
  })

  if (error) {
    return {
      data: null,
      error,
    }
  }

  return supabase
    .from('profiles')
    .select('id')
    .eq('id', input.id)
    .maybeSingle()
}
