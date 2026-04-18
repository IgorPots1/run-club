import { redirect } from 'next/navigation'
import InnerPageHeader from '@/components/InnerPageHeader'
import ChallengesSection from '@/components/ChallengesSection'
import type { ChallengesOverview } from '@/lib/challenges'
import { loadChallengesOverviewServer } from '@/lib/dashboard-overview-server'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export default async function ChallengesPage() {
  const { user } = await getAuthenticatedUser()

  if (!user) {
    redirect('/login')
  }

  let overview: ChallengesOverview | undefined

  try {
    overview = await loadChallengesOverviewServer(user.id, { includeCompleted: false })
  } catch (loadError) {
    console.error('[challenges] failed to load server overview', loadError)
  }

  return (
    <main className="min-h-screen">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30">
        <div className="pointer-events-auto mx-auto max-w-xl px-4 md:px-4">
          <InnerPageHeader title="Челленджи" fallbackHref="/club" />
        </div>
      </div>
      <div className="pb-4 pt-4 md:p-4">
        <div className="mx-auto max-w-xl px-4 md:px-4">
          <div aria-hidden="true" className="invisible">
            <InnerPageHeader title="Челленджи" fallbackHref="/club" />
          </div>
        </div>
        <ChallengesSection showTitle={false} overview={overview} />
      </div>
    </main>
  )
}