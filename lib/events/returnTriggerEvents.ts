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

export function buildRunLikeCreatedEvent(input: {
  actorUserId: string
  targetUserId: string
  runId: string
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

export function buildRunCommentCreatedEvent(input: {
  actorUserId: string
  targetUserId: string
  runId: string
  commentId: string
  runTitle?: string | null
  comment: string
}): CreateAppEventInput {
  return {
    type: 'run_comment.created',
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    entityType: 'run_comment',
    entityId: input.commentId,
    category: 'run',
    channel: 'inbox',
    priority: 'normal',
    targetPath: `/runs/${input.runId}/discussion`,
    payload: {
      v: EVENT_PAYLOAD_VERSION,
      targetPath: `/runs/${input.runId}/discussion`,
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
  return {
    type: 'run_comment.reply_created',
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    entityType: 'run_comment',
    entityId: input.commentId,
    category: 'run',
    channel: 'inbox',
    priority: 'normal',
    targetPath: `/runs/${input.runId}/discussion`,
    payload: {
      v: EVENT_PAYLOAD_VERSION,
      targetPath: `/runs/${input.runId}/discussion`,
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
