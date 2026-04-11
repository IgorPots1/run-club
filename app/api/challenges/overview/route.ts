import { NextResponse } from 'next/server'
import { loadChallengesOverviewServer } from '@/lib/dashboard-overview-server'
import { getAuthenticatedUser } from '@/lib/supabase-server'

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

  try {
    const { searchParams } = new URL(request.url)
    const includeCompleted = searchParams.get('includeCompleted') !== 'false'
    const overview = await loadChallengesOverviewServer(user.id, { includeCompleted })

    return NextResponse.json(overview)
  } catch (loadError) {
    console.error('[challenges] failed to load overview', loadError)

    return NextResponse.json(
      {
        error: 'Не удалось загрузить челленджи',
      },
      { status: 500 }
    )
  }
}
