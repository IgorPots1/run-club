export type WorkoutMediaPhoto = {
  id: string
  public_url: string
  thumbnail_url: string | null
}

export type WorkoutMediaItem =
  | { type: 'map'; mapPolyline: string }
  | { type: 'photo'; photo: WorkoutMediaPhoto }

type BuildWorkoutMediaArgs = {
  mapPolyline?: string | null
  photos?: WorkoutMediaPhoto[]
}

export function buildWorkoutMedia({
  mapPolyline = null,
  photos = [],
}: BuildWorkoutMediaArgs): WorkoutMediaItem[] {
  const orderedMedia: WorkoutMediaItem[] = []
  const trimmedMapPolyline = mapPolyline?.trim() || null

  if (trimmedMapPolyline) {
    orderedMedia.push({
      type: 'map',
      mapPolyline: trimmedMapPolyline,
    })
  }

  for (const photo of photos) {
    orderedMedia.push({
      type: 'photo',
      photo,
    })
  }

  return orderedMedia
}
