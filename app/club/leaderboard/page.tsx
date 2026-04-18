'use client'

import ClubPersonalRecordsLeaderboard from '@/components/ClubPersonalRecordsLeaderboard'
import InnerPageHeader from '@/components/InnerPageHeader'

export default function ClubLeaderboardPage() {
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
        <ClubPersonalRecordsLeaderboard />
      </div>
    </main>
  )
}
