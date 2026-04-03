/**
 * TEMP: per-send phase timing for latency debugging (client-only, bounded store).
 * Uses performance.now() for deltas. Does not change product behavior.
 */

import { logChatSendDebug } from '@/lib/chatSendDebug'

/** Narrow shape to avoid importing `lib/chat` (circular with timing hooks). */
export type ChatSendTimingMessageScan = {
  id: string
  isOptimistic?: boolean
  optimisticStatus?: 'sending' | 'failed'
  messageType: 'text' | 'image' | 'voice'
  attachments: unknown[]
  optimisticAttachmentUploadState?: 'uploading' | 'uploaded' | 'failed' | null
  optimisticAttachmentStates?: Array<'pending' | 'uploading' | 'uploaded' | 'attached' | 'failed'> | null
  optimisticServerMessageId?: string | null
}

const MAX_RECORDS = 40

export type ChatSendTimingCompletionSource = 'realtime' | 'fallback_fetch' | 'pending_task_only' | 'unknown'

type TimingRecord = {
  optimisticMessageId: string
  serverMessageId: string | null
  contentKind: string | null
  marks: Record<string, number>
  reconciliationSource: ChatSendTimingCompletionSource
  summaryEmitted: boolean
  visualCompleteEmitted: boolean
}

const recordsByOptimistic = new Map<string, TimingRecord>()
const optimisticByServer = new Map<string, string>()

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function pruneRecords() {
  if (recordsByOptimistic.size <= MAX_RECORDS) {
    return
  }

  const keys = [...recordsByOptimistic.keys()]
  const drop = keys.length - MAX_RECORDS
  for (let index = 0; index < drop; index += 1) {
    const key = keys[index]
    const record = recordsByOptimistic.get(key)

    if (record?.serverMessageId) {
      optimisticByServer.delete(record.serverMessageId)
    }

    recordsByOptimistic.delete(key)
  }
}

function getRecordByOptimistic(optimisticMessageId: string): TimingRecord | null {
  return recordsByOptimistic.get(optimisticMessageId) ?? null
}

function resolveOptimisticKey(payload: {
  optimisticMessageId?: string | null
  serverMessageId?: string | null
}): string | null {
  if (payload.optimisticMessageId && recordsByOptimistic.has(payload.optimisticMessageId)) {
    return payload.optimisticMessageId
  }

  if (payload.serverMessageId) {
    const linked = optimisticByServer.get(payload.serverMessageId)

    if (linked) {
      return linked
    }
  }

  if (payload.optimisticMessageId) {
    return payload.optimisticMessageId
  }

  return null
}

function markKey(phase: string, sortOrder?: number) {
  return sortOrder !== undefined ? `${phase}:${sortOrder}` : phase
}

/** Start timing at tap (send). Call after optimistic id exists. */
export function registerChatSendTimingTap(optimisticMessageId: string, contentKind: string) {
  if (typeof window === 'undefined') {
    return
  }

  const time = perfNow()
  recordsByOptimistic.set(optimisticMessageId, {
    optimisticMessageId,
    serverMessageId: null,
    contentKind,
    marks: {
      tap: time,
    },
    reconciliationSource: 'unknown',
    summaryEmitted: false,
    visualCompleteEmitted: false,
  })
  pruneRecords()
}

export function markChatSendTimingOptimisticInsert(optimisticMessageId: string) {
  if (typeof window === 'undefined') {
    return
  }

  const record = getRecordByOptimistic(optimisticMessageId)

  if (!record) {
    return
  }

  record.marks.optimistic_insert = perfNow()
}

export function linkChatSendTimingServerMessage(optimisticMessageId: string, serverMessageId: string) {
  const record = getRecordByOptimistic(optimisticMessageId)

  if (!record) {
    return
  }

  record.serverMessageId = serverMessageId
  optimisticByServer.set(serverMessageId, optimisticMessageId)
}

export function markChatSendTimingPhase(
  phase: string,
  payload: { optimisticMessageId?: string | null; serverMessageId?: string | null; sortOrder?: number }
) {
  if (typeof window === 'undefined') {
    return
  }

  const optimisticKey = resolveOptimisticKey(payload)

  if (!optimisticKey) {
    return
  }

  const record = getRecordByOptimistic(optimisticKey)

  if (!record) {
    return
  }

  const key = markKey(phase, payload.sortOrder)

  if (record.marks[key] === undefined) {
    record.marks[key] = perfNow()
  }
}

export function markChatSendTimingRequestSuccess(optimisticMessageId: string, serverMessageId: string) {
  linkChatSendTimingServerMessage(optimisticMessageId, serverMessageId)
  markChatSendTimingPhase('request_success', { optimisticMessageId, serverMessageId })
}

export function markChatSendTimingReconciliationSuccess(
  payload: {
    optimisticMessageId?: string
    serverMessageId?: string
    source?: string
  }
) {
  const optimisticKey = resolveOptimisticKey({
    optimisticMessageId: payload.optimisticMessageId,
    serverMessageId: payload.serverMessageId,
  })

  if (!optimisticKey) {
    return
  }

  const record = getRecordByOptimistic(optimisticKey)

  if (!record) {
    return
  }

  if (payload.source === 'fallback_fetch') {
    record.reconciliationSource = 'fallback_fetch'
  } else if (payload.source === 'realtime_insert') {
    record.reconciliationSource = 'realtime'
  }

  markChatSendTimingPhase('reconciliation_success', {
    optimisticMessageId: optimisticKey,
    serverMessageId: payload.serverMessageId ?? record.serverMessageId,
  })
}

export function markChatSendTimingAttachmentPhase(
  phase:
    | 'attachment_task_queued'
    | 'attachment_upload_start'
    | 'attachment_upload_success'
    | 'attachment_upload_failed'
    | 'attachment_attach_success'
    | 'attachment_attach_failed',
  payload: { serverMessageId: string; sortOrder: number }
) {
  markChatSendTimingPhase(phase, {
    serverMessageId: payload.serverMessageId,
    sortOrder: payload.sortOrder,
  })
}

/** Same rules as ChatMessageBody pending UI (sending / upload overlays). */
export function isMessageVisuallyPendingForTiming(message: ChatSendTimingMessageScan): boolean {
  if (message.isOptimistic && message.optimisticStatus === 'sending') {
    return true
  }

  if (message.messageType !== 'image' || message.attachments.length === 0) {
    return false
  }

  if (message.optimisticAttachmentUploadState === 'uploading') {
    return true
  }

  const states = message.optimisticAttachmentStates

  if (states && states.length > 0) {
    return states.some((state) => state === 'pending' || state === 'uploading' || state === 'uploaded')
  }

  return false
}

export function resolveChatSendTimingRecordKey(message: ChatSendTimingMessageScan): string | null {
  if (recordsByOptimistic.has(message.id)) {
    return message.id
  }

  const fromServer = optimisticByServer.get(message.id)

  if (fromServer) {
    return fromServer
  }

  if (message.optimisticServerMessageId && recordsByOptimistic.has(message.optimisticServerMessageId)) {
    return message.optimisticServerMessageId
  }

  const fromOptServer = message.optimisticServerMessageId
    ? optimisticByServer.get(message.optimisticServerMessageId)
    : null

  return fromOptServer ?? null
}

function delta(a: number | undefined, b: number | undefined): number | null {
  if (a === undefined || b === undefined) {
    return null
  }

  return Math.round((a - b) * 100) / 100
}

function collectSortOrders(marks: Record<string, number>, prefix: string): number[] {
  const orders = new Set<number>()

  for (const key of Object.keys(marks)) {
    if (!key.startsWith(`${prefix}:`)) {
      continue
    }

    const sortOrder = Number(key.slice(prefix.length + 1))

    if (Number.isFinite(sortOrder)) {
      orders.add(sortOrder)
    }
  }

  return [...orders].sort((left, right) => left - right)
}

function buildSummaryDurations(record: TimingRecord) {
  const marks = record.marks
  const tap = marks.tap
  const optimisticInsert = marks.optimistic_insert
  const requestStart = marks.request_start
  const responseStatus = marks.response_status
  const requestSuccess = marks.request_success
  const reconcile = marks.reconciliation_success
  const visual = marks.visual_complete

  let uploadTotalMs = 0
  let uploadToAttachTotalMs = 0
  const uploadOrders = collectSortOrders(marks, 'attachment_upload_start')

  for (const sortOrder of uploadOrders) {
    const uploadStart = marks[markKey('attachment_upload_start', sortOrder)]
    const uploadEnd =
      marks[markKey('attachment_upload_success', sortOrder)] ??
      marks[markKey('attachment_upload_failed', sortOrder)]
    const attachEnd = marks[markKey('attachment_attach_success', sortOrder)]

    const uploadDuration = delta(uploadEnd, uploadStart)
    const uploadToAttach = delta(attachEnd, uploadEnd)

    if (uploadDuration !== null) {
      uploadTotalMs += uploadDuration
    }

    if (uploadToAttach !== null) {
      uploadToAttachTotalMs += uploadToAttach
    }
  }

  return {
    tap_to_optimistic_ms: delta(optimisticInsert, tap),
    tap_to_request_ms: delta(requestStart, tap),
    request_to_response_ms: delta(responseStatus, requestStart),
    response_to_request_success_ms: delta(requestSuccess, responseStatus),
    request_success_to_reconcile_ms: delta(reconcile, requestSuccess),
    upload_duration_ms: uploadOrders.length > 0 ? Math.round(uploadTotalMs * 100) / 100 : null,
    upload_to_attach_ms: uploadOrders.length > 0 ? Math.round(uploadToAttachTotalMs * 100) / 100 : null,
    reconcile_to_visual_complete_ms: delta(visual, reconcile),
    total_to_visual_complete_ms: delta(visual, tap),
  }
}

function resolveCompletionSourceForSummary(record: TimingRecord): ChatSendTimingCompletionSource {
  if (record.reconciliationSource !== 'unknown') {
    return record.reconciliationSource
  }

  const hasReconcile = record.marks.reconciliation_success !== undefined
  const isImage =
    record.contentKind === 'image' || record.contentKind === 'mixed'

  if (!hasReconcile && isImage) {
    return 'pending_task_only'
  }

  return 'unknown'
}

function emitSummary(record: TimingRecord) {
  if (record.summaryEmitted) {
    return
  }

  record.summaryEmitted = true

  const durations = buildSummaryDurations(record)
  const totalMs = durations.total_to_visual_complete_ms
  const completionSource = resolveCompletionSourceForSummary(record)
  const basePayload = {
    optimisticMessageId: record.optimisticMessageId,
    serverMessageId: record.serverMessageId,
    contentKind: record.contentKind,
    total_ms: totalMs,
    completionSource,
    ...durations,
  }

  const isAttachmentSummary =
    record.contentKind === 'image' || record.contentKind === 'mixed'

  logChatSendDebug(isAttachmentSummary ? 'attachment_timing_summary' : 'send_timing_summary', basePayload)
}

const visualPendingByRecordKey = new Map<string, boolean>()

export function scanChatSendTimingVisualComplete(messages: ChatSendTimingMessageScan[]) {
  if (typeof window === 'undefined') {
    return
  }

  const prevPending = visualPendingByRecordKey
  const nextPending = new Map<string, boolean>()

  for (const message of messages) {
    const recordKey = resolveChatSendTimingRecordKey(message)

    if (!recordKey) {
      continue
    }

    nextPending.set(recordKey, isMessageVisuallyPendingForTiming(message))
  }

  for (const [recordKey, pending] of nextPending) {
    const record = getRecordByOptimistic(recordKey)

    if (!record || record.visualCompleteEmitted) {
      continue
    }

    const wasPending = prevPending.get(recordKey)

    if (wasPending === true && pending === false) {
      record.marks.visual_complete = perfNow()
      record.visualCompleteEmitted = true

      logChatSendDebug('visual_complete', {
        optimisticMessageId: record.optimisticMessageId,
        serverMessageId: record.serverMessageId,
        contentKind: record.contentKind,
      })

      emitSummary(record)
    }
  }

  visualPendingByRecordKey.clear()

  for (const [key, value] of nextPending) {
    visualPendingByRecordKey.set(key, value)
  }
}
