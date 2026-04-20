import { NextResponse } from 'next/server'
import { getFirstSessionState } from '@/lib/onboarding'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export async function GET() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        error: error?.message ?? 'auth_required',
      },
      { status: 401 }
    )
  }

  try {
    const { isFirstSession } = await getFirstSessionState(user.id)

    return NextResponse.json(
      { isFirstSession },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    )
  } catch (loadError) {
    console.error('[onboarding] failed to load first-session state', loadError)

    return NextResponse.json(
      {
        error: 'Не удалось проверить онбординг',
      },
      { status: 500 }
    )
  }
}
