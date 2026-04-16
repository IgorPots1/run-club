'use client'

import { useEffect } from 'react'

export default function BackfillEnsureOnLoad({
  shouldTrigger,
}: {
  shouldTrigger: boolean
}) {
  useEffect(() => {
    if (!shouldTrigger) {
      return
    }

    void fetch('/api/personal-records/backfill/ensure', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {})
  }, [shouldTrigger])

  return null
}
