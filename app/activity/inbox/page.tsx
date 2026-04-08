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
    ;[events] = await Promise.all([
      loadInboxEventItems(user.id),
      // Do not block inbox rendering if the read cursor update fails.
      markInboxEventsAsRead(user.id).catch((error) => {
        console.error('Failed to mark inbox events as read', {
          userId: user.id,
          error: error instanceof Error ? error.message : 'unknown_error',
        })
      }),
    ])
  } catch {
    loadFailed = true
  }

  return <ActivityInboxClient loadFailed={loadFailed} events={events} />
}
