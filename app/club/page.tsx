'use client'

import Link from 'next/link'
import { useState } from 'react'
import ChallengesSection from '@/components/ChallengesSection'
import LeaderboardSection from '@/components/LeaderboardSection'

type ClubTab = 'challenges' | 'leaderboard'

export default function ClubPage() {
  const [activeTab, setActiveTab] = useState<ClubTab>('challenges')

  return (
    <main className="min-h-screen pb-[calc(96px+env(safe-area-inset-bottom))] md:pb-0">
      <div className="mx-auto max-w-xl p-4 md:max-w-none">
        <h1 className="app-text-primary mb-4 text-2xl font-bold">Клуб</h1>

        <div className="app-surface-muted mb-4 grid grid-cols-3 rounded-xl p-1">
          <button
            type="button"
            onClick={() => setActiveTab('challenges')}
            className={`min-h-11 rounded-lg px-4 py-3 text-sm font-medium ${
              activeTab === 'challenges' ? 'app-card shadow-sm' : 'app-text-secondary'
            }`}
          >
            Челленджи
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('leaderboard')}
            className={`min-h-11 rounded-lg px-4 py-3 text-sm font-medium ${
              activeTab === 'leaderboard' ? 'app-card shadow-sm' : 'app-text-secondary'
            }`}
          >
            Рейтинг
          </button>
          <Link
            href="/messages"
            className="min-h-11 rounded-lg px-4 py-3 text-sm font-medium app-text-secondary"
          >
            Перейти в сообщения
          </Link>
        </div>
      </div>

      {activeTab === 'challenges' ? (
        <ChallengesSection showTitle={false} />
      ) : activeTab === 'leaderboard' ? (
        <LeaderboardSection showTitle={false} />
      ) : null}
    </main>
  )
}
