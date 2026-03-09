'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { getBootstrapUser } from '@/lib/auth'
import WorkoutFeedCard from '@/components/WorkoutFeedCard'
import { loadFeedRuns, type FeedRunItem } from '@/lib/dashboard'
import { ensureProfileExists } from '@/lib/profiles'
import { toggleRunLike } from '@/lib/run-likes'
import { supabase } from '../../lib/supabase'
import { getLevelFromXP } from '../../lib/xp'

export default function FeedPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [pendingRunIds, setPendingRunIds] = useState<string[]>([])
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadUser() {
      try {
        if (!isMounted) return

        const user = await getBootstrapUser()
        setCurrentUserId(user?.id ?? null)

        if (user) {
          void ensureProfileExists(user)
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    void loadUser()

    return () => {
      isMounted = false
    }
  }, [])

  const feedKey = currentUserId !== null ? (['feed-runs', currentUserId] as const) : loading ? null : (['feed-runs', null] as const)

  const {
    data: items,
    error: feedError,
    isLoading: feedLoading,
    mutate,
  } = useSWR(feedKey, ([, userId]: readonly [string, string | null]) => loadFeedRuns(userId), {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshInterval: 30000,
  })

  async function handleLikeToggle(runId: string) {
    if (!currentUserId) {
      router.push('/login')
      return
    }

    if (pendingRunIds.includes(runId)) return

    const currentItem = items?.find((item) => item.id === runId)
    if (!currentItem) return

    const wasLiked = currentItem.likedByMe

    setActionError('')
    setPendingRunIds((prev) => [...prev, runId])

    try {
      await mutate(
        (currentItems: FeedRunItem[] = []) =>
          currentItems.map((item) =>
            item.id === runId
              ? {
                  ...item,
                  likedByMe: !wasLiked,
                  likesCount: Math.max(0, item.likesCount + (wasLiked ? -1 : 1)),
                }
              : item
          ),
        false
      )

      const { error: likeError } = await toggleRunLike(runId, currentUserId, wasLiked)

      if (likeError) {
        setActionError('Не удалось обновить лайк')
        await mutate()
        return
      }

      void mutate()
    } catch {
      setActionError('Не удалось обновить лайк')
      await mutate()
    } finally {
      setPendingRunIds((prev) => prev.filter((id) => id !== runId))
    }
  }

  if (loading) return <main className="min-h-screen p-4">Загрузка...</main>

  const error = actionError || (feedError ? 'Не удалось загрузить ленту' : '')
  const emptyCtaHref = currentUserId ? '/runs' : '/login'
  const emptyCtaLabel = currentUserId ? 'Добавить тренировку' : 'Войти'

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-xl p-4">
        <h1 className="text-2xl font-bold mb-4">Лента</h1>
        {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}
        <div className="space-y-3 pb-2">
          {feedLoading && !items ? (
            <>
              <div className="rounded-xl border bg-white p-4 shadow-sm">
                <div className="skeleton-line h-5 w-32" />
                <div className="mt-2 skeleton-line h-4 w-36" />
                <div className="mt-3 space-y-2">
                  <div className="skeleton-line h-4 w-20" />
                  <div className="skeleton-line h-4 w-16" />
                  <div className="skeleton-line h-4 w-24" />
                </div>
              </div>
              <div className="rounded-xl border bg-white p-4 shadow-sm">
                <div className="skeleton-line h-5 w-28" />
                <div className="mt-2 skeleton-line h-4 w-40" />
                <div className="mt-3 space-y-2">
                  <div className="skeleton-line h-4 w-24" />
                  <div className="skeleton-line h-4 w-16" />
                  <div className="skeleton-line h-4 w-20" />
                </div>
              </div>
            </>
          ) : !items || items.length === 0 ? (
            <div className="mt-10 text-center text-gray-500">
              <p>Пока нет тренировок</p>
              <Link href={emptyCtaHref} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2">
                {emptyCtaLabel}
              </Link>
            </div>
          ) : (
            items.map((item) => (
              <WorkoutFeedCard
                key={item.id}
                rawTitle={item.title}
                xp={item.xp}
                createdAt={item.created_at}
                displayName={item.displayName}
                avatarUrl={item.avatar_url}
                subtitle={`Уровень ${getLevelFromXP(item.totalXp).level}`}
                likesCount={item.likesCount}
                likedByMe={item.likedByMe}
                pending={pendingRunIds.includes(item.id)}
                onToggleLike={() => handleLikeToggle(item.id)}
              />
            ))
          )}
        </div>
      </div>
    </main>
  )
}
