import { redirect } from 'next/navigation'
import DashboardPageClient from './DashboardPageClient'
import { loadDashboardOverviewServer } from '@/lib/dashboard-overview-server'
import { getFirstSessionState } from '@/lib/onboarding'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { getLevelProgressFromXP } from '@/lib/xp'

export default async function DashboardPage() {
  const { user } = await getAuthenticatedUser()

  if (!user) {
    redirect('/login')
  }

  const { isFirstSession } = await getFirstSessionState(user.id)

  if (isFirstSession) {
    redirect('/onboarding')
  }

  const overview = await loadDashboardOverviewServer(user.id)
  const initialLevelProgress = getLevelProgressFromXP(overview.stats.totalXp)

  return (
    <DashboardPageClient
      initialUser={{
        id: user.id,
        email: user.email ?? null,
      }}
      initialProfileSummary={{
        name: overview.profileSummary.name,
        nickname: overview.profileSummary.nickname,
        email: overview.profileSummary.email ?? user.email ?? null,
      }}
      initialStats={overview.stats}
      initialLevelProgress={initialLevelProgress}
      initialActiveChallenge={overview.activeChallenge}
      initialAllChallengesCompleted={overview.allChallengesCompleted}
    />
  )
}
