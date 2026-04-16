import { redirect } from 'next/navigation'
import DashboardPageClient from './DashboardPageClient'
import { getInboxUnreadCount } from '@/lib/app-events'
import { loadDashboardOverviewServer } from '@/lib/dashboard-overview-server'
import { getFirstSessionState } from '@/lib/onboarding'
import { loadCurrentUserPersonalRecords } from '@/lib/personal-records'
import { getAuthenticatedUser } from '@/lib/supabase-server'
import { getLevelProgressFromXP } from '@/lib/xp'

export default async function DashboardPage() {
  const { user } = await getAuthenticatedUser()

  if (!user) {
    redirect('/login')
  }

  const userId = user.id

  const { isFirstSession } = await getFirstSessionState(userId)

  if (isFirstSession) {
    redirect('/onboarding')
  }

  const overview = await loadDashboardOverviewServer(userId, { includeChallenges: true })
  const [initialInboxUnreadCount, initialPersonalRecords] = await Promise.all([
    getInboxUnreadCount(userId),
    loadCurrentUserPersonalRecords(),
  ])
  const initialLevelProgress = getLevelProgressFromXP(overview.stats.totalXp)

  return (
    <DashboardPageClient
      initialUser={{
        id: userId,
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
      initialPersonalRecords={initialPersonalRecords}
    />
  )
}
