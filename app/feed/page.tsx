'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBootstrapUser } from '@/lib/auth'
import WorkoutFeedCard from '@/components/WorkoutFeedCard'
import { loadFeedRuns, type FeedRunItem } from '@/lib/dashboard'
import { ensureProfileExists } from '@/lib/profiles'
import { toggleRunLike } from '@/lib/run-likes'
import { getLevelFromXP } from '../../lib/xp'

const FEED_PAGE_SIZE = 10
const PULL_TO_REFRESH_THRESHOLD = 56
const MAX_PULL_DISTANCE = 72

function mergeUniqueFeedItems(existing: FeedRunItem[], incoming: FeedRunItem[]) {
  const existingIds = new Set(existing.map((item) => item.id))
  return [...existing, ...incoming.filter((item) => !existingIds.has(item.id))]
}

export default function FeedPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [items, setItems] = useState<FeedRunItem[]>([])
  const [pendingRunIds, setPendingRunIds] = useState<string[]>([])
  const [actionError, setActionError] = useState('')
  const [feedError, setFeedError] = useState('')
  const [initialLoading, setInitialLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [nextOffset, setNextOffset] = useState(0)
  const [pullDistance, setPullDistance] = useState(0)
  const [readyToRefresh, setReadyToRefresh] = useState(false)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const pullStartYRef = useRef<number | null>(null)
  const isPullingRef = useRef(false)
  const readyToRefreshRef = useRef(false)

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

  const loadFirstPage = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'refresh') {
        setRefreshing(true)
      } else {
        setInitialLoading(true)
      }

      setFeedError('')

      try {
        const page = await loadFeedRuns(currentUserId, 0, FEED_PAGE_SIZE)
        setItems(page.items)
        setHasMore(page.hasMore)
        setNextOffset(page.items.length)
      } catch {
        setFeedError('Не удалось загрузить ленту')

        if (mode === 'initial') {
          setItems([])
          setHasMore(false)
          setNextOffset(0)
        }
      } finally {
        setInitialLoading(false)
        setRefreshing(false)
      }
    },
    [currentUserId]
  )

  const loadMoreRuns = useCallback(async () => {
    if (loading || initialLoading || loadingMore || refreshing || !hasMore) return

    setLoadingMore(true)
    setFeedError('')

    try {
      const page = await loadFeedRuns(currentUserId, nextOffset, FEED_PAGE_SIZE)
      setItems((prev) => mergeUniqueFeedItems(prev, page.items))
      setHasMore(page.hasMore)
      setNextOffset((prev) => prev + page.items.length)
    } catch {
      setFeedError('Не удалось загрузить ленту')
    } finally {
      setLoadingMore(false)
    }
  }, [currentUserId, hasMore, initialLoading, loading, loadingMore, nextOffset, refreshing])

  useEffect(() => {
    if (loading) return

    setItems([])
    setHasMore(true)
    setNextOffset(0)
    setActionError('')
    void loadFirstPage('initial')
  }, [loading, currentUserId, loadFirstPage])

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || loading || initialLoading || loadingMore || refreshing || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMoreRuns()
        }
      },
      {
        root: null,
        rootMargin: '320px 0px',
        threshold: 0.01,
      }
    )

    observer.observe(target)

    return () => {
      observer.disconnect()
    }
  }, [hasMore, initialLoading, loadMoreRuns, loading, loadingMore, refreshing, items.length])

  function getScrollTop() {
    return window.scrollY || document.documentElement.scrollTop || 0
  }

  const resetPullState = useCallback(() => {
    pullStartYRef.current = null
    isPullingRef.current = false
    readyToRefreshRef.current = false
    setReadyToRefresh(false)
    setPullDistance(0)
  }, [])

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1 || refreshing || initialLoading || getScrollTop() > 0) {
      resetPullState()
      return
    }

    pullStartYRef.current = event.touches[0].clientY
    isPullingRef.current = true
  }, [initialLoading, refreshing, resetPullState])

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLElement>) => {
    if (!isPullingRef.current || pullStartYRef.current === null) return
    if (event.touches.length !== 1 || getScrollTop() > 0) {
      resetPullState()
      return
    }

    const deltaY = event.touches[0].clientY - pullStartYRef.current

    if (deltaY <= 0) {
      readyToRefreshRef.current = false
      setReadyToRefresh(false)
      setPullDistance(0)
      return
    }

    const nextPullDistance = Math.min(deltaY * 0.45, MAX_PULL_DISTANCE)
    const shouldRefresh = nextPullDistance >= PULL_TO_REFRESH_THRESHOLD

    readyToRefreshRef.current = shouldRefresh
    setReadyToRefresh(shouldRefresh)
    setPullDistance(nextPullDistance)
  }, [resetPullState])

  const handleTouchEnd = useCallback(() => {
    const shouldRefresh = readyToRefreshRef.current
    resetPullState()

    if (shouldRefresh && !refreshing && !initialLoading) {
      void loadFirstPage('refresh')
    }
  }, [initialLoading, loadFirstPage, refreshing, resetPullState])

  async function handleLikeToggle(runId: string) {
    if (!currentUserId) {
      router.replace('/login')
      return
    }

    if (pendingRunIds.includes(runId)) return

    const currentItem = items.find((item) => item.id === runId)
    if (!currentItem) return

    const wasLiked = currentItem.likedByMe
    const previousItems = items

    setActionError('')
    setPendingRunIds((prev) => [...prev, runId])

    try {
      setItems((currentItems) =>
        currentItems.map((item) =>
          item.id === runId
            ? {
                ...item,
                likedByMe: !wasLiked,
                likesCount: Math.max(0, item.likesCount + (wasLiked ? -1 : 1)),
              }
            : item
        )
      )

      const { error: likeError } = await toggleRunLike(runId, currentUserId, wasLiked)

      if (likeError) {
        setActionError('Не удалось обновить лайк')
        setItems(previousItems)
        return
      }
    } catch {
      setActionError('Не удалось обновить лайк')
      setItems(previousItems)
    } finally {
      setPendingRunIds((prev) => prev.filter((id) => id !== runId))
    }
  }

  if (loading) return <main className="min-h-screen p-4">Загрузка...</main>

  const error = actionError || feedError
  const emptyCtaHref = currentUserId ? '/runs' : '/login'
  const emptyCtaLabel = currentUserId ? 'Добавить тренировку' : 'Войти'
  const pullIndicatorLabel = refreshing
    ? 'Обновляем...'
    : readyToRefresh
      ? 'Отпусти, чтобы обновить'
      : pullDistance > 0
        ? 'Потяни, чтобы обновить'
        : ''

  return (
    <main
      className="relative min-h-screen"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={resetPullState}
    >
      <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center px-4">
        <div
          className={`app-text-secondary rounded-full bg-black/5 px-3 py-1 text-xs transition-all dark:bg-white/5 ${
            refreshing || pullDistance > 0 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {pullIndicatorLabel}
        </div>
      </div>
      <div
        className="mx-auto max-w-xl p-4"
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
          transition: pullDistance === 0 ? 'transform 180ms ease' : 'none',
        }}
      >
        <h1 className="app-text-primary text-2xl font-bold mb-4">Лента</h1>
        {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}
        <div className="space-y-4 pb-2">
          {initialLoading && items.length === 0 ? (
            <>
              <div className="app-card rounded-xl border p-4 shadow-sm">
                <div className="skeleton-line h-5 w-32" />
                <div className="mt-2 skeleton-line h-4 w-36" />
                <div className="mt-3 space-y-2">
                  <div className="skeleton-line h-4 w-20" />
                  <div className="skeleton-line h-4 w-16" />
                  <div className="skeleton-line h-4 w-24" />
                </div>
              </div>
              <div className="app-card rounded-xl border p-4 shadow-sm">
                <div className="skeleton-line h-5 w-28" />
                <div className="mt-2 skeleton-line h-4 w-40" />
                <div className="mt-3 space-y-2">
                  <div className="skeleton-line h-4 w-24" />
                  <div className="skeleton-line h-4 w-16" />
                  <div className="skeleton-line h-4 w-20" />
                </div>
              </div>
            </>
          ) : items.length === 0 ? (
            <div className="app-text-secondary mt-10 text-center">
              <p>Пока нет тренировок</p>
              <Link href={emptyCtaHref} className="app-button-secondary mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2">
                {emptyCtaLabel}
              </Link>
            </div>
          ) : (
            items.map((item) => (
              <WorkoutFeedCard
                key={item.id}
                rawTitle={item.title}
                distanceKm={item.distance_km}
                pace={item.pace}
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
          {loadingMore ? (
            <p className="app-text-secondary py-3 text-center text-sm">Загружаем еще...</p>
          ) : null}
          {hasMore && items.length > 0 ? <div ref={loadMoreRef} className="h-1" aria-hidden="true" /> : null}
        </div>
      </div>
    </main>
  )
}
