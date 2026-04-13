import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

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

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=auth_callback', url.origin))
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        }
      }
    }
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(new URL('/login?error=auth_callback', url.origin))
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const metadata = user.user_metadata as {
      first_name?: string | null
      last_name?: string | null
      name?: string | null
      full_name?: string | null
      nickname?: string | null
      avatar_url?: string | null
      picture?: string | null
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
    const payload = {
      id: user.id,
      email: user.email?.trim() || null,
      first_name: fallbackNameParts.firstName,
      last_name: fallbackNameParts.lastName,
      name:
        buildProfileFullName(fallbackNameParts.firstName, fallbackNameParts.lastName) ||
        normalizeProfileValue(metadata?.name) ||
        normalizeProfileValue(metadata?.full_name),
      nickname: metadata?.nickname?.trim() || null,
      avatar_url: metadata?.avatar_url?.trim() || metadata?.picture?.trim() || null,
    }

    const result = await supabase.from('profiles').upsert(payload, {
      onConflict: 'id',
      ignoreDuplicates: false,
    })

    let profileError = result.error

    if (
      profileError &&
      (isMissingNicknameColumnError(profileError) ||
        isMissingProfileColumnError(profileError, 'first_name') ||
        isMissingProfileColumnError(profileError, 'last_name'))
    ) {
      const fallbackPayload = {
        id: payload.id,
        email: payload.email,
        name: payload.name,
        avatar_url: payload.avatar_url,
        ...(isMissingNicknameColumnError(profileError) ? {} : { nickname: payload.nickname }),
      }
      const fallbackResult = await supabase.from('profiles').upsert(fallbackPayload, {
        onConflict: 'id',
        ignoreDuplicates: false,
      })

      profileError = fallbackResult.error
    }

    if (profileError) {
      return NextResponse.redirect(new URL('/auth/error?reason=profile', url.origin))
    }
  }

  return NextResponse.redirect(new URL('/auth/continue', url.origin))
}
