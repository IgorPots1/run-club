let sharedVoiceStream: MediaStream | null = null
let idleTimeout: number | null = null

function clearScheduledStreamStop() {
  if (idleTimeout !== null) {
    window.clearTimeout(idleTimeout)
    idleTimeout = null
  }
}

function isVoiceStreamActive(stream: MediaStream | null) {
  if (!stream || !stream.active) {
    return false
  }

  return stream.getAudioTracks().some((track) => track.readyState === 'live' && track.enabled)
}

export async function getVoiceStream(): Promise<MediaStream> {
  clearScheduledStreamStop()

  if (isVoiceStreamActive(sharedVoiceStream)) {
    return sharedVoiceStream as MediaStream
  }

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('voice_recording_not_supported')
  }

  sharedVoiceStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
  })

  return sharedVoiceStream
}

export function scheduleVoiceStreamStop() {
  if (typeof window === 'undefined') {
    return
  }

  clearScheduledStreamStop()
  idleTimeout = window.setTimeout(() => {
    stopVoiceStream()
  }, 30000)
}

export function stopVoiceStream() {
  clearScheduledStreamStop()
  sharedVoiceStream?.getTracks().forEach((track) => track.stop())
  sharedVoiceStream = null
}
