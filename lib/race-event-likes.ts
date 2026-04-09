import { getProfileDisplayName } from './profiles'
import type { LikedUserListItem } from './run-likes'
import { supabase } from './supabase'
import { getLevelFromXP } from './xp'

type RaceEventLikeRow = {
  race_event_id: string
  user_id: string
  created_at: string
}

type RaceEventLikeUserRow = Pick<RaceEventLikeRow, 'user_id' | 'created_at'>

type ProfileRow = {
  id: string
  name: string | null
  email: string | null
  avatar_url?: string | null
  total_xp?: number | null
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

export async function loadRaceEventLikedUsers(
  raceEventId: string,
  limit = 20
): Promise<LikedUserListItem[]> {
  if (!raceEventId.trim()) {
    return []
  }

  const { data, error } = await supabase
    .from('race_event_likes')
    .select('user_id, created_at')
    .eq('race_event_id', raceEventId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw error
  }

  const userIds = Array.from(
    new Set(((data as RaceEventLikeUserRow[] | null) ?? []).map((row) => row.user_id))
  )

  if (userIds.length === 0) {
    return []
  }

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name, email, avatar_url, total_xp')
    .in('id', userIds)

  if (profilesError) {
    throw profilesError
  }

  const profilesByUserId = Object.fromEntries(
    ((profiles as ProfileRow[] | null) ?? []).map((profile) => [profile.id, profile])
  )

  return userIds.map((userId) => {
    const profile = profilesByUserId[userId]

    return {
      userId,
      displayName: getProfileDisplayName(profile, 'Бегун'),
      nickname: null,
      avatarUrl: profile?.avatar_url ?? null,
      level: getLevelFromXP(Number(profile?.total_xp ?? 0)).level,
    } satisfies LikedUserListItem
  })
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
