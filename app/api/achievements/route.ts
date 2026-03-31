import { NextResponse } from 'next/server'
import { loadUserAchievements } from '@/lib/achievements'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export async function GET() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? 'auth_required',
      },
      { status: 401 }
    )
  }

  try {
    const achievements = await loadUserAchievements(user.id)

    return NextResponse.json({
      ok: true,
      achievements,
    })
  } catch (loadError) {
    return NextResponse.json(
      {
        ok: false,
        error: loadError instanceof Error ? loadError.message : 'achievements_load_failed',
      },
      { status: 500 }
    )
  }
}
