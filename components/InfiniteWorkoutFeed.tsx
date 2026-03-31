'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import RunLikesSheet from '@/components/RunLikesSheet'
import WorkoutFeedCard from '@/components/WorkoutFeedCard'
import { loadFeedRuns, type FeedRunItem } from '@/lib/dashboard'
import {
  subscribeToRunComments,
  type RunCommentRealtimeRow,
} from '@/lib/run-comments'
import { loadRunLikedUsers, type RunLikedUserItem } from '@/lib/run-likes'
import { RUNS_UPDATED_EVENT, RUNS_UPDATED_STORAGE_KEY } from '@/lib/runs-refresh'
import { toggleRunLike } from '@/lib/run-likes'
import { getLevelFromXP } from '@/lib/xp'

type InfiniteWorkoutFeedProps = {
  currentUserId: string | null
  enabled?: boolean
  targetUserId?: string | null
  pageSize?: number
  emptyTitle: string
  emptyDescription?: string
  emptyCtaHref?: string
  emptyCtaLabel?: string
  showLevelSubtitle?: boolean
  onSuccessfulLikeToggle?: () => void
  onCommentClick?: (runId: string) => void
}

function mergeUniqueFeedItems(existing: FeedRunItem[], incoming: FeedRunItem[]) {
  const existingIds = new Set(existing.map((item) => item.id))
  return [...existing, ...incoming.filter((item) => !existingIds.has(item.id))]
}

export default function InfiniteWorkoutFeed({
  currentUserId,
  enabled = true,
  targetUserId = null,
  pageSize = 10,
  emptyTitle,
  emptyDescription,
  emptyCtaHref,
  emptyCtaLabel,
  showLevelSubtitle = true,
  onSuccessfulLikeToggle,
  onCommentClick,
}: InfiniteWorkoutFeedProps) {
  const router = useRouter()
  const [items, setItems] = useState<FeedRunItem[]>([])
  const [pendingRunIds, setPendingRunIds] = useState<string[]>([])
  const [likedUsersByRunId, setLikedUsersByRunId] = useState<Record<string, RunLikedUserItem[]>>({})
  const [likedUsersErrorByRunId, setLikedUsersErrorByRunId] = useState<Record<string, string>>({})
  const [likedUsersLoadingRunId, setLikedUsersLoadingRunId] = useState<string | null>(null)
  const [activeLikesRun, setActiveLikesRun] = useState<{ runId: string } | null>(null)
  const [actionError, setActionError] = useState('')
  const [feedError, setFeedError] = useState('')
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [nextOffset, setNextOffset] = useState(0)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const currentUserIdRef = useRef<string | null>(null)
  const itemsRef = useRef<FeedRunItem[]>([])
  const pendingRunIdsRef = useRef<string[]>([])
  const firstPageRequestPromiseRef = useRef<Promise<void> | null>(null)
  const firstPageRequestKeyRef = useRef<string>('')

  const feedQueryKey = useMemo(
    () => [currentUserId ?? 'anonymous', targetUserId ?? 'all', pageSize].join(':'),
    [currentUserId, pageSize, targetUserId]
  )

  useEffect(() => {
    currentUserIdRef.current = currentUserId
  }, [currentUserId])

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    pendingRunIdsRef.current = pendingRunIds
  }, [pendingRunIds])

  const updateRunItem = useCallback((runId: string, updater: (item: FeedRunItem) => FeedRunItem) => {
    const nextItems = itemsRef.current.map((item) => (item.id === runId ? updater(item) : item))
    itemsRef.current = nextItems
    setItems(nextItems)
  }, [])

  const mergeRealtimeComment = useCallback((commentRow: RunCommentRealtimeRow) => {
    const runId = commentRow.run_id

    updateRunItem(runId, (item) => ({
      ...item,
      commentsCount: Math.max(0, item.commentsCount + 1),
    }))
  }, [updateRunItem])

  const loadFirstPage = useCallback(async () => {
    if (
      firstPageRequestPromiseRef.current &&
      firstPageRequestKeyRef.current === feedQueryKey
    ) {
      return firstPageRequestPromiseRef.current
    }

    setInitialLoading(true)
    setFeedError('')

    const requestKey = feedQueryKey
    firstPageRequestKeyRef.current = requestKey

    const requestPromise = (async () => {
      try {
        const page = await loadFeedRuns(currentUserId, 0, pageSize, targetUserId)

        if (firstPageRequestKeyRef.current !== requestKey) {
          return
        }

        setItems(page.items)
        setHasMore(page.hasMore)
        setNextOffset(page.items.length)
      } catch {
        if (firstPageRequestKeyRef.current !== requestKey) {
          return
        }

        setFeedError('Не удалось загрузить ленту')
        setItems([])
        setHasMore(false)
        setNextOffset(0)
      } finally {
        if (firstPageRequestKeyRef.current === requestKey) {
          setInitialLoading(false)
        }
      }
    })()

    firstPageRequestPromiseRef.current = requestPromise

    try {
      await requestPromise
    } finally {
      if (firstPageRequestPromiseRef.current === requestPromise) {
        firstPageRequestPromiseRef.current = null
      }
    }
  }, [currentUserId, feedQueryKey, pageSize, targetUserId])

  const loadMoreRuns = useCallback(async () => {
    if (initialLoading || loadingMore || !hasMore) return

    setLoadingMore(true)
    setFeedError('')

    try {
      const page = await loadFeedRuns(currentUserId, nextOffset, pageSize, targetUserId)
      setItems((prev) => mergeUniqueFeedItems(prev, page.items))
      setHasMore(page.hasMore)
      setNextOffset((prev) => prev + page.items.length)
    } catch {
      setFeedError('Не удалось загрузить ленту')
    } finally {
      setLoadingMore(false)
    }
  }, [currentUserId, hasMore, initialLoading, loadingMore, nextOffset, pageSize, targetUserId])

  useEffect(() => {
    if (!enabled) {
      return
    }

    firstPageRequestKeyRef.current = feedQueryKey
    firstPageRequestPromiseRef.current = null
    setItems([])
    setHasMore(true)
    setNextOffset(0)
    setActionError('')
    setActiveLikesRun(null)
    void loadFirstPage()
  }, [enabled, feedQueryKey, loadFirstPage])

  useEffect(() => {
    if (!enabled) {
      return
    }

    function handleRunsUpdated() {
      void loadFirstPage()
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === RUNS_UPDATED_STORAGE_KEY) {
        void loadFirstPage()
      }
    }

    window.addEventListener(RUNS_UPDATED_EVENT, handleRunsUpdated)
    window.addEventListener('storage', handleStorage)

    return () => {
      window.removeEventListener(RUNS_UPDATED_EVENT, handleRunsUpdated)
      window.removeEventListener('storage', handleStorage)
    }
  }, [enabled, loadFirstPage])

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || initialLoading || loadingMore || !hasMore) return

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
  }, [hasMore, initialLoading, loadMoreRuns, loadingMore, items.length])

  const subscribedRunIds = useMemo(
    () => Array.from(new Set(items.map((item) => item.id).filter(Boolean))),
    [items]
  )
  const subscribedRunIdsKey = subscribedRunIds.join(',')

  useEffect(() => {
    const runIds = subscribedRunIdsKey ? subscribedRunIdsKey.split(',') : []

    if (runIds.length === 0) {
      return
    }

    const unsubscribers = runIds.map((runId) =>
      subscribeToRunComments(runId, (commentRow) => {
        void mergeRealtimeComment(commentRow)
      })
    )

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [mergeRealtimeComment, subscribedRunIdsKey])

  const handleLikeToggle = useCallback(async (runId: string) => {
    const activeUserId = currentUserIdRef.current

    if (!activeUserId) {
      router.replace('/login')
      return
    }

    if (pendingRunIdsRef.current.includes(runId)) return

    const currentItem = itemsRef.current.find((item) => item.id === runId)
    if (!currentItem) return

    const wasLiked = currentItem.likedByMe
    const previousItems = itemsRef.current

    setActionError('')
    pendingRunIdsRef.current = [...pendingRunIdsRef.current, runId]
    setPendingRunIds((prev) => [...prev, runId])

    try {
      const nextItems = previousItems.map((item) =>
        item.id === runId
          ? {
              ...item,
              likedByMe: !wasLiked,
              likesCount: Math.max(0, item.likesCount + (wasLiked ? -1 : 1)),
            }
          : item
      )
      itemsRef.current = nextItems
      setItems(nextItems)

      const { error: likeError } = await toggleRunLike(runId, activeUserId, wasLiked)

      if (likeError) {
        setActionError('Не удалось обновить лайк')
        itemsRef.current = previousItems
        setItems(previousItems)
        return
      }

      setLikedUsersByRunId((prev) => {
        if (!(runId in prev)) {
          return prev
        }

        const next = { ...prev }
        delete next[runId]
        return next
      })
      setLikedUsersErrorByRunId((prev) => {
        if (!(runId in prev)) {
          return prev
        }

        const next = { ...prev }
        delete next[runId]
        return next
      })

      onSuccessfulLikeToggle?.()
    } catch {
      setActionError('Не удалось обновить лайк')
      itemsRef.current = previousItems
      setItems(previousItems)
    } finally {
      pendingRunIdsRef.current = pendingRunIdsRef.current.filter((id) => id !== runId)
      setPendingRunIds((prev) => prev.filter((id) => id !== runId))
    }
  }, [onSuccessfulLikeToggle, router])

  const loadLikedUsersForRun = useCallback(async (runId: string, force = false) => {
    if (!runId) {
      return
    }

    if (!force && Object.prototype.hasOwnProperty.call(likedUsersByRunId, runId)) {
      return
    }

    setLikedUsersLoadingRunId(runId)
    setLikedUsersErrorByRunId((prev) => ({
      ...prev,
      [runId]: '',
    }))

    try {
      const likedUsers = await loadRunLikedUsers(runId)
      setLikedUsersByRunId((prev) => ({
        ...prev,
        [runId]: likedUsers,
      }))
    } catch {
      setLikedUsersErrorByRunId((prev) => ({
        ...prev,
        [runId]: 'Не удалось загрузить лайки',
      }))
    } finally {
      setLikedUsersLoadingRunId((currentRunId) => (currentRunId === runId ? null : currentRunId))
    }
  }, [likedUsersByRunId])

  const handleCommentClick = useCallback((runId: string) => {
    if (!runId) {
      return
    }

    if (onCommentClick) {
      onCommentClick(runId)
      return
    }

    setActiveLikesRun(null)
    router.push(`/runs/${runId}/discussion`)
  }, [onCommentClick, router])

  const handleOpenLikes = useCallback((item: FeedRunItem) => {
    setActiveLikesRun({
      runId: item.id,
    })

    void loadLikedUsersForRun(item.id)
  }, [loadLikedUsersForRun])

  const error = actionError || feedError
  const activeLikesRunId = activeLikesRun?.runId ?? ''
  const activeLikesItem = activeLikesRunId
    ? items.find((item) => item.id === activeLikesRunId) ?? null
    : null
  const activeLikedUsers = activeLikesRunId ? likedUsersByRunId[activeLikesRunId] ?? [] : []
  const activeLikesError = activeLikesRunId ? likedUsersErrorByRunId[activeLikesRunId] ?? '' : ''

  return (
    <>
      <div className="min-h-[236px] space-y-4 pb-2">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
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
            <p>{emptyTitle}</p>
            {emptyDescription ? <p className="mt-2 text-sm">{emptyDescription}</p> : null}
            {emptyCtaHref && emptyCtaLabel ? (
              <Link href={emptyCtaHref} className="app-button-secondary mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2">
                {emptyCtaLabel}
              </Link>
            ) : null}
          </div>
        ) : (
          items.map((item) => (
            <WorkoutFeedCard
              key={item.id}
              runId={item.id}
              rawTitle={item.title}
              city={item.city}
              country={item.country}
              description={item.description}
              externalSource={item.external_source}
              distanceKm={item.distance_km}
              pace={item.pace}
              movingTime={item.movingTime}
              mapPolyline={item.map_polyline}
              xp={item.xp}
              createdAt={item.created_at}
              displayName={item.displayName}
              avatarUrl={item.avatar_url}
              level={getLevelFromXP(item.totalXp).level}
              likesCount={item.likesCount}
              commentsCount={item.commentsCount}
              likedByMe={item.likedByMe}
              photos={item.photos}
              pending={pendingRunIds.includes(item.id)}
              onToggleLike={handleLikeToggle}
              onOpenLikes={() => handleOpenLikes(item)}
              onCommentClick={handleCommentClick}
              profileHref={`/users/${item.user_id}`}
            />
          ))
        )}
        {loadingMore ? (
          <p className="app-text-secondary py-3 text-center text-sm">Загружаем еще...</p>
        ) : null}
        {hasMore && items.length > 0 ? <div ref={loadMoreRef} className="h-1" aria-hidden="true" /> : null}
      </div>

      <RunLikesSheet
        open={Boolean(activeLikesRun)}
        likesCount={activeLikesItem?.likesCount ?? 0}
        loading={likedUsersLoadingRunId === activeLikesRunId}
        error={activeLikesError}
        users={activeLikedUsers}
        onClose={() => setActiveLikesRun(null)}
        onRetry={() => {
          if (activeLikesRunId) {
            void loadLikedUsersForRun(activeLikesRunId, true)
          }
        }}
      />
    </>
  )
}
