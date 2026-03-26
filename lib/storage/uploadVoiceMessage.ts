import { supabase } from '@/lib/supabase'

const CHAT_VOICE_BUCKET = 'chat-voice'

export type UploadVoiceMessageParams = {
  file: File
  userId: string
}

export type UploadVoiceMessageResult = {
  path: string
  success: true
}

function createUploadRandomSegment() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  throw new Error('voice_upload_random_unavailable')
}

function sanitizePathSegment(value: string) {
  const sanitizedValue = value.trim().replace(/[^a-zA-Z0-9_-]/g, '')

  if (!sanitizedValue) {
    throw new Error('voice_upload_invalid_user_id')
  }

  return sanitizedValue
}

export async function uploadVoiceMessage({
  file,
  userId,
}: UploadVoiceMessageParams): Promise<UploadVoiceMessageResult> {
  if (!(file instanceof File)) {
    throw new Error('voice_upload_file_required')
  }

  if (file.size <= 0) {
    throw new Error('voice_upload_file_empty')
  }

  const safeUserId = sanitizePathSegment(userId)
  const timestamp = Date.now()
  const randomSegment = createUploadRandomSegment()
  const path = `voice/${safeUserId}/${timestamp}-${randomSegment}.webm`

  const { error: uploadError } = await supabase.storage.from(CHAT_VOICE_BUCKET).upload(path, file, {
    contentType: file.type || 'audio/webm',
    upsert: false,
  })

  if (uploadError) {
    console.error('Failed to upload voice message file', {
      message: uploadError.message,
      status: 'status' in uploadError ? uploadError.status : undefined,
      bucket: CHAT_VOICE_BUCKET,
      path,
    })
    throw new Error(`voice_upload_failed:${uploadError.message}`)
  }

  return {
    path,
    success: true,
  }
}
