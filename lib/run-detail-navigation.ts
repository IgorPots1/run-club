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

type RunDetailReturnPayload<TSnapshot> = {
  entryId: string
  sourceKey: string
  sourceHref: string
  scrollTop: number
  snapshot?: TSnapshot
  savedAt: number
}

type RunDetailConsumedRestore<TSnapshot> = {
  sourceHref: string | null
  snapshot: TSnapshot | null
  scrollTop: number
  shouldRestoreScroll: boolean
  skipReason: string | null
}

type UseRunDetailReturnStateOptions<TSnapshot> = {
  enabled?: boolean
  sourceKey: string
  sourceHref?: string
  scrollContainerRef?: RefObject<HTMLElement | null>
  getScrollElement?: () => ScrollContainer | null
  getSnapshot?: () => TSnapshot
  onRestoreSnapshot?: (snapshot: TSnapshot) => void
  restoreReady?: boolean
  debugLabel?: string
}

function isRelativeAppHref(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
}

function isFreshTimestamp(value: unknown, maxAgeMs: number) {
  return Number.isFinite(value) && Date.now() - Number(value) <= maxAgeMs
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
        shouldRestoreScroll: false,
        skipReason: 'history-entry-mismatch',
      }
    }

    return {
      sourceHref: null,
      snapshot: null,
      scrollTop: 0,
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
        shouldRestoreScroll: false,
        skipReason: 'snapshot-entry-mismatch',
      }
    }

    if (!isRelativeAppHref(parsedSnapshot.sourceHref)) {
      return {
        sourceHref: null,
        snapshot: null,
        scrollTop: 0,
        shouldRestoreScroll: false,
        skipReason: 'invalid-source-href',
      }
    }

    return {
      sourceHref: parsedSnapshot.sourceHref,
      snapshot: parsedSnapshot.snapshot ?? null,
      scrollTop: Number.isFinite(parsedSnapshot.scrollTop) ? Number(parsedSnapshot.scrollTop) : 0,
      shouldRestoreScroll: true,
      skipReason: null,
    }
  } catch {
    return {
      sourceHref: null,
      snapshot: null,
      scrollTop: 0,
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

export function useRunDetailReturnState<TSnapshot>({
  enabled = true,
  sourceKey,
  sourceHref,
  scrollContainerRef,
  getScrollElement,
  getSnapshot,
  onRestoreSnapshot,
  restoreReady = true,
  debugLabel = 'RunDetailReturnState',
}: UseRunDetailReturnStateOptions<TSnapshot>) {
  const [hasRestoredSnapshot, setHasRestoredSnapshot] = useState(false)
  const [skipReason, setSkipReason] = useState<string | null>(enabled ? 'pending-check' : 'restoration-disabled')
  const pendingRestoreRef = useRef<RunDetailConsumedRestore<TSnapshot> | null>(null)
  const restoreEntryKeyRef = useRef<string | null>(null)
  const hasAppliedRestoreRef = useRef(false)
  const hasLoggedRestorePreparationRef = useRef(false)
  const hasLoggedRestoreCompletionRef = useRef(false)
  const onRestoreSnapshotRef = useRef(onRestoreSnapshot)

  onRestoreSnapshotRef.current = onRestoreSnapshot

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
      pendingRestoreRef.current = null
      restoreEntryKeyRef.current = null
      hasAppliedRestoreRef.current = false
      hasLoggedRestorePreparationRef.current = false
      hasLoggedRestoreCompletionRef.current = false
      setHasRestoredSnapshot(false)
      setSkipReason('restoration-disabled')
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
      setSkipReason(nextRestore.skipReason)

      if (nextRestore.shouldRestoreScroll) {
        console.info(`[${debugLabel}] prepared restore`, {
          sourceKey,
          sourceHref: nextRestore.sourceHref,
          scrollTop: nextRestore.scrollTop,
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

    pendingRestore.shouldRestoreScroll = false
    writeScrollTop(scrollElement, pendingRestore.scrollTop)

    if (!hasLoggedRestoreCompletionRef.current) {
      console.info(`[${debugLabel}] restored scroll`, {
        sourceKey,
        scrollTop: pendingRestore.scrollTop,
      })
      hasLoggedRestoreCompletionRef.current = true
    }
  }, [debugLabel, enabled, resolveScrollElement, restoreReady, sourceKey])

  const prepareForRunDetailNavigation = useCallback(() => {
    if (!enabled || typeof window === 'undefined') {
      return
    }

    const entryId = ensureHistoryEntryId()
    const scrollTop = readScrollTop(resolveScrollElement())
    const snapshot = getSnapshot?.()
    const payload: RunDetailReturnPayload<TSnapshot> = {
      entryId,
      sourceKey,
      sourceHref: resolvedSourceHref,
      scrollTop,
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
      hasSnapshot: snapshot !== undefined,
    })
  }, [debugLabel, enabled, getSnapshot, resolveScrollElement, resolvedSourceHref, sourceKey])

  return {
    hasRestoredSnapshot,
    skipReason,
    prepareForRunDetailNavigation,
  }
}
