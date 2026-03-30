import { supabase } from '@/lib/supabase'

const RUN_PHOTOS_BUCKET = 'run-photos'

function sanitizePathSegment(value: string) {
  const trimmedValue = value.trim()
  const sanitizedValue = trimmedValue.replace(/[^a-zA-Z0-9_-]/g, '')

  if (!sanitizedValue) {
    throw new Error('run_photo_invalid_path_segment')
  }

  return sanitizedValue
}

function sanitizeFileName(fileName: string) {
  const trimmedValue = fileName.trim()
  const normalizedValue = trimmedValue || 'photo'
  const fileExtension = normalizedValue.includes('.')
    ? normalizedValue.split('.').pop()?.toLowerCase() ?? 'jpg'
    : 'jpg'
  const safeExtension = fileExtension.replace(/[^a-z0-9]/g, '') || 'jpg'
  const baseName = normalizedValue.replace(/\.[^.]+$/, '')
  const safeBaseName = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${safeBaseName || 'photo'}.${safeExtension}`
}

export type UploadRunPhotoParams = {
  file: File
  userId: string
  runId: string
  index?: number
}

export type UploadRunPhotoResult = {
  path: string
  publicUrl: string
}

export async function uploadRunPhoto({
  file,
  userId,
  runId,
  index = 0,
}: UploadRunPhotoParams): Promise<UploadRunPhotoResult> {
  if (!(file instanceof File)) {
    throw new Error('run_photo_file_required')
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('run_photo_invalid_file_type')
  }

  const safeUserId = sanitizePathSegment(userId)
  const safeRunId = sanitizePathSegment(runId)
  const safeFileName = sanitizeFileName(file.name)
  const timestamp = Date.now()
  const path = `${safeUserId}/${safeRunId}/${timestamp}-${index}-${safeFileName}`

  const { error: uploadError } = await supabase.storage.from(RUN_PHOTOS_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })

  if (uploadError) {
    console.error('Failed to upload run photo', {
      message: uploadError.message,
      status: 'status' in uploadError ? uploadError.status : undefined,
      bucket: RUN_PHOTOS_BUCKET,
      path,
    })
    throw uploadError
  }

  const { data } = supabase.storage.from(RUN_PHOTOS_BUCKET).getPublicUrl(path)

  return {
    path,
    publicUrl: data.publicUrl,
  }
}
