import { getProfileDisplayName } from './profiles'
import { supabase } from './supabase'

export type RunLikesSummary = {
  likesByRunId: Record<string, number>
  likedRunIds: Set<string>
}

type RunLikeRow = {
  run_id: string
  user_id: string
}

type ProfileRow = {
  id: string
  name: string | null
  nickname?: string | null
  email: string | null
  avatar_url?: string | null
}

export type RunLikedUserItem = {
  userId: string
  displayName: string
  nickname: string | null
  avatarUrl: string | null
}

function isMissingNicknameColumnError(error: { code?: string | null; message?: string | null }) {
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    Boolean(error.message?.includes('profiles.nickname')) ||
    Boolean(error.message?.includes("'nickname' column of 'profiles'"))
  )
}

async function loadProfilesForUserIds(userIds: string[]) {
  if (userIds.length === 0) {
    return {} as Record<string, ProfileRow | null>
  }

  const primaryResult = await supabase
    .from('profiles')
    .select('id, name, nickname, email, avatar_url')
    .in('id', userIds)

  if (!primaryResult.error) {
    return Object.fromEntries(((primaryResult.data as ProfileRow[] | null) ?? []).map((profile) => [profile.id, profile]))
  }

  if (!isMissingNicknameColumnError(primaryResult.error)) {
    throw primaryResult.error
  }

  const fallbackResult = await supabase
    .from('profiles')
    .select('id, name, email, avatar_url')
    .in('id', userIds)

  if (fallbackResult.error) {
    throw fallbackResult.error
  }

  const fallbackProfiles = (fallbackResult.data as Array<Omit<ProfileRow, 'nickname'>> | null) ?? []

  return Object.fromEntries(
    fallbackProfiles.map((profile) => [
      profile.id,
      {
        ...profile,
        nickname: null,
      } satisfies ProfileRow,
    ])
  )
}

export async function loadRunLikesSummary(currentUserId: string | null): Promise<RunLikesSummary> {
  const { data, error } = await supabase.from('run_likes').select('run_id, user_id')

  if (error) {
    throw error
  }

  const likesByRunId: Record<string, number> = {}
  const likedRunIds = new Set<string>()

  for (const like of (data as RunLikeRow[] | null) ?? []) {
    likesByRunId[like.run_id] = (likesByRunId[like.run_id] ?? 0) + 1

    if (like.user_id === currentUserId) {
      likedRunIds.add(like.run_id)
    }
  }

  return { likesByRunId, likedRunIds }
}

export async function loadRunLikesSummaryForRunIds(
  runIds: string[],
  currentUserId: string | null
): Promise<RunLikesSummary> {
  if (runIds.length === 0) {
    return {
      likesByRunId: {},
      likedRunIds: new Set<string>(),
    }
  }

  const { data, error } = await supabase.from('run_likes').select('run_id, user_id').in('run_id', runIds)

  if (error) {
    throw error
  }

  const likesByRunId: Record<string, number> = {}
  const likedRunIds = new Set<string>()

  for (const like of (data as RunLikeRow[] | null) ?? []) {
    likesByRunId[like.run_id] = (likesByRunId[like.run_id] ?? 0) + 1

    if (like.user_id === currentUserId) {
      likedRunIds.add(like.run_id)
    }
  }

  return { likesByRunId, likedRunIds }
}

export async function loadRunLikedUsers(runId: string): Promise<RunLikedUserItem[]> {
  if (!runId.trim()) {
    return []
  }

  const { data, error } = await supabase
    .from('run_likes')
    .select('user_id')
    .eq('run_id', runId)
    .order('user_id', { ascending: true })

  if (error) {
    throw error
  }

  const userIds = Array.from(new Set(((data as Array<Pick<RunLikeRow, 'user_id'>> | null) ?? []).map((row) => row.user_id)))

  if (userIds.length === 0) {
    return []
  }

  const profilesByUserId = await loadProfilesForUserIds(userIds)

  return userIds
    .map((userId) => {
      const profile = profilesByUserId[userId]
      const nickname = profile?.nickname?.trim() || null

      return {
        userId,
        displayName: getProfileDisplayName(profile, 'Бегун'),
        nickname,
        avatarUrl: profile?.avatar_url ?? null,
      }
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'ru'))
}

export async function toggleRunLike(runId: string, currentUserId: string, likedByMe: boolean) {
  const response = await fetch('/api/run-likes/toggle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({
      runId,
      likedByMe,
      currentUserId,
    }),
  })

  const payload = await response.json().catch(() => null) as
    | {
        ok?: boolean
        error?: string
      }
    | null

  if (!response.ok || !payload?.ok) {
    return {
      error: new Error(
        payload && typeof payload.error === 'string'
          ? payload.error
          : 'run_like_toggle_failed'
      ),
    }
  }

  return {
    error: null,
  }
}

export function subscribeToRunLikes(onChange: () => void) {
  const channel = supabase
    .channel(`run-likes-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'run_likes',
      },
      () => {
        onChange()
      }
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}
