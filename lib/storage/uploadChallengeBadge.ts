'use client'

import { supabase } from '@/lib/supabase'

const CHALLENGE_BADGES_BUCKET = 'challenge-badges'

function sanitizePathSegment(value: string) {
  const trimmedValue = value.trim()
  const sanitizedValue = trimmedValue.replace(/[^a-zA-Z0-9_-]/g, '')

  if (!sanitizedValue) {
    throw new Error('challenge_badge_invalid_path_segment')
  }

  return sanitizedValue
}

function sanitizeFileName(fileName: string) {
  const trimmedValue = fileName.trim()
  const normalizedValue = trimmedValue || 'badge'
  const fileExtension = normalizedValue.includes('.')
    ? normalizedValue.split('.').pop()?.toLowerCase() ?? 'png'
    : 'png'
  const safeExtension = fileExtension.replace(/[^a-z0-9]/g, '') || 'png'
  const baseName = normalizedValue.replace(/\.[^.]+$/, '')
  const safeBaseName = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${safeBaseName || 'badge'}.${safeExtension}`
}

export type UploadChallengeBadgeParams = {
  file: File
  userId: string
}

export type UploadChallengeBadgeResult = {
  storagePath: string
  publicUrl: string
}

export async function uploadChallengeBadge({
  file,
  userId,
}: UploadChallengeBadgeParams): Promise<UploadChallengeBadgeResult> {
  if (!(file instanceof File)) {
    throw new Error('challenge_badge_file_required')
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('challenge_badge_invalid_file_type')
  }

  const safeUserId = sanitizePathSegment(userId)
  const safeFileName = sanitizeFileName(file.name)
  const timestamp = Date.now()
  const path = `${safeUserId}/${timestamp}-${safeFileName}`

  const { error: uploadError } = await supabase.storage.from(CHALLENGE_BADGES_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })

  if (uploadError) {
    console.error('Failed to upload challenge badge', {
      message: uploadError.message,
      status: 'status' in uploadError ? uploadError.status : undefined,
      bucket: CHALLENGE_BADGES_BUCKET,
      path,
    })
    throw uploadError
  }

  const { data } = supabase.storage.from(CHALLENGE_BADGES_BUCKET).getPublicUrl(path)

  return {
    storagePath: path,
    publicUrl: data.publicUrl,
  }
}

export async function deleteUploadedChallengeBadge(storagePath: string) {
  const trimmedPath = storagePath.trim()

  if (!trimmedPath) {
    return
  }

  const { error } = await supabase.storage.from(CHALLENGE_BADGES_BUCKET).remove([trimmedPath])

  if (error) {
    throw error
  }
}
