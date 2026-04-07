import { redirect } from 'next/navigation'
import InnerPageHeader from '@/components/InnerPageHeader'
import RacesManager from '@/components/RacesManager'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export default async function RacesPage() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    redirect('/login')
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <InnerPageHeader title="Старты" fallbackHref="/activity" />
        <div className="mt-4">
          <RacesManager userId={user.id} />
        </div>
      </div>
    </main>
  )
}
