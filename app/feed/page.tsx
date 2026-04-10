'use client'

import { useEffect, useState } from 'react'
import { getBootstrapUser } from '@/lib/auth'
import InfiniteWorkoutFeed from '@/components/InfiniteWorkoutFeed'

export default function FeedPage() {
  const [hasResolvedUser, setHasResolvedUser] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadUser() {
      try {
        if (!isMounted) return

        const user = await getBootstrapUser()
        setCurrentUserId(user?.id ?? null)
      } finally {
        if (isMounted) {
          setHasResolvedUser(true)
        }
      }
    }

    void loadUser()

    return () => {
      isMounted = false
    }
  }, [])

  const emptyCtaHref = currentUserId ? '/runs' : '/login'
  const emptyCtaLabel = currentUserId ? 'Добавить тренировку' : 'Войти'

  return (
    <main className="min-h-screen pt-[env(safe-area-inset-top)] md:pt-0">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <h1 className="app-text-primary text-2xl font-bold mb-4">Лента</h1>
        <InfiniteWorkoutFeed
          currentUserId={currentUserId}
          enabled={hasResolvedUser}
          pageSize={10}
          scrollRestorationKey="main-feed"
          emptyTitle="Лента пока пуста."
          emptyDescription={currentUserId ? 'Добавьте первую тренировку или загляните позже.' : 'Войдите, чтобы видеть активность клуба.'}
          emptyCtaHref={emptyCtaHref}
          emptyCtaLabel={emptyCtaLabel}
          showLevelSubtitle
        />
      </div>
    </main>
  )
}
