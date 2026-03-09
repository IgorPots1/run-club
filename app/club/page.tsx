'use client'

import { useState } from 'react'
import ChallengesSection from '@/components/ChallengesSection'
import LeaderboardSection from '@/components/LeaderboardSection'

type ClubTab = 'challenges' | 'leaderboard'

export default function ClubPage() {
  const [activeTab, setActiveTab] = useState<ClubTab>('challenges')

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-xl p-4 md:max-w-none">
        <h1 className="mb-4 text-2xl font-bold">Клуб</h1>

        <div className="mb-4 grid grid-cols-2 rounded-xl bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('challenges')}
            className={`min-h-11 rounded-lg px-4 py-3 text-sm font-medium ${
              activeTab === 'challenges' ? 'bg-white shadow-sm' : 'text-gray-600'
            }`}
          >
            Челленджи
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('leaderboard')}
            className={`min-h-11 rounded-lg px-4 py-3 text-sm font-medium ${
              activeTab === 'leaderboard' ? 'bg-white shadow-sm' : 'text-gray-600'
            }`}
          >
            Рейтинг
          </button>
        </div>
      </div>

      {activeTab === 'challenges' ? <ChallengesSection showTitle={false} /> : <LeaderboardSection showTitle={false} />}
    </main>
  )
}
