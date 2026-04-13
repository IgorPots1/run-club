import { redirect } from 'next/navigation'
import ActivityInboxClient from '@/components/ActivityInboxClient'
import {
  loadInboxEventItems,
  markInboxEventsAsRead,
} from '@/lib/app-events'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export default async function ActivityInboxPage() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    redirect('/login')
  }

  let events = null as Awaited<ReturnType<typeof loadInboxEventItems>> | null
  let loadFailed = false

  try {
    events = await loadInboxEventItems(user.id)

    const readBoundary = events.at(-1)?.readBoundaryAt ?? null

    if (readBoundary) {
      // Do not block inbox rendering if the read cursor update fails.
      await markInboxEventsAsRead(user.id, readBoundary).catch((error) => {
        console.error('Failed to mark inbox events as read', {
          userId: user.id,
          readBoundary,
          error: error instanceof Error ? error.message : 'unknown_error',
        })
      })
    }
  } catch {
    loadFailed = true
  }

  return <ActivityInboxClient loadFailed={loadFailed} events={events} />
}
