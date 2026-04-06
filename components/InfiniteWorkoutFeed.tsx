'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import RunLikesSheet from '@/components/RunLikesSheet'
import WorkoutFeedCard from '@/components/WorkoutFeedCard'
import { loadFeedRuns, type FeedRunItem } from '@/lib/dashboard'
import {
  countVisibleRunCommentRecords,
  loadRunCommentVisibilitySummaryForRunIds,
  subscribeToFeedRunComments,
  type RunCommentRealtimeRow,
  type RunCommentVisibilityRecord,
} from '@/lib/run-comments'
import {
  loadRunLikedUsers,
  subscribeToRunLikes,
  type RunLikeRealtimePayload,
  type RunLikedUserItem,
} from '@/lib/run-likes'
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
  onCommentClick?: (runId: string) => void
}

type FeedCommentVisibilityById = Record<string, RunCommentVisibilityRecord>

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
  onCommentClick,
}: InfiniteWorkoutFeedProps) {
  const router = useRouter()
  const [items, setItems] = useState<FeedRunItem[]>([])
  const [likedUsersByRunId, setLikedUsersByRunId] = useState<Record<string, RunLikedUserItem[]>>({})
  const [likedUsersErrorByRunId, setLikedUsersErrorByRunId] = useState<Record<string, string>>({})
  const [likedUsersLoadingRunId, setLikedUsersLoadingRunId] = useState<string | null>(null)
  const [activeLikesRun, setActiveLikesRun] = useState<{ runId: string } | null>(null)
  const [feedError, setFeedError] = useState('')
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [nextOffset, setNextOffset] = useState(0)
  const [likeInFlightByRunId, setLikeInFlightByRunId] = useState<Record<string, boolean>>({})
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const currentUserIdRef = useRef<string | null>(null)
  const itemsRef = useRef<FeedRunItem[]>([])
  const likeInFlightRef = useRef<Record<string, boolean>>({})
  const likeRequestVersionByRunIdRef = useRef<Record<string, number>>({})
  const commentVisibilityByRunIdRef = useRef<Record<string, FeedCommentVisibilityById>>({})
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

  const updateRunItem = useCallback((runId: string, updater: (item: FeedRunItem) => FeedRunItem) => {
    const nextItems = itemsRef.current.map((item) => (item.id === runId ? updater(item) : item))
    itemsRef.current = nextItems
    setItems(nextItems)
  }, [])

  const clearRunLikesCache = useCallback((runId: string) => {
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
  }, [])

  const setLikeInFlight = useCallback((runId: string, inFlight: boolean) => {
    likeInFlightRef.current[runId] = inFlight
    setLikeInFlightByRunId((prev) => {
      const isCurrentlyInFlight = prev[runId] === true
      if (isCurrentlyInFlight === inFlight) {
        return prev
      }

      const next = { ...prev }
      if (inFlight) {
        next[runId] = true
      } else {
        delete next[runId]
      }

      return next
    })
  }, [])

  const setRunCommentVisibility = useCallback((runId: string, comments: RunCommentVisibilityRecord[]) => {
    commentVisibilityByRunIdRef.current[runId] = Object.fromEntries(
      comments.map((comment) => [comment.id, comment])
    )
  }, [])

  const mergeRunCommentVisibility = useCallback((visibilityByRunId: Record<string, RunCommentVisibilityRecord[]>) => {
    for (const [runId, comments] of Object.entries(visibilityByRunId)) {
      setRunCommentVisibility(runId, comments)
    }
  }, [setRunCommentVisibility])

  const getVisibleRunCommentCount = useCallback((runId: string) => {
    const comments = Object.values(commentVisibilityByRunIdRef.current[runId] ?? {})
    return Math.max(0, countVisibleRunCommentRecords(comments))
  }, [])

  const syncRunCommentCount = useCallback((runId: string) => {
    updateRunItem(runId, (item) => ({
      ...item,
      commentsCount: getVisibleRunCommentCount(runId),
    }))
  }, [getVisibleRunCommentCount, updateRunItem])

  const applyRealtimeComment = useCallback((commentRow: RunCommentRealtimeRow) => {
    const runId = commentRow.run_id
    const hasLoadedRun = itemsRef.current.some((item) => item.id === runId)

    if (!hasLoadedRun) {
      return
    }

    const existingRunComments = commentVisibilityByRunIdRef.current[runId] ?? {}
    commentVisibilityByRunIdRef.current[runId] = existingRunComments
    existingRunComments[commentRow.id] = {
      id: commentRow.id,
      runId: commentRow.run_id,
      parentId: commentRow.parent_id,
      createdAt: commentRow.created_at,
      deletedAt: commentRow.deleted_at,
    }

    syncRunCommentCount(runId)
  }, [syncRunCommentCount, updateRunItem])

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
        const commentSummary = await loadRunCommentVisibilitySummaryForRunIds(page.items.map((item) => item.id))

        if (firstPageRequestKeyRef.current !== requestKey) {
          return
        }

        mergeRunCommentVisibility(commentSummary.visibilityByRunId)
        setItems(page.items.map((item) => ({
          ...item,
          commentsCount: commentSummary.countsByRunId[item.id] ?? 0,
        })))
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
  }, [currentUserId, feedQueryKey, mergeRunCommentVisibility, pageSize, targetUserId])

  const loadMoreRuns = useCallback(async () => {
    if (initialLoading || loadingMore || !hasMore) return

    setLoadingMore(true)
    setFeedError('')

    try {
      const page = await loadFeedRuns(currentUserId, nextOffset, pageSize, targetUserId)
      const commentSummary = await loadRunCommentVisibilitySummaryForRunIds(page.items.map((item) => item.id))

      mergeRunCommentVisibility(commentSummary.visibilityByRunId)
      setItems((prev) => mergeUniqueFeedItems(prev, page.items).map((item) => ({
        ...item,
        commentsCount: commentVisibilityByRunIdRef.current[item.id]
          ? getVisibleRunCommentCount(item.id)
          : (commentSummary.countsByRunId[item.id] ?? item.commentsCount),
      })))
      setHasMore(page.hasMore)
      setNextOffset((prev) => prev + page.items.length)
    } catch {
      setFeedError('Не удалось загрузить ленту')
    } finally {
      setLoadingMore(false)
    }
  }, [
    currentUserId,
    getVisibleRunCommentCount,
    hasMore,
    initialLoading,
    loadingMore,
    mergeRunCommentVisibility,
    nextOffset,
    pageSize,
    targetUserId,
  ])

  useEffect(() => {
    if (!enabled) {
      return
    }

    firstPageRequestKeyRef.current = feedQueryKey
    firstPageRequestPromiseRef.current = null
    commentVisibilityByRunIdRef.current = {}
    likeInFlightRef.current = {}
    setItems([])
    setHasMore(true)
    setNextOffset(0)
    setLikeInFlightByRunId({})
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

  useEffect(() => {
    if (items.length === 0) {
      return
    }

    const unsubscribe = subscribeToFeedRunComments({
      onInsert: (commentRow) => {
        void applyRealtimeComment(commentRow)
      },
      onUpdate: (commentRow) => {
        void applyRealtimeComment(commentRow)
      },
    })

    return () => {
      unsubscribe()
    }
  }, [applyRealtimeComment, items.length])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const unsubscribe = subscribeToRunLikes((payload: RunLikeRealtimePayload) => {
      if (likeInFlightRef.current[payload.runId]) {
        return
      }

      const activeUserId = currentUserIdRef.current
      const currentItem = itemsRef.current.find((item) => item.id === payload.runId)

      if (!currentItem) {
        return
      }

      if (payload.eventType === 'INSERT') {
        if (payload.userId === activeUserId) {
          if (currentItem.likedByMe) {
            return
          }

          updateRunItem(payload.runId, (item) => ({
            ...item,
            likedByMe: true,
            likesCount: item.likesCount + 1,
          }))
          return
        }

        updateRunItem(payload.runId, (item) => ({
          ...item,
          likesCount: item.likesCount + 1,
        }))
        return
      }

      if (payload.userId === activeUserId) {
        if (!currentItem.likedByMe) {
          return
        }

        updateRunItem(payload.runId, (item) => ({
          ...item,
          likedByMe: false,
          likesCount: Math.max(0, item.likesCount - 1),
        }))
        return
      }

      updateRunItem(payload.runId, (item) => ({
        ...item,
        likesCount: Math.max(0, item.likesCount - 1),
      }))
    })

    return () => {
      unsubscribe()
    }
  }, [enabled, updateRunItem])

  const handleLikeToggle = useCallback(async (runId: string) => {
    const activeUserId = currentUserIdRef.current

    if (!activeUserId) {
      router.replace('/login')
      return
    }

    const currentItem = itemsRef.current.find((item) => item.id === runId)
    if (!currentItem) return
    if (likeInFlightRef.current[runId]) return
    if (currentItem.user_id === activeUserId) return

    const wasLiked = currentItem.likedByMe
    const previousItems = itemsRef.current
    const nextRequestVersion = (likeRequestVersionByRunIdRef.current[runId] ?? 0) + 1
    likeRequestVersionByRunIdRef.current[runId] = nextRequestVersion

    try {
      setLikeInFlight(runId, true)

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

      void toggleRunLike(runId, activeUserId, wasLiked)
        .then(({ error: likeError }) => {
          if (likeRequestVersionByRunIdRef.current[runId] !== nextRequestVersion) {
            return
          }

          if (likeError) {
            itemsRef.current = previousItems
            setItems(previousItems)
            return
          }

          clearRunLikesCache(runId)
        })
        .catch(() => {
          if (likeRequestVersionByRunIdRef.current[runId] !== nextRequestVersion) {
            return
          }

          itemsRef.current = previousItems
          setItems(previousItems)
        })
        .finally(() => {
          setLikeInFlight(runId, false)
        })
    } catch {
      setLikeInFlight(runId, false)
      itemsRef.current = previousItems
      setItems(previousItems)
    }
  }, [clearRunLikesCache, router, setLikeInFlight])

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

  const error = feedError
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
              isOwnRun={item.user_id === currentUserId}
              isLikeInFlight={Boolean(likeInFlightByRunId[item.id])}
              photos={item.photos}
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
