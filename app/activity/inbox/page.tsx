import { redirect } from 'next/navigation'
import ActivityInboxClient from '@/components/ActivityInboxClient'
import {
  loadInboxEventItems,
  markInboxEventsAsRead,
} from '@/lib/app-events'
import { getAuthenticatedUser } from '@/lib/supabase-server'

function markRenderedInboxItemsAsRead<T extends { isUnread: boolean }>(items: T[]): T[] {
  return items.map((item) => ({
    ...item,
    isUnread: false,
  }))
}

function getReadBoundaryFromRenderedItems<T extends { createdAt: string; isUnread: boolean }>(items: T[]) {
  return items.find((item) => item.isUnread)?.createdAt ?? null
}

export default async function ActivityInboxPage() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    redirect('/login')
  }

  let events = null as Awaited<ReturnType<typeof loadInboxEventItems>> | null
  let didMarkEventsAsRead = false
  let loadFailed = false

  try {
    events = await loadInboxEventItems(user.id)

    const readBoundary = getReadBoundaryFromRenderedItems(events)

    if (readBoundary) {
      try {
        const didAdvanceReadCursor = await markInboxEventsAsRead(user.id, readBoundary)

        if (didAdvanceReadCursor) {
          didMarkEventsAsRead = true
          events = markRenderedInboxItemsAsRead(events)
        }
      } catch (error) {
        console.error('Failed to mark inbox events as read', {
          userId: user.id,
          readBoundary,
          error: error instanceof Error ? error.message : 'unknown_error',
        })
      }
    }
  } catch {
    loadFailed = true
  }

  return (
    <ActivityInboxClient
      loadFailed={loadFailed}
      didMarkEventsAsRead={didMarkEventsAsRead}
      events={events}
    />
  )
}
