'use client'

import { useEffect } from 'react'
import { stopVoiceStream } from '@/lib/voice/voiceStream'

export default function VoiceStreamLifecycle() {
  useEffect(() => {
    function handlePageHide() {
      stopVoiceStream()
    }

    window.addEventListener('pagehide', handlePageHide)

    return () => {
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [])

  return null
}
