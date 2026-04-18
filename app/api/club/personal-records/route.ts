import { NextResponse } from 'next/server'
import {
  isClubPersonalRecordDistance,
  type ClubPersonalRecordDistance,
} from '@/lib/club-personal-records'
import { loadClubPersonalRecordLeaderboard } from '@/lib/club-personal-records-server'
import { getAuthenticatedUser } from '@/lib/supabase-server'

function parseDistance(value: string | null): ClubPersonalRecordDistance | null {
  if (!isClubPersonalRecordDistance(value)) {
    return null
  }

  return Number(value) as ClubPersonalRecordDistance
}

export async function GET(request: Request) {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    return NextResponse.json(
      {
        error: error?.message ?? 'auth_required',
      },
      { status: 401 }
    )
  }

  const { searchParams } = new URL(request.url)
  const distance = parseDistance(searchParams.get('distance'))

  if (!distance) {
    return NextResponse.json(
      {
        error: 'invalid_distance',
      },
      { status: 400 }
    )
  }

  try {
    return NextResponse.json({
      rows: await loadClubPersonalRecordLeaderboard(distance),
    })
  } catch (loadError) {
    console.error('[club] failed to load personal record leaderboard', loadError)

    return NextResponse.json(
      {
        error: 'Не удалось загрузить рейтинг личных рекордов',
      },
      { status: 500 }
    )
  }
}
