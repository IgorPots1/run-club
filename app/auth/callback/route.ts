import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

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
    const metadata = user.user_metadata as { name?: string | null; nickname?: string | null } | undefined

    await supabase.from('profiles').upsert(
      {
        id: user.id,
        email: user.email?.trim() || null,
        name: metadata?.name?.trim() || null,
        nickname: metadata?.nickname?.trim() || null,
      },
      {
        onConflict: 'id',
        ignoreDuplicates: false,
      }
    )
  }

  return NextResponse.redirect(new URL('/login', url.origin))
}
