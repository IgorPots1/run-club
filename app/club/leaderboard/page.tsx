import ClubPersonalRecordsLeaderboard from '@/components/ClubPersonalRecordsLeaderboard'
import InnerPageHeader from '@/components/InnerPageHeader'
import { redirect } from 'next/navigation'
import type { ClubPersonalRecordLeaderboardRow } from '@/lib/club-personal-records'
import { loadClubPersonalRecordLeaderboard } from '@/lib/club-personal-records-server'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export default async function ClubLeaderboardPage() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    redirect('/login')
  }

  let initialRows: ClubPersonalRecordLeaderboardRow[] | undefined

  try {
    initialRows = await loadClubPersonalRecordLeaderboard(5000)
  } catch (loadError) {
    console.error('[club] failed to load initial personal record leaderboard', loadError)
  }

  return (
    <main className="min-h-screen">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30">
        <div className="pointer-events-auto mx-auto max-w-xl px-4 md:px-4">
          <InnerPageHeader title="Личные рекорды" fallbackHref="/club" />
        </div>
      </div>

      <div className="mx-auto max-w-xl px-4 pb-4 pt-3 md:p-4">
        <div aria-hidden="true" className="invisible">
          <InnerPageHeader title="Личные рекорды" fallbackHref="/club" />
        </div>
      </div>

      <div className="mx-auto max-w-xl px-4 pb-4 md:px-4">
        <ClubPersonalRecordsLeaderboard initialDistance={5000} initialRows={initialRows} />
      </div>
    </main>
  )
}
