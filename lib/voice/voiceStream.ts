let sharedVoiceStream: MediaStream | null = null

function isVoiceStreamActive(stream: MediaStream | null) {
  if (!stream || !stream.active) {
    return false
  }

  return stream.getAudioTracks().some((track) => track.readyState === 'live' && track.enabled)
}

export async function getVoiceStream(): Promise<MediaStream> {
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

export function stopVoiceStream() {
  sharedVoiceStream?.getTracks().forEach((track) => track.stop())
  sharedVoiceStream = null
}
