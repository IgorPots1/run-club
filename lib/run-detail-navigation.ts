'use client'

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'

const RUN_DETAIL_RETURN_ENTRY_ID_HISTORY_STATE_KEY = 'runDetailReturnEntryId'
const RUN_DETAIL_SOURCE_HREF_HISTORY_STATE_KEY = 'runDetailSourceHref'
const RUN_DETAIL_SOURCE_KEY_HISTORY_STATE_KEY = 'runDetailSourceKey'
const RUN_DETAIL_PENDING_SOURCE_STORAGE_KEY = 'run-detail:pending-source'
const RUN_DETAIL_SOURCE_MAX_AGE_MS = 5 * 60 * 1000

type ScrollContainer = Window | HTMLElement
type RunDetailPendingSourceSnapshot = {
  sourceHref: string
  sourceKey: string
  savedAt: number
}

export type SeededRunDetailPhoto = {
  id: string
  public_url: string
  thumbnail_url: string | null
}

export type SeededRunDetailPayload = {
  runId: string
  title: string
  displayName: string
  avatar_url: string | null
  created_at: string
  distance_km: number
  pace: string | number | null
  movingTime: string | null
  city: string | null
  country: string | null
  map_polyline: string | null
  photos: SeededRunDetailPhoto[]
  likesCount: number
  commentsCount: number
  likedByMe: boolean
  xp?: number | null
  linkedRaceEvent?: {
    id: string
    name: string
    raceDate: string
    resultTimeSeconds: number | null
    targetTimeSeconds: number | null
  } | null
}

type RunDetailReturnPayload<TSnapshot> = {
  entryId: string
  sourceKey: string
  sourceHref: string
  scrollTop: number
  scrollAnchor: RunDetailScrollAnchor | null
  snapshot?: TSnapshot
  savedAt: number
}

type RunDetailScrollAnchor = {
  itemId: string
  offsetTop: number
}

type RunDetailConsumedRestore<TSnapshot> = {
  sourceHref: string | null
  snapshot: TSnapshot | null
  scrollTop: number
  scrollAnchor: RunDetailScrollAnchor | null
  shouldRestoreScroll: boolean
  skipReason: string | null
}

type UseRunDetailReturnStateOptions<TSnapshot> = {
  enabled?: boolean
  sourceKey: string
  sourceHref?: string
  scrollContainerRef?: RefObject<HTMLElement | null>
  getScrollElement?: () => ScrollContainer | null
  getScrollAnchor?: (scrollElement: ScrollContainer | null) => RunDetailScrollAnchor | null
  restoreScrollFromAnchor?: (scrollElement: ScrollContainer | null, anchor: RunDetailScrollAnchor) => boolean
  measureScrollAnchorError?: (scrollElement: ScrollContainer | null, anchor: RunDetailScrollAnchor) => number | null
  getSnapshot?: () => TSnapshot
  onRestoreSnapshot?: (snapshot: TSnapshot) => void
  restoreReady?: boolean
  debugLabel?: string
}

const RESTORE_SCROLL_CORRECTION_THRESHOLD_PX = 1
const RESTORE_LAYOUT_SETTLE_FRAMES = 2
const SEEDED_RUN_DETAIL_MAX_AGE_MS = 2 * 60 * 1000
const seededRunDetailStore = new Map<string, { payload: SeededRunDetailPayload; savedAt: number }>()

function pruneSeededRunDetailStore() {
  const now = Date.now()

  for (const [runId, entry] of seededRunDetailStore.entries()) {
    if (now - entry.savedAt > SEEDED_RUN_DETAIL_MAX_AGE_MS) {
      seededRunDetailStore.delete(runId)
    }
  }
}

function isRelativeAppHref(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
}

function isFreshTimestamp(value: unknown, maxAgeMs: number) {
  return Number.isFinite(value) && Date.now() - Number(value) <= maxAgeMs
}

function isValidScrollAnchor(value: unknown): value is RunDetailScrollAnchor {
  if (!value || typeof value !== 'object') {
    return false
  }

  const itemId = (value as RunDetailScrollAnchor).itemId
  const offsetTop = (value as RunDetailScrollAnchor).offsetTop

  return typeof itemId === 'string' && itemId.length > 0 && Number.isFinite(offsetTop)
}

function getReturnSnapshotStorageKey(sourceKey: string) {
  return `run-detail:return:${sourceKey}:snapshot`
}

function getReturnPendingStorageKey(sourceKey: string) {
  return `run-detail:return:${sourceKey}:pending-entry-id`
}

function getRestoreEntryKey(sourceKey: string, entryId: string) {
  return `${sourceKey}:${entryId}`
}

function readScrollTop(scrollElement: ScrollContainer | null) {
  if (!scrollElement) {
    return 0
  }

  if (scrollElement instanceof HTMLElement) {
    return scrollElement.scrollTop
  }

  return scrollElement.scrollY || scrollElement.pageYOffset || 0
}

function writeScrollTop(scrollElement: ScrollContainer | null, scrollTop: number) {
  if (!scrollElement) {
    return
  }

  if (scrollElement === window) {
    window.scrollTo({ top: scrollTop, behavior: 'auto' })
    return
  }

  scrollElement.scrollTo({ top: scrollTop, behavior: 'auto' })
}

function waitForAnimationFrames(frameCount: number, callback: () => void) {
  if (typeof window === 'undefined') {
    callback()
    return null
  }

  let remainingFrames = Math.max(0, Math.floor(frameCount))
  let frameId: number | null = null

  if (remainingFrames === 0) {
    callback()
    return null
  }

  const scheduleNextFrame = () => {
    frameId = window.requestAnimationFrame(() => {
      remainingFrames -= 1

      if (remainingFrames <= 0) {
        callback()
        return
      }

      scheduleNextFrame()
    })
  }

  scheduleNextFrame()
  return () => {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId)
    }
  }
}

function readPendingSourceFromStorage() {
  if (typeof window === 'undefined') {
    return null
  }

  const rawValue = window.sessionStorage.getItem(RUN_DETAIL_PENDING_SOURCE_STORAGE_KEY)

  if (!rawValue) {
    return null
  }

  try {
    const parsedValue = JSON.parse(rawValue) as Partial<RunDetailPendingSourceSnapshot>

    if (
      !isRelativeAppHref(parsedValue.sourceHref) ||
      typeof parsedValue.sourceKey !== 'string' ||
      parsedValue.sourceKey.length === 0 ||
      !isFreshTimestamp(parsedValue.savedAt, RUN_DETAIL_SOURCE_MAX_AGE_MS)
    ) {
      window.sessionStorage.removeItem(RUN_DETAIL_PENDING_SOURCE_STORAGE_KEY)
      return null
    }

    return {
      sourceHref: parsedValue.sourceHref,
      sourceKey: parsedValue.sourceKey,
      savedAt: Number(parsedValue.savedAt),
    }
  } catch {
    window.sessionStorage.removeItem(RUN_DETAIL_PENDING_SOURCE_STORAGE_KEY)
    return null
  }
}

function writePendingSourceToStorage(sourceKey: string, sourceHref: string) {
  if (typeof window === 'undefined' || !isRelativeAppHref(sourceHref)) {
    return
  }

  const payload: RunDetailPendingSourceSnapshot = {
    sourceHref,
    sourceKey,
    savedAt: Date.now(),
  }

  window.sessionStorage.setItem(RUN_DETAIL_PENDING_SOURCE_STORAGE_KEY, JSON.stringify(payload))
}

function ensureHistoryEntryId() {
  if (typeof window === 'undefined') {
    return ''
  }

  const currentHistoryState = window.history.state ?? {}
  const existingEntryId = currentHistoryState?.[RUN_DETAIL_RETURN_ENTRY_ID_HISTORY_STATE_KEY]

  if (typeof existingEntryId === 'string' && existingEntryId.length > 0) {
    return existingEntryId
  }

  const nextEntryId = `${Date.now()}:${Math.random().toString(36).slice(2)}`
  window.history.replaceState(
    {
      ...currentHistoryState,
      [RUN_DETAIL_RETURN_ENTRY_ID_HISTORY_STATE_KEY]: nextEntryId,
    },
    '',
    window.location.href
  )

  return nextEntryId
}

function consumeRunDetailReturnPayload<TSnapshot>(sourceKey: string, entryId: string): RunDetailConsumedRestore<TSnapshot> {
  if (typeof window === 'undefined') {
    return {
      sourceHref: null,
      snapshot: null,
      scrollTop: 0,
      scrollAnchor: null,
      shouldRestoreScroll: false,
      skipReason: 'window-unavailable',
    }
  }

  const pendingStorageKey = getReturnPendingStorageKey(sourceKey)
  const snapshotStorageKey = getReturnSnapshotStorageKey(sourceKey)
  const pendingEntryId = window.sessionStorage.getItem(pendingStorageKey)

  if (pendingEntryId !== entryId) {
    if (pendingEntryId && pendingEntryId !== entryId) {
      window.sessionStorage.removeItem(pendingStorageKey)
      window.sessionStorage.removeItem(snapshotStorageKey)
      return {
        sourceHref: null,
        snapshot: null,
        scrollTop: 0,
        scrollAnchor: null,
        shouldRestoreScroll: false,
        skipReason: 'history-entry-mismatch',
      }
    }

    return {
      sourceHref: null,
      snapshot: null,
      scrollTop: 0,
      scrollAnchor: null,
      shouldRestoreScroll: false,
      skipReason: 'no-pending-restore',
    }
  }

  window.sessionStorage.removeItem(pendingStorageKey)

  const rawSnapshot = window.sessionStorage.getItem(snapshotStorageKey)
  window.sessionStorage.removeItem(snapshotStorageKey)

  if (!rawSnapshot) {
    return {
      sourceHref: null,
      snapshot: null,
      scrollTop: 0,
      scrollAnchor: null,
      shouldRestoreScroll: false,
      skipReason: 'missing-snapshot',
    }
  }

  try {
    const parsedSnapshot = JSON.parse(rawSnapshot) as Partial<RunDetailReturnPayload<TSnapshot>>

    if (parsedSnapshot.entryId !== entryId) {
      return {
        sourceHref: null,
        snapshot: null,
        scrollTop: 0,
        scrollAnchor: null,
        shouldRestoreScroll: false,
        skipReason: 'snapshot-entry-mismatch',
      }
    }

    if (!isRelativeAppHref(parsedSnapshot.sourceHref)) {
      return {
        sourceHref: null,
        snapshot: null,
        scrollTop: 0,
        scrollAnchor: null,
        shouldRestoreScroll: false,
        skipReason: 'invalid-source-href',
      }
    }

    return {
      sourceHref: parsedSnapshot.sourceHref,
      snapshot: parsedSnapshot.snapshot ?? null,
      scrollTop: Number.isFinite(parsedSnapshot.scrollTop) ? Number(parsedSnapshot.scrollTop) : 0,
      scrollAnchor: isValidScrollAnchor(parsedSnapshot.scrollAnchor) ? parsedSnapshot.scrollAnchor : null,
      shouldRestoreScroll: true,
      skipReason: null,
    }
  } catch {
    return {
      sourceHref: null,
      snapshot: null,
      scrollTop: 0,
      scrollAnchor: null,
      shouldRestoreScroll: false,
      skipReason: 'invalid-snapshot',
    }
  }
}

function setRunDetailSourceInHistoryState(sourceHref: string, sourceKey: string) {
  if (typeof window === 'undefined' || !isRelativeAppHref(sourceHref)) {
    return
  }

  const currentHistoryState = window.history.state ?? {}

  if (
    currentHistoryState?.[RUN_DETAIL_SOURCE_HREF_HISTORY_STATE_KEY] === sourceHref &&
    currentHistoryState?.[RUN_DETAIL_SOURCE_KEY_HISTORY_STATE_KEY] === sourceKey
  ) {
    return
  }

  window.history.replaceState(
    {
      ...currentHistoryState,
      [RUN_DETAIL_SOURCE_HREF_HISTORY_STATE_KEY]: sourceHref,
      [RUN_DETAIL_SOURCE_KEY_HISTORY_STATE_KEY]: sourceKey,
    },
    '',
    window.location.href
  )
}

export function getCurrentAppHref() {
  if (typeof window === 'undefined') {
    return '/'
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

export function hydrateRunDetailSourceHistoryState() {
  if (typeof window === 'undefined') {
    return null
  }

  const historySourceHref = window.history.state?.[RUN_DETAIL_SOURCE_HREF_HISTORY_STATE_KEY]
  const historySourceKey = window.history.state?.[RUN_DETAIL_SOURCE_KEY_HISTORY_STATE_KEY]

  if (isRelativeAppHref(historySourceHref) && typeof historySourceKey === 'string' && historySourceKey.length > 0) {
    return {
      href: historySourceHref,
      sourceKey: historySourceKey,
      savedAt: Date.now(),
    }
  }

  const pendingSource = readPendingSourceFromStorage()

  if (!pendingSource) {
    return null
  }

  setRunDetailSourceInHistoryState(pendingSource.sourceHref, pendingSource.sourceKey)
  window.sessionStorage.removeItem(RUN_DETAIL_PENDING_SOURCE_STORAGE_KEY)

  return {
    href: pendingSource.sourceHref,
    sourceKey: pendingSource.sourceKey,
    savedAt: pendingSource.savedAt,
  }
}

export function readRunDetailSource() {
  if (typeof window === 'undefined') {
    return null
  }

  const historySourceHref = window.history.state?.[RUN_DETAIL_SOURCE_HREF_HISTORY_STATE_KEY]
  const historySourceKey = window.history.state?.[RUN_DETAIL_SOURCE_KEY_HISTORY_STATE_KEY]

  if (isRelativeAppHref(historySourceHref) && typeof historySourceKey === 'string' && historySourceKey.length > 0) {
    return {
      href: historySourceHref,
      sourceKey: historySourceKey,
      savedAt: Date.now(),
    }
  }

  return hydrateRunDetailSourceHistoryState()
}

export function saveSeededRunDetail(payload: SeededRunDetailPayload) {
  if (!payload.runId) {
    return
  }

  pruneSeededRunDetailStore()
  seededRunDetailStore.set(payload.runId, {
    payload,
    savedAt: Date.now(),
  })
}

export function consumeSeededRunDetail(runId: string) {
  if (!runId) {
    return null
  }

  pruneSeededRunDetailStore()
  const entry = seededRunDetailStore.get(runId) ?? null

  if (!entry) {
    return null
  }

  seededRunDetailStore.delete(runId)
  return entry.payload
}

export function useRunDetailReturnState<TSnapshot>({
  enabled = true,
  sourceKey,
  sourceHref,
  scrollContainerRef,
  getScrollElement,
  getScrollAnchor,
  restoreScrollFromAnchor,
  measureScrollAnchorError,
  getSnapshot,
  onRestoreSnapshot,
  restoreReady = true,
  debugLabel = 'RunDetailReturnState',
}: UseRunDetailReturnStateOptions<TSnapshot>) {
  const [hasRestoredSnapshot, setHasRestoredSnapshot] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [skipReason, setSkipReason] = useState<string | null>(enabled ? 'pending-check' : 'restoration-disabled')
  const pendingRestoreRef = useRef<RunDetailConsumedRestore<TSnapshot> | null>(null)
  const restoreEntryKeyRef = useRef<string | null>(null)
  const hasAppliedRestoreRef = useRef(false)
  const hasLoggedRestorePreparationRef = useRef(false)
  const hasLoggedRestoreCompletionRef = useRef(false)
  const onRestoreSnapshotRef = useRef(onRestoreSnapshot)
  const restoreCleanupFrameRef = useRef<number | null>(null)
  const cancelScheduledRestoreRef = useRef<(() => void) | null>(null)

  useLayoutEffect(() => {
    onRestoreSnapshotRef.current = onRestoreSnapshot
  }, [onRestoreSnapshot])

  const resolveScrollElement = useCallback(() => {
    const scrollElement = scrollContainerRef?.current ?? getScrollElement?.() ?? (typeof window !== 'undefined' ? window : null)
    return scrollElement
  }, [getScrollElement, scrollContainerRef])

  const resolvedSourceHref = useMemo(
    () => sourceHref ?? getCurrentAppHref(),
    [sourceHref]
  )

  useLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const entryId = ensureHistoryEntryId()

    if (!enabled) {
      cancelScheduledRestoreRef.current?.()
      cancelScheduledRestoreRef.current = null
      if (restoreCleanupFrameRef.current !== null) {
        window.cancelAnimationFrame(restoreCleanupFrameRef.current)
        restoreCleanupFrameRef.current = null
      }
      pendingRestoreRef.current = null
      restoreEntryKeyRef.current = null
      hasAppliedRestoreRef.current = false
      hasLoggedRestorePreparationRef.current = false
      hasLoggedRestoreCompletionRef.current = false
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsRestoring(false)
      return
    }

    const restoreEntryKey = getRestoreEntryKey(sourceKey, entryId)

    if (restoreEntryKeyRef.current !== restoreEntryKey) {
      const nextRestore = consumeRunDetailReturnPayload<TSnapshot>(sourceKey, entryId)
      pendingRestoreRef.current = nextRestore
      restoreEntryKeyRef.current = restoreEntryKey
      hasAppliedRestoreRef.current = false
      hasLoggedRestorePreparationRef.current = false
      hasLoggedRestoreCompletionRef.current = false
      setHasRestoredSnapshot(nextRestore.snapshot !== null)
      setIsRestoring(nextRestore.shouldRestoreScroll)
      setSkipReason(nextRestore.skipReason)

      if (nextRestore.shouldRestoreScroll) {
        console.info(`[${debugLabel}] prepared restore`, {
          sourceKey,
          sourceHref: nextRestore.sourceHref,
          scrollTop: nextRestore.scrollTop,
          scrollAnchor: nextRestore.scrollAnchor,
          hasSnapshot: nextRestore.snapshot !== null,
        })
      } else {
        console.info(`[${debugLabel}] restore skipped`, {
          sourceKey,
          reason: nextRestore.skipReason ?? 'no-pending-restore',
        })
      }

      hasLoggedRestorePreparationRef.current = true
    }

    const pendingRestore = pendingRestoreRef.current

    if (!hasAppliedRestoreRef.current) {
      const snapshot = pendingRestore?.snapshot ?? null

      if (snapshot !== null) {
        onRestoreSnapshotRef.current?.(snapshot)
      }

      hasAppliedRestoreRef.current = true
    }
  }, [debugLabel, enabled, sourceKey])

  useLayoutEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return
    }

    const pendingRestore = pendingRestoreRef.current

    if (!pendingRestore?.shouldRestoreScroll || !restoreReady) {
      return
    }

    const scrollElement = resolveScrollElement()

    if (!scrollElement) {
      return
    }

    if (restoreCleanupFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreCleanupFrameRef.current)
      restoreCleanupFrameRef.current = null
    }
    cancelScheduledRestoreRef.current?.()
    cancelScheduledRestoreRef.current = null

    pendingRestore.shouldRestoreScroll = false
    cancelScheduledRestoreRef.current = waitForAnimationFrames(RESTORE_LAYOUT_SETTLE_FRAMES, () => {
      cancelScheduledRestoreRef.current = null
      restoreCleanupFrameRef.current = null

      const restoredWithAnchor = pendingRestore.scrollAnchor
        ? (restoreScrollFromAnchor?.(scrollElement, pendingRestore.scrollAnchor) ?? false)
        : false

      if (!restoredWithAnchor) {
        writeScrollTop(scrollElement, pendingRestore.scrollTop)
        setIsRestoring(false)

        if (!hasLoggedRestoreCompletionRef.current) {
          console.info(`[${debugLabel}] restored scroll`, {
            sourceKey,
            method: 'scrollTop',
            scrollTop: pendingRestore.scrollTop,
            scrollAnchor: pendingRestore.scrollAnchor,
          })
          hasLoggedRestoreCompletionRef.current = true
        }

        return
      }

      restoreCleanupFrameRef.current = window.requestAnimationFrame(() => {
        restoreCleanupFrameRef.current = null

        const anchor = pendingRestore.scrollAnchor
        const anchorError = anchor ? measureScrollAnchorError?.(scrollElement, anchor) ?? null : null
        const shouldRunSecondPass = anchorError != null &&
          Math.abs(anchorError) > RESTORE_SCROLL_CORRECTION_THRESHOLD_PX

        if (shouldRunSecondPass && anchor) {
          restoreScrollFromAnchor?.(scrollElement, anchor)
        }

        if (!hasLoggedRestoreCompletionRef.current) {
          console.info(`[${debugLabel}] restored scroll`, {
            sourceKey,
            method: 'anchor',
            scrollTop: pendingRestore.scrollTop,
            scrollAnchor: pendingRestore.scrollAnchor,
            secondPassApplied: shouldRunSecondPass,
            anchorError,
          })
          hasLoggedRestoreCompletionRef.current = true
        }

        setIsRestoring(false)
      })
    })

    return () => {
      cancelScheduledRestoreRef.current?.()
      cancelScheduledRestoreRef.current = null
      if (restoreCleanupFrameRef.current !== null) {
        window.cancelAnimationFrame(restoreCleanupFrameRef.current)
        restoreCleanupFrameRef.current = null
      }
    }
  }, [
    debugLabel,
    enabled,
    measureScrollAnchorError,
    resolveScrollElement,
    restoreReady,
    restoreScrollFromAnchor,
    sourceKey,
  ])

  const prepareForRunDetailNavigation = useCallback(() => {
    if (!enabled || typeof window === 'undefined') {
      return
    }

    const entryId = ensureHistoryEntryId()
    const scrollElement = resolveScrollElement()
    const scrollTop = readScrollTop(scrollElement)
    const scrollAnchor = getScrollAnchor?.(scrollElement) ?? null
    const snapshot = getSnapshot?.()
    const payload: RunDetailReturnPayload<TSnapshot> = {
      entryId,
      sourceKey,
      sourceHref: resolvedSourceHref,
      scrollTop,
      scrollAnchor,
      snapshot,
      savedAt: Date.now(),
    }

    window.sessionStorage.setItem(getReturnPendingStorageKey(sourceKey), entryId)
    window.sessionStorage.setItem(getReturnSnapshotStorageKey(sourceKey), JSON.stringify(payload))
    writePendingSourceToStorage(sourceKey, resolvedSourceHref)

    console.info(`[${debugLabel}] saved return state`, {
      sourceKey,
      sourceHref: resolvedSourceHref,
      scrollTop,
      scrollAnchor,
      hasSnapshot: snapshot !== undefined,
    })
  }, [
    debugLabel,
    enabled,
    getScrollAnchor,
    getSnapshot,
    resolveScrollElement,
    resolvedSourceHref,
    sourceKey,
  ])

  return {
    hasRestoredSnapshot: enabled ? hasRestoredSnapshot : false,
    isRestoring: enabled ? isRestoring : false,
    skipReason: enabled ? skipReason : 'restoration-disabled',
    prepareForRunDetailNavigation,
  }
}
