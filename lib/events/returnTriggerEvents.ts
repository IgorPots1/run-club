import 'server-only'

import type { CreateAppEventInput } from './createAppEvent'

const EVENT_PAYLOAD_VERSION = 1
const PREVIEW_BODY_MAX_LENGTH = 140

function trimToNull(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function truncatePreviewBody(value: string | null | undefined) {
  const trimmed = trimToNull(value)

  if (!trimmed) {
    return null
  }

  if (trimmed.length <= PREVIEW_BODY_MAX_LENGTH) {
    return trimmed
  }

  return `${trimmed.slice(0, PREVIEW_BODY_MAX_LENGTH - 1).trimEnd()}…`
}

function getRunLabel(runTitle: string | null | undefined) {
  return trimToNull(runTitle) ?? 'Пробежка'
}

function getRaceLabel(raceName: string | null | undefined) {
  return trimToNull(raceName) ?? 'Старт'
}

function formatRaceResultTime(totalSeconds: number | null | undefined) {
  if (!Number.isFinite(totalSeconds) || (totalSeconds ?? 0) < 0) {
    return null
  }

  const normalizedSeconds = Math.round(totalSeconds ?? 0)
  const hours = Math.floor(normalizedSeconds / 3600)
  const minutes = Math.floor((normalizedSeconds % 3600) / 60)
  const seconds = normalizedSeconds % 60

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':')
}

function formatPersonalRecordDistanceLabel(distanceMeters: number) {
  switch (distanceMeters) {
    case 5000:
      return '5 км'
    case 10000:
      return '10 км'
    case 21097:
      return '21.1 км'
    case 42195:
      return '42.2 км'
    default:
      return `${Math.round(distanceMeters)} м`
  }
}

function formatPersonalRecordResultTime(totalSeconds: number | null | undefined) {
  if (!Number.isFinite(totalSeconds) || (totalSeconds ?? 0) <= 0) {
    return null
  }

  const normalizedSeconds = Math.round(totalSeconds ?? 0)
  const hours = Math.floor(normalizedSeconds / 3600)
  const minutes = Math.floor((normalizedSeconds % 3600) / 60)
  const seconds = normalizedSeconds % 60

  if (hours > 0) {
    return [
      String(hours),
      String(minutes).padStart(2, '0'),
      String(seconds).padStart(2, '0'),
    ].join(':')
  }

  return [
    String(minutes),
    String(seconds).padStart(2, '0'),
  ].join(':')
}

export function buildRunLikeCreatedEvent(input: {
  actorUserId: string
  targetUserId: string
  runId: string
  likeCreatedAt: string
  runTitle?: string | null
  xpAwarded?: number | null
}): CreateAppEventInput {
  return {
    type: 'run_like.created',
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    entityType: 'run',
    entityId: input.runId,
    category: 'run',
    channel: 'inbox',
    priority: 'normal',
    targetPath: `/runs/${input.runId}`,
    dedupeKey: `run_like.created:${input.runId}:${input.actorUserId}:${input.likeCreatedAt}`,
    payload: {
      v: EVENT_PAYLOAD_VERSION,
      targetPath: `/runs/${input.runId}`,
      preview: {
        title: 'Вашу пробежку лайкнули',
        body: getRunLabel(input.runTitle),
      },
      context: {
        runId: input.runId,
        xpAwarded: Math.max(0, Math.round(Number(input.xpAwarded ?? 0))),
      },
    },
  }
}

export function buildRaceEventLikedEvent(input: {
  actorUserId: string
  targetUserId: string
  raceEventId: string
  likeCreatedAt: string
  raceName?: string | null
}): CreateAppEventInput {
  return {
    type: 'race_event.liked',
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    entityType: 'race_event',
    entityId: input.raceEventId,
    category: 'race',
    channel: 'both',
    priority: 'normal',
    targetPath: `/races/${input.raceEventId}`,
    dedupeKey: `race_event.liked:${input.raceEventId}:${input.actorUserId}:${input.likeCreatedAt}`,
    payload: {
      v: EVENT_PAYLOAD_VERSION,
      targetPath: `/races/${input.raceEventId}`,
      preview: {
        title: 'Твой старт получил лайк',
        body: getRaceLabel(input.raceName),
      },
      context: {
        raceEventId: input.raceEventId,
        raceName: getRaceLabel(input.raceName),
      },
    },
  }
}

export function buildRunCommentCreatedEvent(input: {
  actorUserId: string
  targetUserId: string
  runId: string
  commentId: string
  runTitle?: string | null
  comment: string
}): CreateAppEventInput {
  const targetPath = `/runs/${input.runId}/discussion?commentId=${encodeURIComponent(input.commentId)}`

  return {
    type: 'run_comment.created',
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    entityType: 'run_comment',
    entityId: input.commentId,
    category: 'run',
    channel: 'inbox',
    priority: 'normal',
    targetPath,
    dedupeKey: `run_comment.created:${input.commentId}`,
    payload: {
      v: EVENT_PAYLOAD_VERSION,
      targetPath,
      preview: {
        title: 'Новый комментарий к вашей пробежке',
        body: truncatePreviewBody(input.comment) ?? getRunLabel(input.runTitle),
      },
      context: {
        runId: input.runId,
        commentId: input.commentId,
      },
    },
  }
}

export function buildRunCommentReplyCreatedEvent(input: {
  actorUserId: string
  targetUserId: string
  runId: string
  commentId: string
  parentCommentId: string
  comment: string
}): CreateAppEventInput {
  const targetPath =
    `/runs/${input.runId}/discussion?commentId=${encodeURIComponent(input.commentId)}` +
    `&parentCommentId=${encodeURIComponent(input.parentCommentId)}`

  return {
    type: 'run_comment.reply_created',
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    entityType: 'run_comment',
    entityId: input.commentId,
    category: 'run',
    channel: 'inbox',
    priority: 'normal',
    targetPath,
    dedupeKey: `run_comment.reply_created:${input.commentId}`,
    payload: {
      v: EVENT_PAYLOAD_VERSION,
      targetPath,
      preview: {
        title: 'Новый ответ на ваш комментарий',
        body: truncatePreviewBody(input.comment) ?? 'Откройте обсуждение пробежки',
      },
      context: {
        runId: input.runId,
        commentId: input.commentId,
        parentCommentId: input.parentCommentId,
      },
    },
  }
}

export function buildRaceEventCreatedEvent(input: {
  actorUserId: string
  raceEventId: string
  raceName?: string | null
  raceDate: string
  distanceMeters?: number | null
  targetTimeSeconds?: number | null
}): CreateAppEventInput {
  return {
    type: 'race_event.created',
    actorUserId: input.actorUserId,
    targetUserId: null,
    entityType: 'race_event',
    entityId: input.raceEventId,
    category: 'race',
    channel: null,
    priority: 'normal',
    targetPath: `/races/${input.raceEventId}`,
    dedupeKey: `race_event.created:${input.raceEventId}`,
    payload: {
      v: EVENT_PAYLOAD_VERSION,
      targetPath: `/races/${input.raceEventId}`,
      preview: {
        title: 'Новый старт',
        body: getRaceLabel(input.raceName),
      },
      context: {
        raceEventId: input.raceEventId,
        raceName: getRaceLabel(input.raceName),
        raceDate: input.raceDate,
        distanceMeters:
          Number.isFinite(input.distanceMeters) && (input.distanceMeters ?? 0) > 0
            ? Math.round(input.distanceMeters ?? 0)
            : null,
        targetTimeSeconds:
          Number.isFinite(input.targetTimeSeconds) && (input.targetTimeSeconds ?? 0) >= 0
            ? Math.round(input.targetTimeSeconds ?? 0)
            : null,
      },
    },
  }
}

export function buildRaceEventCompletedEvent(input: {
  actorUserId: string
  raceEventId: string
  raceName?: string | null
  raceDate: string
  distanceMeters?: number | null
  resultTimeSeconds?: number | null
  targetTimeSeconds?: number | null
  linkedRun?: {
    id: string
    name?: string | null
    title?: string | null
    distanceKm?: number | null
    movingTimeSeconds?: number | null
    createdAt?: string | null
  } | null
}): CreateAppEventInput {
  const resultLabel = formatRaceResultTime(input.resultTimeSeconds)

  return {
    type: 'race_event.completed',
    actorUserId: input.actorUserId,
    targetUserId: null,
    entityType: 'race_event',
    entityId: input.raceEventId,
    category: 'race',
    channel: null,
    priority: 'normal',
    targetPath: `/races/${input.raceEventId}`,
    dedupeKey: `race_event.completed:${input.raceEventId}`,
    payload: {
      v: EVENT_PAYLOAD_VERSION,
      targetPath: `/races/${input.raceEventId}`,
      preview: {
        title: 'Старт завершен',
        body: resultLabel ? `${getRaceLabel(input.raceName)} • ${resultLabel}` : getRaceLabel(input.raceName),
      },
      context: {
        raceEventId: input.raceEventId,
        raceName: getRaceLabel(input.raceName),
        raceDate: input.raceDate,
        distanceMeters:
          Number.isFinite(input.distanceMeters) && (input.distanceMeters ?? 0) > 0
            ? Math.round(input.distanceMeters ?? 0)
            : null,
        resultTimeSeconds:
          Number.isFinite(input.resultTimeSeconds) && (input.resultTimeSeconds ?? 0) >= 0
            ? Math.round(input.resultTimeSeconds ?? 0)
            : null,
        targetTimeSeconds:
          Number.isFinite(input.targetTimeSeconds) && (input.targetTimeSeconds ?? 0) >= 0
            ? Math.round(input.targetTimeSeconds ?? 0)
            : null,
        linkedRunId: input.linkedRun?.id ?? null,
        linkedRunName: trimToNull(input.linkedRun?.name) ?? trimToNull(input.linkedRun?.title),
        linkedRunDistanceKm:
          Number.isFinite(input.linkedRun?.distanceKm) && (input.linkedRun?.distanceKm ?? 0) > 0
            ? Number(input.linkedRun?.distanceKm ?? 0)
            : null,
        linkedRunMovingTimeSeconds:
          Number.isFinite(input.linkedRun?.movingTimeSeconds) && (input.linkedRun?.movingTimeSeconds ?? 0) >= 0
            ? Math.round(input.linkedRun?.movingTimeSeconds ?? 0)
            : null,
        linkedRunCreatedAt: trimToNull(input.linkedRun?.createdAt) ?? null,
      },
    },
  }
}

export function buildPersonalRecordAchievedEvent(input: {
  actorUserId: string
  targetUserId: string
  distanceMeters: number
  durationSeconds: number
  recordDate?: string | null
  runId?: string | null
  sourceKey: string
}): CreateAppEventInput {
  const distanceLabel = formatPersonalRecordDistanceLabel(input.distanceMeters)
  const resultLabel = formatPersonalRecordResultTime(input.durationSeconds)
  const targetPath = input.runId ? `/runs/${input.runId}` : '/activity/records'

  return {
    type: 'personal_record.achieved',
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    entityType: input.runId ? 'run' : 'personal_record',
    entityId: input.runId ?? null,
    category: 'run',
    channel: 'both',
    priority: 'normal',
    targetPath,
    dedupeKey: `personal_record:${input.targetUserId}:${input.distanceMeters}:${input.durationSeconds}:${input.sourceKey}`,
    payload: {
      v: EVENT_PAYLOAD_VERSION,
      targetPath,
      preview: {
        title: `Новый личный рекорд на ${distanceLabel}`,
        body: resultLabel,
      },
      context: {
        distanceMeters: Math.round(input.distanceMeters),
        durationSeconds: Math.round(input.durationSeconds),
        resultLabel,
        recordDate: trimToNull(input.recordDate) ?? null,
        runId: input.runId ?? null,
        sourceKey: input.sourceKey,
      },
    },
  }
}
