'use client'

import { Heart, MessageCircle } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import FeedActionButton from '@/components/FeedActionButton'
import ParticipantIdentity from '@/components/ParticipantIdentity'
import {
  loadRaceEventLikedUsers,
  subscribeToRaceEventLikes,
  toggleRaceEventLike,
  type RaceEventLikeRealtimePayload,
} from '@/lib/race-event-likes'
import RunLikesSheet from '@/components/RunLikesSheet'
import RunXpBreakdownSheet from '@/components/RunXpBreakdownSheet'
import WorkoutFeedCard from '@/components/WorkoutFeedCard'
import {
  loadFeedRuns,
  type FeedItem,
  type FeedRaceEventItem,
  type FeedRunItem,
} from '@/lib/dashboard'
import { getRaceDistanceLabel } from '@/lib/race-result-share'
import {
  countVisibleRunCommentRecords,
  loadEntityCommentVisibilitySummaryForEntityIds,
  loadRunCommentVisibilitySummaryForRunIds,
  subscribeToFeedRunComments,
  type RunCommentRealtimeRow,
  type RunCommentVisibilityRecord,
} from '@/lib/run-comments'
import {
  type LikedUserListItem,
  loadRunLikedUsers,
  subscribeToRunLikes,
  type RunLikeRealtimePayload,
} from '@/lib/run-likes'
import { RUNS_UPDATED_EVENT, RUNS_UPDATED_STORAGE_KEY } from '@/lib/runs-refresh'
import { toggleRunLike } from '@/lib/run-likes'
import { useRunDetailReturnState } from '@/lib/run-detail-navigation'
import { formatDistanceKm } from '@/lib/format'
import { formatClock } from '@/lib/race-events'
import { getLevelFromXP } from '@/lib/xp'

type InfiniteWorkoutFeedProps = {
  currentUserId: string | null
  enabled?: boolean
  targetUserId?: string | null
  pageSize?: number
  scrollRestorationKey?: string
  emptyTitle: string
  emptyDescription?: string
  emptyCtaHref?: string
  emptyCtaLabel?: string
  showLevelSubtitle?: boolean
  onCommentClick?: (runId: string) => void
}

type FeedCommentVisibilityById = Record<string, RunCommentVisibilityRecord>
type RunFeedItem = Extract<FeedItem, { kind: 'run' }>
type RaceEventFeedItem = Extract<FeedItem, { kind: 'race_event' }>
type ChallengeFeedItem = Extract<FeedItem, { kind: 'challenge' }>
type FeedRestoreSnapshot = {
  items: FeedItem[]
  hasMore: boolean
  nextOffset: number
  savedAt: number
}

type ActiveLikesTarget =
  | { type: 'run'; id: string }
  | { type: 'race_event'; id: string }

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

function formatFeedTimestamp(value: string) {
  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return ''
  }

  return parsedDate.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type RaceFeedCardProps = {
  item: FeedRaceEventItem
  isLikeInFlight: boolean
  onCommentClick: (raceEventId: string) => void
  onOpenLikes: (raceEventId: string) => void
  onOpenLikesPreview?: (raceEventId: string) => void
  onPrefetchProfile: (href: string) => void
  onPrefetchRaceEvent: (raceEventId: string) => void
  onOpenProfile: (href: string) => void
  onOpenRaceEvent: (raceEventId: string) => void
  onToggleLike: (raceEventId: string) => void
}

function RaceFeedCard({
  item,
  isLikeInFlight,
  onCommentClick,
  onOpenLikes,
  onOpenLikesPreview,
  onPrefetchProfile,
  onPrefetchRaceEvent,
  onOpenProfile,
  onOpenRaceEvent,
  onToggleLike,
}: RaceFeedCardProps) {
  const resultLabel = formatClock(item.resultTimeSeconds)
  const targetLabel = formatClock(item.targetTimeSeconds)
  const linkedRunPreview = formatLinkedRunPreview(item)
  const linkedRunPace = formatLinkedRunPace(item)
  const distanceLabel = getRaceDistanceLabel(item.distanceMeters)
  const isUpcoming = Boolean(item.raceDate && item.raceDate > new Date().toISOString().slice(0, 10))

  return (
    <article
      className="app-card relative cursor-pointer overflow-hidden rounded-2xl px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-shadow duration-200 ease-in-out hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] ring-1 ring-black/5 dark:ring-white/10"
      role="button"
      tabIndex={0}
      onMouseEnter={() => onPrefetchRaceEvent(item.raceEventId)}
      onTouchStart={() => onPrefetchRaceEvent(item.raceEventId)}
      onFocus={() => onPrefetchRaceEvent(item.raceEventId)}
      onClick={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('a,button')) return
        onOpenRaceEvent(item.raceEventId)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        const target = event.target as HTMLElement
        if (target.closest('a,button')) return
        event.preventDefault()
        onOpenRaceEvent(item.raceEventId)
      }}
    >
      <ParticipantIdentity
        avatarUrl={item.avatar_url}
        displayName={item.displayName}
        level={getLevelFromXP(item.totalXp).level}
        href={`/users/${item.user_id}`}
        onNavigate={onOpenProfile}
        onInteractionStart={() => onPrefetchProfile(`/users/${item.user_id}`)}
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

      <div className="mt-4 border-t border-black/5 pt-3.5 dark:border-white/10">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 shrink items-center gap-1 sm:gap-3">
            <FeedActionButton
              count={item.raceEventLikeCount}
              active={item.raceEventLikedByViewer}
              actionDisabled={isLikeInFlight}
              onClick={() => onToggleLike(item.raceEventId)}
              onCountClick={() => onOpenLikes(item.raceEventId)}
              onInteractionStart={() => {
                if (item.raceEventLikeCount > 0) {
                  onOpenLikesPreview?.(item.raceEventId)
                }
              }}
              icon={
                <Heart
                  className="h-4 w-4"
                  strokeWidth={1.9}
                  fill={item.raceEventLikedByViewer ? 'currentColor' : 'none'}
                />
              }
            />
            <FeedActionButton
              count={item.commentsCount}
              onClick={() => onCommentClick(item.raceEventId)}
              icon={<MessageCircle className="h-4 w-4" strokeWidth={1.9} />}
            />
          </div>
        </div>
      </div>
    </article>
  )
}

type ChallengeFeedCardProps = {
  item: ChallengeFeedItem
  onPrefetchProfile: (href: string) => void
  onOpenProfile: (href: string) => void
  onOpenChallenge: (targetPath: string) => void
}

function ChallengeFeedCard({
  item,
  onPrefetchProfile,
  onOpenProfile,
  onOpenChallenge,
}: ChallengeFeedCardProps) {
  const completedAtLabel = formatFeedTimestamp(item.created_at)
  const xpLabel = Number.isFinite(item.xpAwarded) && (item.xpAwarded ?? 0) > 0
    ? `+${Math.round(Number(item.xpAwarded ?? 0))} XP`
    : null

  return (
    <article
      className="app-card relative cursor-pointer overflow-hidden rounded-2xl px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-shadow duration-200 ease-in-out hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] ring-1 ring-black/5 dark:ring-white/10"
      role="button"
      tabIndex={0}
      onClick={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('a,button')) return
        onOpenChallenge(item.targetPath ?? '/challenges')
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        const target = event.target as HTMLElement
        if (target.closest('a,button')) return
        event.preventDefault()
        onOpenChallenge(item.targetPath ?? '/challenges')
      }}
    >
      <ParticipantIdentity
        avatarUrl={item.avatar_url}
        displayName={item.displayName}
        level={getLevelFromXP(item.totalXp).level}
        href={`/users/${item.user_id}`}
        onNavigate={onOpenProfile}
        onInteractionStart={() => onPrefetchProfile(`/users/${item.user_id}`)}
        size="sm"
      />

      <div className="mt-4 min-w-0">
        <p className="app-text-secondary text-sm">Челлендж выполнен</p>
        <p className="app-text-primary mt-1 break-words text-[17px] font-semibold leading-6 sm:text-[18px]">
          {item.challengeTitle}
        </p>
        <div className="app-text-secondary mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {xpLabel ? <span>{xpLabel}</span> : null}
          {xpLabel && completedAtLabel ? <span>•</span> : null}
          {completedAtLabel ? <span>{completedAtLabel}</span> : null}
        </div>
      </div>
    </article>
  )
}

export default function InfiniteWorkoutFeed({
  currentUserId,
  enabled = true,
  targetUserId = null,
  pageSize = 10,
  scrollRestorationKey,
  emptyTitle,
  emptyDescription,
  emptyCtaHref,
  emptyCtaLabel,
  onCommentClick,
}: InfiniteWorkoutFeedProps) {
  const router = useRouter()
  const feedQueryKey = useMemo(
    () => [currentUserId ?? 'anonymous', targetUserId ?? 'all', pageSize].join(':'),
    [currentUserId, pageSize, targetUserId]
  )
  const [items, setItems] = useState<FeedItem[]>([])
  const [likedUsersByRunId, setLikedUsersByRunId] = useState<Record<string, LikedUserListItem[]>>({})
  const [likedUsersByRaceEventId, setLikedUsersByRaceEventId] = useState<Record<string, LikedUserListItem[]>>({})
  const [likedUsersErrorByRunId, setLikedUsersErrorByRunId] = useState<Record<string, string>>({})
  const [likedUsersErrorByRaceEventId, setLikedUsersErrorByRaceEventId] = useState<Record<string, string>>({})
  const [likedUsersLoadingRunId, setLikedUsersLoadingRunId] = useState<string | null>(null)
  const [likedUsersLoadingRaceEventId, setLikedUsersLoadingRaceEventId] = useState<string | null>(null)
  const [activeLikesTarget, setActiveLikesTarget] = useState<ActiveLikesTarget | null>(null)
  const [activeXpRunId, setActiveXpRunId] = useState<string | null>(null)
  const [feedError, setFeedError] = useState('')
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [nextOffset, setNextOffset] = useState(0)
  const [likeInFlightByRunId, setLikeInFlightByRunId] = useState<Record<string, boolean>>({})
  const [likeInFlightByRaceEventId, setLikeInFlightByRaceEventId] = useState<Record<string, boolean>>({})
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const feedRootRef = useRef<HTMLDivElement | null>(null)
  const currentUserIdRef = useRef<string | null>(null)
  const itemsRef = useRef<FeedItem[]>([])
  const likeInFlightRef = useRef<Record<string, boolean>>({})
  const raceEventLikeInFlightRef = useRef<Record<string, boolean>>({})
  const likeRequestVersionByRunIdRef = useRef<Record<string, number>>({})
  const likeRequestVersionByRaceEventIdRef = useRef<Record<string, number>>({})
  const commentVisibilityByRunIdRef = useRef<Record<string, FeedCommentVisibilityById>>({})
  const firstPageRequestPromiseRef = useRef<Promise<void> | null>(null)
  const firstPageRequestKeyRef = useRef<string>('')
  const restoredSnapshotRef = useRef<FeedRestoreSnapshot | null>(null)
  const prefetchedHrefsRef = useRef<Set<string>>(new Set())

  const getActiveScrollContainer = useCallback(() => {
    if (typeof window === 'undefined') {
      return null
    }

    const rootElement = feedRootRef.current
    let currentElement = rootElement?.parentElement ?? null

    while (currentElement) {
      const style = window.getComputedStyle(currentElement)
      const overflowY = style.overflowY
      const isScrollable = (
        overflowY === 'auto' ||
        overflowY === 'scroll' ||
        overflowY === 'overlay'
      ) && currentElement.scrollHeight > currentElement.clientHeight + 4

      if (isScrollable) {
        return currentElement
      }

      currentElement = currentElement.parentElement
    }

    return window
  }, [])

  useEffect(() => {
    currentUserIdRef.current = currentUserId
  }, [currentUserId])

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const { hasRestoredSnapshot, prepareForRunDetailNavigation } = useRunDetailReturnState<FeedRestoreSnapshot>({
    enabled: Boolean(scrollRestorationKey),
    sourceKey: scrollRestorationKey ?? 'feed-disabled',
    getScrollElement: getActiveScrollContainer,
    getSnapshot: () => ({
      items: itemsRef.current,
      hasMore,
      nextOffset,
      savedAt: Date.now(),
    }),
    onRestoreSnapshot: (snapshot) => {
      restoredSnapshotRef.current = snapshot
      commentVisibilityByRunIdRef.current = {}
      likeInFlightRef.current = {}
      raceEventLikeInFlightRef.current = {}
      itemsRef.current = snapshot.items
      setItems(snapshot.items)
      setHasMore(snapshot.hasMore)
      setNextOffset(snapshot.nextOffset)
      setLikeInFlightByRunId({})
      setLikeInFlightByRaceEventId({})
      setActiveLikesTarget(null)
      setActiveXpRunId(null)
      setFeedError('')
      setInitialLoading(false)
    },
    restoreReady: !initialLoading && items.length > 0,
    debugLabel: 'InfiniteWorkoutFeed',
  })

  const navigateFromFeed = useCallback((href: string) => {
    if (!href) {
      return
    }

    prepareForRunDetailNavigation()
    router.push(href)
  }, [prepareForRunDetailNavigation, router])

  const prefetchHref = useCallback((href: string) => {
    if (!href || prefetchedHrefsRef.current.has(href)) {
      return
    }

    prefetchedHrefsRef.current.add(href)

    try {
      router.prefetch(href)
    } catch {
      prefetchedHrefsRef.current.delete(href)
    }
  }, [router])

  const updateRunItem = useCallback((runId: string, updater: (item: RunFeedItem) => RunFeedItem) => {
    const nextItems = itemsRef.current.map((item) => (
      item.kind === 'run' && item.id === runId ? updater(item) : item
    ))
    itemsRef.current = nextItems
    setItems(nextItems)
  }, [])

  const updateRaceEventItem = useCallback((raceEventId: string, updater: (item: RaceEventFeedItem) => RaceEventFeedItem) => {
    const nextItems = itemsRef.current.map((item) => (
      item.kind === 'race_event' && item.raceEventId === raceEventId ? updater(item) : item
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

  const setRaceEventLikeInFlight = useCallback((raceEventId: string, inFlight: boolean) => {
    raceEventLikeInFlightRef.current[raceEventId] = inFlight
    setLikeInFlightByRaceEventId((prev) => {
      const isCurrentlyInFlight = prev[raceEventId] === true
      if (isCurrentlyInFlight === inFlight) {
        return prev
      }

      const next = { ...prev }
      if (inFlight) {
        next[raceEventId] = true
      } else {
        delete next[raceEventId]
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
      if (commentRow.entity_type !== 'race') {
        return
      }

      const raceEventId = commentRow.entity_id

      if (!raceEventId) {
        return
      }

      const hasLoadedRaceEvent = itemsRef.current.some(
        (item) => item.kind === 'race_event' && item.raceEventId === raceEventId
      )

      if (!hasLoadedRaceEvent) {
        return
      }

      void loadEntityCommentVisibilitySummaryForEntityIds('race', [raceEventId])
        .then((commentSummary) => {
          updateRaceEventItem(raceEventId, (item) => ({
            ...item,
            commentsCount: commentSummary.countsByEntityId[raceEventId] ?? 0,
          }))
        })
        .catch(() => {})

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
  }, [syncRunCommentCount, updateRaceEventItem])

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

    if (restoredSnapshotRef.current) {
      commentVisibilityByRunIdRef.current = {}
      likeInFlightRef.current = {}
      raceEventLikeInFlightRef.current = {}
      itemsRef.current = restoredSnapshotRef.current.items
      setItems(restoredSnapshotRef.current.items)
      setHasMore(restoredSnapshotRef.current.hasMore)
      setNextOffset(restoredSnapshotRef.current.nextOffset)
      setLikeInFlightByRunId({})
      setLikeInFlightByRaceEventId({})
      setActiveLikesTarget(null)
      setActiveXpRunId(null)
      setFeedError('')
      setInitialLoading(false)
      restoredSnapshotRef.current = null
      void loadFirstPage()
      return
    }

    if (hasRestoredSnapshot) {
      return
    }

    firstPageRequestKeyRef.current = feedQueryKey
    firstPageRequestPromiseRef.current = null
    commentVisibilityByRunIdRef.current = {}
    likeInFlightRef.current = {}
    raceEventLikeInFlightRef.current = {}
    setItems([])
    setHasMore(true)
    setNextOffset(0)
    setLikeInFlightByRunId({})
    setLikeInFlightByRaceEventId({})
    setActiveLikesTarget(null)
    setActiveXpRunId(null)
    void loadFirstPage()
  }, [enabled, feedQueryKey, hasRestoredSnapshot, loadFirstPage])

  const navigateToRun = useCallback((runId: string) => {
    if (!runId) {
      return
    }

    navigateFromFeed(`/runs/${runId}`)
  }, [navigateFromFeed])

  const prefetchRun = useCallback((runId: string) => {
    if (!runId) {
      return
    }

    prefetchHref(`/runs/${runId}`)
  }, [prefetchHref])

  const navigateToRaceEvent = useCallback((raceEventId: string) => {
    if (!raceEventId) {
      return
    }

    navigateFromFeed(`/races/${raceEventId}`)
  }, [navigateFromFeed])

  const prefetchRaceEvent = useCallback((raceEventId: string) => {
    if (!raceEventId) {
      return
    }

    prefetchHref(`/races/${raceEventId}`)
  }, [prefetchHref])

  const navigateToProfile = useCallback((href: string) => {
    navigateFromFeed(href)
  }, [navigateFromFeed])

  const prefetchProfile = useCallback((href: string) => {
    prefetchHref(href)
  }, [prefetchHref])

  const navigateToChallenge = useCallback((targetPath: string) => {
    navigateFromFeed(targetPath)
  }, [navigateFromFeed])

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

  useEffect(() => {
    if (!enabled) {
      return
    }

    const unsubscribe = subscribeToRaceEventLikes((payload: RaceEventLikeRealtimePayload) => {
      const activeUserId = currentUserIdRef.current
      if (raceEventLikeInFlightRef.current[payload.raceEventId] && payload.userId === activeUserId) {
        return
      }

      const currentItem = itemsRef.current.find(
        (item): item is RaceEventFeedItem => item.kind === 'race_event' && item.raceEventId === payload.raceEventId
      )

      if (!currentItem) {
        return
      }

      if (payload.eventType === 'INSERT') {
        if (payload.userId === activeUserId) {
          if (currentItem.raceEventLikedByViewer) {
            return
          }

          updateRaceEventItem(payload.raceEventId, (item) => ({
            ...item,
            raceEventLikedByViewer: true,
            raceEventLikeCount: item.raceEventLikeCount + 1,
          }))
          return
        }

        updateRaceEventItem(payload.raceEventId, (item) => ({
          ...item,
          raceEventLikeCount: item.raceEventLikeCount + 1,
        }))
        return
      }

      if (payload.userId === activeUserId) {
        if (!currentItem.raceEventLikedByViewer) {
          return
        }

        updateRaceEventItem(payload.raceEventId, (item) => ({
          ...item,
          raceEventLikedByViewer: false,
          raceEventLikeCount: Math.max(0, item.raceEventLikeCount - 1),
        }))
        return
      }

      updateRaceEventItem(payload.raceEventId, (item) => ({
        ...item,
        raceEventLikeCount: Math.max(0, item.raceEventLikeCount - 1),
      }))
    })

    return () => {
      unsubscribe()
    }
  }, [enabled, updateRaceEventItem])

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

  const handleRaceEventLikeToggle = useCallback(async (raceEventId: string) => {
    const activeUserId = currentUserIdRef.current

    if (!activeUserId) {
      router.replace('/login')
      return
    }

    const currentItem = itemsRef.current.find(
      (item): item is RaceEventFeedItem => item.kind === 'race_event' && item.raceEventId === raceEventId
    )

    if (!currentItem) return
    if (raceEventLikeInFlightRef.current[raceEventId]) return
    if (currentItem.user_id === activeUserId) return

    const wasLiked = currentItem.raceEventLikedByViewer
    const previousItems = itemsRef.current
    const nextRequestVersion = (likeRequestVersionByRaceEventIdRef.current[raceEventId] ?? 0) + 1
    likeRequestVersionByRaceEventIdRef.current[raceEventId] = nextRequestVersion

    try {
      setRaceEventLikeInFlight(raceEventId, true)

      updateRaceEventItem(raceEventId, (item) => ({
        ...item,
        raceEventLikedByViewer: !wasLiked,
        raceEventLikeCount: Math.max(0, item.raceEventLikeCount + (wasLiked ? -1 : 1)),
      }))

      void toggleRaceEventLike(raceEventId)
        .then(({ error: likeError, liked, likeCount }) => {
          if (likeRequestVersionByRaceEventIdRef.current[raceEventId] !== nextRequestVersion) {
            return
          }

          if (likeError || liked == null || likeCount == null) {
            itemsRef.current = previousItems
            setItems(previousItems)
            return
          }

          updateRaceEventItem(raceEventId, (item) => ({
            ...item,
            raceEventLikedByViewer: liked,
            raceEventLikeCount: Math.max(0, likeCount),
          }))
        })
        .catch(() => {
          if (likeRequestVersionByRaceEventIdRef.current[raceEventId] !== nextRequestVersion) {
            return
          }

          itemsRef.current = previousItems
          setItems(previousItems)
        })
        .finally(() => {
          setRaceEventLikeInFlight(raceEventId, false)
        })
    } catch {
      setRaceEventLikeInFlight(raceEventId, false)
      itemsRef.current = previousItems
      setItems(previousItems)
    }
  }, [router, setRaceEventLikeInFlight, updateRaceEventItem])

  const loadLikedUsersForRun = useCallback(async (runId: string, force = false) => {
    if (!runId) {
      return
    }

    if (!force && (
      Object.prototype.hasOwnProperty.call(likedUsersByRunId, runId) ||
      likedUsersLoadingRunId === runId
    )) {
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
  }, [likedUsersByRunId, likedUsersLoadingRunId])

  const loadLikedUsersForRaceEvent = useCallback(async (raceEventId: string, force = false) => {
    if (!raceEventId) {
      return
    }

    if (!force && (
      Object.prototype.hasOwnProperty.call(likedUsersByRaceEventId, raceEventId) ||
      likedUsersLoadingRaceEventId === raceEventId
    )) {
      return
    }

    setLikedUsersLoadingRaceEventId(raceEventId)
    setLikedUsersErrorByRaceEventId((prev) => ({
      ...prev,
      [raceEventId]: '',
    }))

    try {
      const likedUsers = await loadRaceEventLikedUsers(raceEventId)
      setLikedUsersByRaceEventId((prev) => ({
        ...prev,
        [raceEventId]: likedUsers,
      }))
    } catch {
      setLikedUsersErrorByRaceEventId((prev) => ({
        ...prev,
        [raceEventId]: 'Не удалось загрузить лайки',
      }))
    } finally {
      setLikedUsersLoadingRaceEventId((currentRaceEventId) => (currentRaceEventId === raceEventId ? null : currentRaceEventId))
    }
  }, [likedUsersByRaceEventId, likedUsersLoadingRaceEventId])

  const handleCommentClick = useCallback((runId: string) => {
    if (!runId) {
      return
    }

    if (onCommentClick) {
      onCommentClick(runId)
      return
    }

    setActiveLikesTarget(null)
    navigateFromFeed(`/runs/${runId}/discussion`)
  }, [navigateFromFeed, onCommentClick])

  const handleRaceEventCommentClick = useCallback((raceEventId: string) => {
    if (!raceEventId) {
      return
    }

    navigateToRaceEvent(raceEventId)
  }, [navigateToRaceEvent])

  const handleOpenLikes = useCallback((item: FeedRunItem) => {
    setActiveLikesTarget({
      type: 'run',
      id: item.id,
    })

    const shouldForceReload =
      item.likesCount > 0 &&
      ((likedUsersByRunId[item.id]?.length ?? 0) === 0)

    void loadLikedUsersForRun(item.id, shouldForceReload)
  }, [likedUsersByRunId, loadLikedUsersForRun])

  const handleOpenRaceEventLikes = useCallback((item: FeedRaceEventItem) => {
    setActiveLikesTarget({
      type: 'race_event',
      id: item.raceEventId,
    })

    const shouldForceReload =
      item.raceEventLikeCount > 0 &&
      ((likedUsersByRaceEventId[item.raceEventId]?.length ?? 0) === 0)

    void loadLikedUsersForRaceEvent(item.raceEventId, shouldForceReload)
  }, [likedUsersByRaceEventId, loadLikedUsersForRaceEvent])

  const error = feedError
  const activeLikesRunId = activeLikesTarget?.type === 'run' ? activeLikesTarget.id : ''
  const activeLikesRaceEventId = activeLikesTarget?.type === 'race_event' ? activeLikesTarget.id : ''
  const activeLikesRunItem = activeLikesRunId
    ? items.find((item): item is RunFeedItem => item.kind === 'run' && item.id === activeLikesRunId) ?? null
    : null
  const activeLikesRaceEventItem = activeLikesRaceEventId
    ? items.find((item): item is RaceEventFeedItem => item.kind === 'race_event' && item.raceEventId === activeLikesRaceEventId) ?? null
    : null
  const activeXpRunItem = activeXpRunId
    ? items.find((item): item is RunFeedItem => item.kind === 'run' && item.id === activeXpRunId) ?? null
    : null
  const activeLikedUsers = activeLikesTarget?.type === 'run'
    ? (activeLikesRunId ? likedUsersByRunId[activeLikesRunId] ?? [] : [])
    : (activeLikesRaceEventId ? likedUsersByRaceEventId[activeLikesRaceEventId] ?? [] : [])
  const activeLikesError = activeLikesTarget?.type === 'run'
    ? (activeLikesRunId ? likedUsersErrorByRunId[activeLikesRunId] ?? '' : '')
    : (activeLikesRaceEventId ? likedUsersErrorByRaceEventId[activeLikesRaceEventId] ?? '' : '')
  const activeLikesCount = activeLikesTarget?.type === 'run'
    ? (activeLikesRunItem?.likesCount ?? 0)
    : (activeLikesRaceEventItem?.raceEventLikeCount ?? 0)
  const activeLikesLoading = activeLikesTarget?.type === 'run'
    ? likedUsersLoadingRunId === activeLikesRunId
    : likedUsersLoadingRaceEventId === activeLikesRaceEventId

  return (
    <>
      <div ref={feedRootRef} className="min-h-[236px] space-y-4 pb-2">
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
                shoeId={item.shoe_id}
                city={item.city}
                country={item.country}
                description={item.description}
                externalSource={item.external_source}
                distanceKm={item.distance_km}
                pace={item.pace}
                movingTime={item.movingTime}
                mapPolyline={item.map_polyline}
                xp={item.xp}
                xpBreakdownRows={item.xpBreakdownRows}
                createdAt={item.created_at}
                displayName={item.displayName}
                avatarUrl={item.avatar_url}
                level={getLevelFromXP(item.totalXp).level}
                likesCount={item.likesCount}
                commentsCount={item.commentsCount}
                likedByMe={item.likedByMe}
                insight={item.insight}
                isOwnRun={item.user_id === currentUserId}
                isLikeInFlight={Boolean(likeInFlightByRunId[item.id])}
                photos={item.photos}
                onToggleLike={handleLikeToggle}
                onOpenLikes={() => handleOpenLikes(item)}
                onOpenLikesPreview={() => {
                  if (item.likesCount > 0) {
                    void loadLikedUsersForRun(item.id)
                  }
                }}
                onCommentClick={handleCommentClick}
                onNavigateToRun={navigateToRun}
                onPrefetchRun={prefetchRun}
                profileHref={`/users/${item.user_id}`}
                onNavigateToProfile={navigateToProfile}
                onPrefetchProfile={prefetchProfile}
                onOpenXpBreakdown={() => setActiveXpRunId(item.id)}
              />
            ) : item.kind === 'race_event' ? (
              <RaceFeedCard
                key={item.id}
                item={item}
                isLikeInFlight={Boolean(likeInFlightByRaceEventId[item.raceEventId])}
                onCommentClick={handleRaceEventCommentClick}
                onOpenLikes={() => handleOpenRaceEventLikes(item)}
                onOpenLikesPreview={() => {
                  if (item.raceEventLikeCount > 0) {
                    void loadLikedUsersForRaceEvent(item.raceEventId)
                  }
                }}
                onPrefetchProfile={prefetchProfile}
                onPrefetchRaceEvent={prefetchRaceEvent}
                onOpenProfile={navigateToProfile}
                onOpenRaceEvent={navigateToRaceEvent}
                onToggleLike={handleRaceEventLikeToggle}
              />
            ) : (
              <ChallengeFeedCard
                key={item.id}
                item={item}
                onPrefetchProfile={prefetchProfile}
                onOpenProfile={navigateToProfile}
                onOpenChallenge={navigateToChallenge}
              />
            )
          ))
        )}
        {loadingMore ? (
          <p className="app-text-secondary py-3 text-center text-sm">Загружаем еще...</p>
        ) : null}
        {hasMore && items.length > 0 ? <div ref={loadMoreRef} className="h-1" aria-hidden="true" /> : null}
      </div>

      <RunLikesSheet
        open={Boolean(activeLikesTarget)}
        likesCount={activeLikesCount}
        loading={activeLikesLoading}
        error={activeLikesError}
        users={activeLikedUsers}
        onClose={() => setActiveLikesTarget(null)}
        onRetry={() => {
          if (activeLikesTarget?.type === 'run' && activeLikesRunId) {
            void loadLikedUsersForRun(activeLikesRunId, true)
          }

          if (activeLikesTarget?.type === 'race_event' && activeLikesRaceEventId) {
            void loadLikedUsersForRaceEvent(activeLikesRaceEventId, true)
          }
        }}
        onSelectUser={(userId) => navigateFromFeed(`/users/${userId}`)}
      />
      <RunXpBreakdownSheet
        open={Boolean(activeXpRunItem)}
        title={activeXpRunItem ? `XP: ${activeXpRunItem.title}` : 'XP за тренировку'}
        rows={activeXpRunItem?.xpBreakdownRows ?? []}
        onClose={() => setActiveXpRunId(null)}
      />
    </>
  )
}
