import { supabase } from '@/lib/supabase'

const CHAT_VOICE_BUCKET = 'chat-voice'
const CHAT_VOICE_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7

async function resolveVoiceMessageUrl(path: string) {
  const { data: signedUrlData, error: signedUrlError } = await supabase
    .storage
    .from(CHAT_VOICE_BUCKET)
    .createSignedUrl(path, CHAT_VOICE_SIGNED_URL_TTL_SECONDS)

  if (!signedUrlError && signedUrlData?.signedUrl) {
    return signedUrlData.signedUrl
  }

  if (signedUrlError) {
    console.warn('Falling back to public voice message URL', {
      message: signedUrlError.message,
      bucket: CHAT_VOICE_BUCKET,
      path,
    })
  }

  const { data } = supabase.storage.from(CHAT_VOICE_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

export async function uploadVoiceMessage(file: File, userId: string): Promise<string> {
  if (!file) {
    throw new Error('voice_file_required')
  }

  if (!userId.trim()) {
    throw new Error('voice_user_id_required')
  }

  if (file.size <= 0) {
    throw new Error('voice_file_empty')
  }

  const path = `voice/${userId}/${Date.now()}.webm`
  const { error: uploadError } = await supabase.storage.from(CHAT_VOICE_BUCKET).upload(path, file, {
    contentType: file.type || 'audio/webm',
    upsert: false,
  })

  if (uploadError) {
    console.error('Failed to upload voice message', {
      message: uploadError.message,
      status: 'status' in uploadError ? uploadError.status : undefined,
      bucket: CHAT_VOICE_BUCKET,
      path,
    })
    throw uploadError
  }

  return resolveVoiceMessageUrl(path)
}
