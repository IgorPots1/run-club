'use client'

import { useEntityCommentsController } from '@/lib/use-entity-comments-controller'

type UseRunCommentsControllerParams = {
  runId: string
  currentUserId?: string | null
  onAuthRequired?: () => void
}

export function useRunCommentsController({
  runId,
  currentUserId = null,
  onAuthRequired,
}: UseRunCommentsControllerParams) {
  return useEntityCommentsController({
    entityType: 'run',
    entityId: runId,
    currentUserId,
    onAuthRequired,
  })
}
