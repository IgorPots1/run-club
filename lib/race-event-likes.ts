import { supabase } from './supabase'

type RaceEventLikeRow = {
  race_event_id: string
  user_id: string
}

type ToggleRaceEventLikeResponse =
  | {
      ok?: boolean
      error?: string
      liked?: boolean
      likeCount?: number
    }
  | null

export type RaceEventLikesSummary = {
  likesByRaceEventId: Record<string, number>
  likedRaceEventIds: Set<string>
}

export type RaceEventLikeRealtimePayload = {
  eventType: 'INSERT' | 'DELETE'
  raceEventId: string
  userId: string
}

export async function loadRaceEventLikesSummaryForRaceEventIds(
  raceEventIds: string[],
  currentUserId: string | null
): Promise<RaceEventLikesSummary> {
  if (raceEventIds.length === 0) {
    return {
      likesByRaceEventId: {},
      likedRaceEventIds: new Set<string>(),
    }
  }

  const { data, error } = await supabase
    .from('race_event_likes')
    .select('race_event_id, user_id')
    .in('race_event_id', raceEventIds)

  if (error) {
    throw error
  }

  const likesByRaceEventId: Record<string, number> = {}
  const likedRaceEventIds = new Set<string>()

  for (const like of (data as RaceEventLikeRow[] | null) ?? []) {
    likesByRaceEventId[like.race_event_id] = (likesByRaceEventId[like.race_event_id] ?? 0) + 1

    if (like.user_id === currentUserId) {
      likedRaceEventIds.add(like.race_event_id)
    }
  }

  return {
    likesByRaceEventId,
    likedRaceEventIds,
  }
}

export async function toggleRaceEventLike(raceEventId: string) {
  const response = await fetch('/api/race-event-likes/toggle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({
      raceEventId,
    }),
  })

  const payload = await response.json().catch(() => null) as ToggleRaceEventLikeResponse

  if (!response.ok || !payload?.ok || typeof payload.liked !== 'boolean' || typeof payload.likeCount !== 'number') {
    return {
      error: new Error(
        payload && typeof payload.error === 'string'
          ? payload.error
          : 'race_event_like_toggle_failed'
      ),
      liked: null,
      likeCount: null,
    }
  }

  return {
    error: null,
    liked: payload.liked,
    likeCount: payload.likeCount,
  }
}

export function subscribeToRaceEventLikes(onChange: (payload: RaceEventLikeRealtimePayload) => void) {
  const channel = supabase
    .channel(`race-event-likes-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'race_event_likes',
      },
      (payload) => {
        const nextLike = payload.new as RaceEventLikeRow | null
        const raceEventId = String(nextLike?.race_event_id ?? '')
        const userId = String(nextLike?.user_id ?? '')

        if (!raceEventId || !userId) {
          return
        }

        onChange({
          eventType: 'INSERT',
          raceEventId,
          userId,
        })
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'race_event_likes',
      },
      (payload) => {
        const previousLike = payload.old as RaceEventLikeRow | null
        const raceEventId = String(previousLike?.race_event_id ?? '')
        const userId = String(previousLike?.user_id ?? '')

        if (!raceEventId || !userId) {
          return
        }

        onChange({
          eventType: 'DELETE',
          raceEventId,
          userId,
        })
      }
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}
