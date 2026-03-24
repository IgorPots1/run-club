import { COACH_USER_ID } from '../constants'
import { supabase } from '../supabase'

type ChatThreadRow = {
  id: string
  type: 'club' | 'direct_coach'
  title: string | null
  owner_user_id: string | null
  coach_user_id: string | null
  created_at: string
}

type ProfileRow = {
  id: string
  name: string | null
  nickname: string | null
  avatar_url: string | null
}

export type ClubThread = ChatThreadRow

export type DirectCoachThread = ChatThreadRow

export type CoachDirectThreadItem = DirectCoachThread & {
  student: ProfileRow | null
}

export type StudentProfile = ProfileRow

async function getOrCreateDirectCoachThreadViaApi(studentUserId: string): Promise<DirectCoachThread> {
  const response = await fetch('/api/chat/direct-thread', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      studentUserId,
    }),
  })

  const payload = await response.json().catch(() => null) as
    | {
        thread?: DirectCoachThread
        error?: string
      }
    | null

  if (!response.ok || !payload?.thread) {
    throw new Error(payload?.error ?? 'direct_thread_request_failed')
  }

  return payload.thread
}

async function findDirectCoachThread(ownerUserId: string) {
  const { data, error } = await supabase
    .from('chat_threads')
    .select('id, type, title, owner_user_id, coach_user_id, created_at')
    .eq('type', 'direct_coach')
    .eq('owner_user_id', ownerUserId)
    .eq('coach_user_id', COACH_USER_ID)
    .maybeSingle()

  if (error) {
    throw error
  }

  return (data as DirectCoachThread | null) ?? null
}

export async function getClubThread(): Promise<ClubThread> {
  const { data, error } = await supabase
    .from('chat_threads')
    .select('id, type, title, owner_user_id, coach_user_id, created_at')
    .eq('type', 'club')
    .single()

  if (error) {
    throw error
  }

  return data as ClubThread
}

export async function getChatThreadById(threadId: string): Promise<ChatThreadRow> {
  const { data, error } = await supabase
    .from('chat_threads')
    .select('id, type, title, owner_user_id, coach_user_id, created_at')
    .eq('id', threadId)
    .single()

  if (error) {
    throw error
  }

  return data as ChatThreadRow
}

export async function getOrCreateDirectCoachThread(currentUserId: string): Promise<DirectCoachThread> {
  return getOrCreateDirectCoachThreadViaApi(currentUserId)
}

export async function getOrCreateCoachDirectThreadForStudent(studentUserId: string): Promise<DirectCoachThread> {
  const response = await fetch('/api/chat/direct-thread', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      studentUserId,
    }),
  })

  const payload = await response.json().catch(() => null) as
    | {
        thread?: DirectCoachThread
        error?: string
      }
    | null

  if (!response.ok || !payload?.thread) {
    throw new Error(payload?.error ?? 'direct_thread_request_failed')
  }

  return payload.thread
}

export async function getCoachDirectThreads(): Promise<CoachDirectThreadItem[]> {
  const { data: threads, error: threadsError } = await supabase
    .from('chat_threads')
    .select('id, type, title, owner_user_id, coach_user_id, created_at')
    .eq('type', 'direct_coach')
    .eq('coach_user_id', COACH_USER_ID)
    .order('created_at', { ascending: false })

  if (threadsError) {
    throw threadsError
  }

  const threadRows = (threads as DirectCoachThread[] | null) ?? []
  const studentIds = Array.from(
    new Set(threadRows.map((thread) => thread.owner_user_id).filter((userId): userId is string => Boolean(userId)))
  )

  let profileById: Record<string, ProfileRow> = {}

  if (studentIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, name, nickname, avatar_url')
      .in('id', studentIds)

    if (profilesError) {
      throw profilesError
    }

    profileById = Object.fromEntries(
      ((profiles as ProfileRow[] | null) ?? []).map((profile) => [profile.id, profile])
    ) as Record<string, ProfileRow>
  }

  return threadRows.map((thread) => ({
    ...thread,
    student: thread.owner_user_id ? profileById[thread.owner_user_id] ?? null : null,
  }))
}

export async function getStudents(): Promise<StudentProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, nickname, avatar_url')
    .neq('id', COACH_USER_ID)
    .order('name', { ascending: true })

  if (error) {
    throw error
  }

  return (data as StudentProfile[] | null) ?? []
}
