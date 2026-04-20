import { redirect } from 'next/navigation'
import MessagesPageClient from './MessagesPageClient'
import { loadMessagesListFirstSectionServer } from '@/lib/chat/messagesListServer'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export default async function MessagesPage() {
  const { user } = await getAuthenticatedUser()

  if (!user) {
    redirect('/login')
  }

  const initialSeed = await loadMessagesListFirstSectionServer(user.id)

  return <MessagesPageClient initialSeed={initialSeed} />
}
