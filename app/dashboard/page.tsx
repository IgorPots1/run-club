import { redirect } from 'next/navigation'
import DashboardPageClient from './DashboardPageClient'
import { getInboxUnreadCount } from '@/lib/app-events'
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

  const [overview, initialInboxUnreadCount] = await Promise.all([
    loadDashboardOverviewServer(user.id),
    getInboxUnreadCount(user.id).catch((error) => {
      console.error('[dashboard] failed to load inbox unread count', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'unknown_error',
      })
      return 0
    }),
  ])
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
      initialActiveChallenges={overview.activeChallenges}
      initialAllChallengesCompleted={overview.allChallengesCompleted}
      initialInboxUnreadCount={initialInboxUnreadCount}
    />
  )
}
