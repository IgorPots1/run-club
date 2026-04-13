import { NextResponse } from 'next/server'
import { getInboxUnreadCount } from '@/lib/app-events'
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
    const count = await getInboxUnreadCount(user.id)

    return NextResponse.json({ count })
  } catch (loadError) {
    console.error('[activity inbox] failed to load unread count', loadError)

    return NextResponse.json(
      {
        error: 'Не удалось загрузить непрочитанные уведомления',
      },
      { status: 500 }
    )
  }
}
