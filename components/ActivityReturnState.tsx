'use client'

import { useEffect } from 'react'
import type { ActivityPeriod } from '@/lib/activity'
import { useRunDetailReturnState } from '@/lib/run-detail-navigation'

type ActivityReturnSnapshot = {
  period: ActivityPeriod
  savedAt: number
}

type ActivityReturnStateProps = {
  period: ActivityPeriod
  onRestorePeriod: (period: ActivityPeriod) => void
  restoreReady: boolean
  onReady: (prepare: (runId: string) => void) => void
}

const ACTIVITY_RETURN_SOURCE_KEY = 'activity-history'

export default function ActivityReturnState({
  period,
  onRestorePeriod,
  restoreReady,
  onReady,
}: ActivityReturnStateProps) {
  const { prepareForRunDetailNavigation } = useRunDetailReturnState<ActivityReturnSnapshot>({
    sourceKey: ACTIVITY_RETURN_SOURCE_KEY,
    getSnapshot: () => ({
      period,
      savedAt: Date.now(),
    }),
    onRestoreSnapshot: (snapshot) => {
      onRestorePeriod(snapshot.period)
    },
    restoreReady,
    debugLabel: 'ActivityReturnState',
  })

  useEffect(() => {
    onReady((runId: string) => {
      if (!runId) {
        return
      }

      prepareForRunDetailNavigation()
    })
  }, [onReady, prepareForRunDetailNavigation])

  return null
}
