'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ParticipantIdentity from '@/components/ParticipantIdentity'
import RunLikesSheet from '@/components/RunLikesSheet'
import WorkoutFeedCard from '@/components/WorkoutFeedCard'
import { loadFeedRuns, type FeedItem, type FeedRunItem, type FeedRaceEventItem } from '@/lib/dashboard'
import { getRaceDistanceLabel } from '@/lib/race-result-share'
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
import { formatDistanceKm } from '@/lib/format'
import { formatClock } from '@/lib/race-events'
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
type RunFeedItem = Extract<FeedItem, { kind: 'run' }>

function isRunFeedItem(item: FeedItem): item is RunFeedItem {
  return item.kind === 'run'
}

function mergeUniqueMixedFeedItems(existing: FeedItem[], incoming: FeedItem[]) {
  const existingIds = new Set(existing.map((item) => item.id))
  return [...existing, ...incoming.filter((item) => !existingIds.has(item.id))]
}

function formatRaceDateLabel(dateValue: string | null) {
  if (!dateValue) {
    return 'Дата не указана'
  }

  const parsedDate = new Date(`${dateValue}T12:00:00`)

  if (Number.isNaN(parsedDate.getTime())) {
    return dateValue
  }

  return parsedDate.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatLinkedRunPreview(item: FeedRaceEventItem) {
  if (!item.linkedRun) {
    return null
  }

  const distanceLabel =
    Number.isFinite(item.linkedRun.distanceKm) && (item.linkedRun.distanceKm ?? 0) > 0
      ? `${formatDistanceKm(Number(item.linkedRun.distanceKm ?? 0))} км`
      : null
  const timeLabel = formatClock(item.linkedRun.movingTimeSeconds)
  const runName = item.linkedRun.name?.trim() || 'Тренировка'

  return [runName, distanceLabel, timeLabel].filter(Boolean).join(' • ')
}

function formatLinkedRunPace(item: FeedRaceEventItem) {
  if (!item.linkedRun) {
    return null
  }

  const distanceKm = Number(item.linkedRun.distanceKm ?? 0)
  const movingTimeSeconds = Number(item.linkedRun.movingTimeSeconds ?? 0)

  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !Number.isFinite(movingTimeSeconds) || movingTimeSeconds <= 0) {
    return null
  }

  const paceSeconds = Math.round(movingTimeSeconds / distanceKm)
  const minutes = Math.floor(paceSeconds / 60)
  const seconds = paceSeconds % 60

  return `${minutes}:${String(seconds).padStart(2, '0')} /км`
}

function RaceFeedCard({ item }: { item: FeedRaceEventItem }) {
  const resultLabel = formatClock(item.resultTimeSeconds)
  const targetLabel = formatClock(item.targetTimeSeconds)
  const linkedRunPreview = formatLinkedRunPreview(item)
  const linkedRunPace = formatLinkedRunPace(item)
  const distanceLabel = getRaceDistanceLabel(item.distanceMeters)
  const isUpcoming = Boolean(item.raceDate && item.raceDate > new Date().toISOString().slice(0, 10))

  return (
    <Link href={`/races/${item.raceEventId}`} className="block">
      <article className="app-card relative overflow-hidden rounded-2xl px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-shadow duration-200 ease-in-out hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] ring-1 ring-black/5 dark:ring-white/10">
        <ParticipantIdentity
          avatarUrl={item.avatar_url}
          displayName={item.displayName}
          level={getLevelFromXP(item.totalXp).level}
          size="sm"
        />

        <div className="mt-4 min-w-0">
          <div className="mt-1 flex items-start justify-between gap-3">
            <p className="app-text-primary min-w-0 break-words text-[17px] font-semibold leading-6 sm:text-[18px]">{item.raceName}</p>
            <p className="app-text-secondary shrink-0 text-right text-sm">
              {formatRaceDateLabel(item.raceDate)}
            </p>
          </div>
        </div>

        {isUpcoming ? (
          <div className="mt-4 min-w-0 space-y-2">
            {distanceLabel ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="app-text-secondary">Дистанция</span>
                <span className="app-text-primary break-words font-medium">{distanceLabel}</span>
              </div>
            ) : null}
            {targetLabel ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="app-text-secondary">Цель</span>
                <span className="app-text-primary break-words font-medium">{targetLabel}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 min-w-0 space-y-2.5">
            {resultLabel ? (
              <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
                <p className="app-text-primary text-[28px] font-semibold leading-none tracking-[-0.03em] sm:text-[32px]">
                  {resultLabel}
                </p>
                <p className="app-text-secondary pb-0.5 text-sm">Результат</p>
              </div>
            ) : null}
            <p className="app-text-secondary break-words text-sm">{formatRaceDateLabel(item.raceDate)}</p>
            {distanceLabel ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="app-text-secondary">Дистанция</span>
                <span className="app-text-primary break-words font-medium">{distanceLabel}</span>
              </div>
            ) : null}
          </div>
        )}

        {item.linkedRun ? (
          <div className="mt-4 rounded-2xl border border-black/5 px-3 py-3 dark:border-white/10">
            <p className="app-text-primary text-sm font-medium">Привязанная тренировка</p>
            <p className="app-text-secondary mt-1 break-words text-sm">{linkedRunPreview ?? 'Тренировка'}</p>
            {linkedRunPace ? (
              <p className="app-text-secondary mt-1 break-words text-xs">{linkedRunPace}</p>
            ) : null}
          </div>
        ) : null}
      </article>
    </Link>
  )
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
  const [items, setItems] = useState<FeedItem[]>([])
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
  const itemsRef = useRef<FeedItem[]>([])
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

  const updateRunItem = useCallback((runId: string, updater: (item: RunFeedItem) => RunFeedItem) => {
    const nextItems = itemsRef.current.map((item) => (
      item.kind === 'run' && item.id === runId ? updater(item) : item
    ))
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

    if (!runId) {
      return
    }

    const hasLoadedRun = itemsRef.current.some((item) => item.kind === 'run' && item.id === runId)

    if (!hasLoadedRun) {
      return
    }

    const existingRunComments = commentVisibilityByRunIdRef.current[runId] ?? {}
    commentVisibilityByRunIdRef.current[runId] = existingRunComments
    existingRunComments[commentRow.id] = {
      id: commentRow.id,
      entityType: commentRow.entity_type,
      entityId: commentRow.entity_id,
      runId: commentRow.run_id,
      parentId: commentRow.parent_id,
      createdAt: commentRow.created_at,
      deletedAt: commentRow.deleted_at,
    }

    syncRunCommentCount(runId)
  }, [syncRunCommentCount])

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
        const runIds = page.items
          .filter(isRunFeedItem)
          .map((item) => item.id)
        const commentSummary = await loadRunCommentVisibilitySummaryForRunIds(runIds)

        if (firstPageRequestKeyRef.current !== requestKey) {
          return
        }

        mergeRunCommentVisibility(commentSummary.visibilityByRunId)
        setItems(page.items.map((item) => (
          item.kind === 'run'
            ? {
                ...item,
                commentsCount: commentSummary.countsByRunId[item.id] ?? 0,
              }
            : item
        )))
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
      const runIds = page.items
        .filter(isRunFeedItem)
        .map((item) => item.id)
      const commentSummary = await loadRunCommentVisibilitySummaryForRunIds(runIds)

      mergeRunCommentVisibility(commentSummary.visibilityByRunId)
      setItems((prev) => mergeUniqueMixedFeedItems(prev, page.items).map((item) => (
        item.kind === 'run'
          ? {
              ...item,
              commentsCount: commentVisibilityByRunIdRef.current[item.id]
                ? getVisibleRunCommentCount(item.id)
                : (commentSummary.countsByRunId[item.id] ?? item.commentsCount),
            }
          : item
      )))
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
      const activeUserId = currentUserIdRef.current
      if (likeInFlightRef.current[payload.runId] && payload.userId === activeUserId) {
        return
      }

      const currentItem = itemsRef.current.find(
        (item): item is RunFeedItem => item.kind === 'run' && item.id === payload.runId
      )

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

    const currentItem = itemsRef.current.find(
      (item): item is RunFeedItem => item.kind === 'run' && item.id === runId
    )
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
        item.kind === 'run' && item.id === runId
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
    ? items.find((item): item is RunFeedItem => item.kind === 'run' && item.id === activeLikesRunId) ?? null
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
            item.kind === 'run' ? (
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
            ) : (
              <RaceFeedCard key={item.id} item={item} />
            )
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
