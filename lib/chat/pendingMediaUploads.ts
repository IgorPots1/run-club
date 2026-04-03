'use client'

import { attachImageToChatMessage, uploadChatImage } from '@/lib/chat'
import {
  createChatSendDebugError,
  logChatSendDebug,
  logChatSendDebugError,
} from '@/lib/chatSendDebug'
import { markChatSendTimingAttachmentPhase } from '@/lib/chatSendTiming'

export type PendingChatMediaAttachmentState =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'attached'
  | 'failed'

export type PendingChatMediaTaskAttachment = {
  id: string
  sortOrder: number
  file: File | null
  previewUrl: string | null
  publicUrl: string | null
  storagePath: string | null
  width: number | null
  height: number | null
  state: PendingChatMediaAttachmentState
  error: string | null
}

export type PendingChatMediaTask = {
  messageId: string
  threadId: string | null
  userId: string
  attachments: PendingChatMediaTaskAttachment[]
}

type MutablePendingChatMediaTask = PendingChatMediaTask & {
  isProcessing: boolean
  cleanupTimeoutId: number | null
}

type QueuePendingChatMediaTaskInput = {
  messageId: string
  threadId: string | null
  userId: string
  attachments: Array<{
    id: string
    sortOrder: number
    file: File | null
    previewUrl: string | null
    width: number | null
    height: number | null
  }>
}

const tasksByMessageId = new Map<string, MutablePendingChatMediaTask>()
const listeners = new Set<() => void>()

function emitPendingChatMediaTasksChanged() {
  listeners.forEach((listener) => {
    listener()
  })
}

function cloneTaskAttachment(attachment: PendingChatMediaTaskAttachment): PendingChatMediaTaskAttachment {
  return {
    ...attachment,
  }
}

function cloneTask(task: MutablePendingChatMediaTask): PendingChatMediaTask {
  return {
    messageId: task.messageId,
    threadId: task.threadId,
    userId: task.userId,
    attachments: task.attachments.map(cloneTaskAttachment),
  }
}

function revokeTaskAttachmentPreviewUrl(attachment: PendingChatMediaTaskAttachment) {
  if (attachment.previewUrl && attachment.previewUrl.startsWith('blob:')) {
    URL.revokeObjectURL(attachment.previewUrl)
  }
}

function revokeTaskPreviewUrls(task: MutablePendingChatMediaTask) {
  task.attachments.forEach((attachment) => {
    revokeTaskAttachmentPreviewUrl(attachment)
    attachment.previewUrl = null
    attachment.file = null
  })
}

function scheduleTaskCleanup(messageId: string) {
  const task = tasksByMessageId.get(messageId)

  if (!task) {
    return
  }

  if (task.cleanupTimeoutId !== null) {
    window.clearTimeout(task.cleanupTimeoutId)
  }

  task.cleanupTimeoutId = window.setTimeout(() => {
    const currentTask = tasksByMessageId.get(messageId)

    if (!currentTask || currentTask.attachments.some((attachment) => attachment.state !== 'attached')) {
      return
    }

    revokeTaskPreviewUrls(currentTask)
    tasksByMessageId.delete(messageId)
    emitPendingChatMediaTasksChanged()
  }, 30000)
}

async function processPendingChatMediaTask(messageId: string) {
  const task = tasksByMessageId.get(messageId)

  if (!task || task.isProcessing) {
    return
  }

  task.isProcessing = true

  try {
    for (const attachment of task.attachments.slice().sort((left, right) => left.sortOrder - right.sortOrder)) {
      if (attachment.state === 'attached') {
        continue
      }

      try {
        if (!attachment.storagePath) {
          if (!attachment.file) {
            attachment.state = 'failed'
            attachment.error = 'chat_image_upload_missing_file'
            logChatSendDebugError('attachment_upload_failed', {
              messageId: task.messageId,
              threadId: task.threadId,
              sortOrder: attachment.sortOrder,
              reason: attachment.error,
            })
            markChatSendTimingAttachmentPhase('attachment_upload_failed', {
              serverMessageId: task.messageId,
              sortOrder: attachment.sortOrder,
            })
            emitPendingChatMediaTasksChanged()
            continue
          }

          attachment.state = 'uploading'
          attachment.error = null
          logChatSendDebug('attachment_upload_start', {
            messageId: task.messageId,
            threadId: task.threadId,
            sortOrder: attachment.sortOrder,
            fileName: attachment.file.name,
            fileSize: attachment.file.size,
            fileType: attachment.file.type,
          })
          markChatSendTimingAttachmentPhase('attachment_upload_start', {
            serverMessageId: task.messageId,
            sortOrder: attachment.sortOrder,
          })
          emitPendingChatMediaTasksChanged()

          const uploadedImage = await uploadChatImage(task.userId, attachment.file, task.threadId)
          attachment.storagePath = uploadedImage.storagePath
          attachment.publicUrl = uploadedImage.publicUrl
          attachment.width = uploadedImage.width ?? attachment.width
          attachment.height = uploadedImage.height ?? attachment.height
          attachment.state = 'uploaded'
          attachment.error = null
          logChatSendDebug('attachment_upload_success', {
            messageId: task.messageId,
            threadId: task.threadId,
            sortOrder: attachment.sortOrder,
            storagePath: uploadedImage.storagePath,
            publicUrl: uploadedImage.publicUrl,
            width: attachment.width,
            height: attachment.height,
          })
          markChatSendTimingAttachmentPhase('attachment_upload_success', {
            serverMessageId: task.messageId,
            sortOrder: attachment.sortOrder,
          })
          emitPendingChatMediaTasksChanged()
        } else {
          attachment.state = 'uploaded'
          attachment.error = null
          emitPendingChatMediaTasksChanged()
        }

        logChatSendDebug('attachment_payload_ready', {
          messageId: task.messageId,
          threadId: task.threadId,
          sortOrder: attachment.sortOrder,
          payload: {
            type: 'image',
            threadId: task.threadId,
            storagePath: attachment.storagePath,
            width: attachment.width,
            height: attachment.height,
            sortOrder: attachment.sortOrder,
          },
        })

        const { error: attachError } = await attachImageToChatMessage(task.messageId, {
          type: 'image',
          threadId: task.threadId,
          storagePath: attachment.storagePath!,
          width: attachment.width,
          height: attachment.height,
          sortOrder: attachment.sortOrder,
        })

        if (attachError) {
          throw attachError
        }

        attachment.state = 'attached'
        attachment.error = null
        logChatSendDebug('attachment_attach_success', {
          messageId: task.messageId,
          threadId: task.threadId,
          sortOrder: attachment.sortOrder,
          storagePath: attachment.storagePath,
          publicUrl: attachment.publicUrl,
        })
        markChatSendTimingAttachmentPhase('attachment_attach_success', {
          serverMessageId: task.messageId,
          sortOrder: attachment.sortOrder,
        })
        revokeTaskAttachmentPreviewUrl(attachment)
        attachment.previewUrl = null
        attachment.file = null
        emitPendingChatMediaTasksChanged()
      } catch (error) {
        attachment.state = 'failed'
        const normalizedError = error instanceof Error
          ? error
          : createChatSendDebugError('attachment_upload_error', 'chat_media_upload_failed', {
              messageId: task.messageId,
              threadId: task.threadId,
              sortOrder: attachment.sortOrder,
              rawError: error,
            })
        attachment.error = normalizedError.message
        logChatSendDebugError('attachment_attach_failed', {
          messageId: task.messageId,
          threadId: task.threadId,
          sortOrder: attachment.sortOrder,
          storagePath: attachment.storagePath,
          publicUrl: attachment.publicUrl,
          error: normalizedError,
        })
        markChatSendTimingAttachmentPhase('attachment_attach_failed', {
          serverMessageId: task.messageId,
          sortOrder: attachment.sortOrder,
        })
        emitPendingChatMediaTasksChanged()
      }
    }
  } finally {
    const currentTask = tasksByMessageId.get(messageId)

    if (!currentTask) {
      return
    }

    currentTask.isProcessing = false

    if (currentTask.attachments.every((attachment) => attachment.state === 'attached')) {
      scheduleTaskCleanup(messageId)
    }
  }
}

export function subscribePendingChatMediaTasks(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function getPendingChatMediaTask(messageId: string) {
  const task = tasksByMessageId.get(messageId)

  if (!task) {
    return null
  }

  return cloneTask(task)
}

export function hasPendingChatMediaTask(messageId: string) {
  return tasksByMessageId.has(messageId)
}

export function queuePendingChatMediaTask(input: QueuePendingChatMediaTaskInput) {
  const existingTask = tasksByMessageId.get(input.messageId)

  if (existingTask && existingTask.cleanupTimeoutId !== null) {
    window.clearTimeout(existingTask.cleanupTimeoutId)
    existingTask.cleanupTimeoutId = null
  }

  const nextTask: MutablePendingChatMediaTask = existingTask ?? {
    messageId: input.messageId,
    threadId: input.threadId,
    userId: input.userId,
    attachments: [],
    isProcessing: false,
    cleanupTimeoutId: null,
  }

  nextTask.threadId = input.threadId
  nextTask.userId = input.userId

  input.attachments.forEach((incomingAttachment) => {
    const existingAttachment =
      nextTask.attachments.find((attachment) => attachment.sortOrder === incomingAttachment.sortOrder) ?? null

    if (existingAttachment) {
      if (existingAttachment.state === 'attached') {
        return
      }

      existingAttachment.file = incomingAttachment.file ?? existingAttachment.file
      existingAttachment.previewUrl = incomingAttachment.previewUrl ?? existingAttachment.previewUrl
      existingAttachment.width = incomingAttachment.width ?? existingAttachment.width
      existingAttachment.height = incomingAttachment.height ?? existingAttachment.height
      existingAttachment.error = null

      if (existingAttachment.state === 'failed') {
        existingAttachment.state = existingAttachment.storagePath ? 'uploaded' : 'pending'
      }

      return
    }

    nextTask.attachments.push({
      id: incomingAttachment.id,
      sortOrder: incomingAttachment.sortOrder,
      file: incomingAttachment.file,
      previewUrl: incomingAttachment.previewUrl,
      publicUrl: null,
      storagePath: null,
      width: incomingAttachment.width,
      height: incomingAttachment.height,
      state: 'pending',
      error: null,
    })
  })

  nextTask.attachments.sort((left, right) => left.sortOrder - right.sortOrder)
  tasksByMessageId.set(input.messageId, nextTask)
  logChatSendDebug('local_files_picked', {
    messageId: input.messageId,
    threadId: input.threadId,
    attachmentCount: input.attachments.length,
    attachmentKinds: input.attachments.length > 0 ? ['image'] : [],
    attachments: input.attachments.map((attachment) => ({
      id: attachment.id,
      sortOrder: attachment.sortOrder,
      hasFile: attachment.file instanceof File,
      fileName: attachment.file?.name ?? null,
      fileSize: attachment.file?.size ?? null,
      width: attachment.width,
      height: attachment.height,
    })),
  })
  emitPendingChatMediaTasksChanged()
  void processPendingChatMediaTask(input.messageId)
  return cloneTask(nextTask)
}

export function retryPendingChatMediaTask(messageId: string) {
  const task = tasksByMessageId.get(messageId)

  if (!task) {
    return false
  }

  if (task.cleanupTimeoutId !== null) {
    window.clearTimeout(task.cleanupTimeoutId)
    task.cleanupTimeoutId = null
  }

  let didResetAttachment = false

  task.attachments.forEach((attachment) => {
    if (attachment.state !== 'failed') {
      return
    }

    attachment.error = null
    attachment.state = attachment.storagePath ? 'uploaded' : 'pending'
    didResetAttachment = true
  })

  if (!didResetAttachment) {
    return false
  }

  emitPendingChatMediaTasksChanged()
  void processPendingChatMediaTask(messageId)
  return true
}
