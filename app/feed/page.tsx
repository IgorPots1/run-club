'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import RunLikeControl from '@/components/RunLikeControl'
import { loadFeedRuns, type FeedRunItem } from '@/lib/dashboard'
import { toggleRunLike } from '@/lib/run-likes'
import { supabase } from '../../lib/supabase'
import { getLevelFromXP } from '../../lib/xp'

function formatRunDate(date: string) {
  return new Date(date).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  })
}

function getInitials(label: string) {
  const trimmed = label.trim()
  return (trimmed[0] ?? '?').toUpperCase()
}

export default function FeedPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [pendingRunIds, setPendingRunIds] = useState<string[]>([])
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUserId(user?.id ?? null)
      setLoading(false)
    })
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
    } else {
      void mutate()
    }

    setPendingRunIds((prev) => prev.filter((id) => id !== runId))
  }

  if (loading) return <main className="min-h-screen p-4">Загрузка...</main>

  const error = actionError || (feedError ? 'Не удалось загрузить ленту' : '')

  return (
    <main className="min-h-screen">
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">Лента</h1>
        {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}
        <div className="max-w-md space-y-3 mb-4">
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
              <Link href="/runs" className="inline-block mt-4 px-4 py-2 rounded-lg border">
                Добавить тренировку
              </Link>
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {item.avatar_url ? (
                      <Image
                        src={item.avatar_url}
                        alt=""
                        width={40}
                        height={40}
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-600">
                        {getInitials(item.displayName)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-gray-900">{item.displayName}</p>
                      <p className="text-sm text-gray-500">Уровень {getLevelFromXP(item.totalXp).level}</p>
                    </div>
                  </div>
                  <p className="shrink-0 text-sm text-gray-500">{formatRunDate(item.created_at)}</p>
                </div>

                <div className="mt-4">
                  <p className="text-lg font-semibold text-gray-900">🏃 {item.title} - {item.distance_km} км</p>
                </div>

                <div className="mt-3">
                  <p className="text-sm font-semibold text-amber-600">⚡ +{item.xp} XP</p>
                </div>

                <div className="mt-4">
                  <RunLikeControl
                    likesCount={item.likesCount}
                    likedByMe={item.likedByMe}
                    pending={pendingRunIds.includes(item.id)}
                    onToggle={() => handleLikeToggle(item.id)}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  )
}
