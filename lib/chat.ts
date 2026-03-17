import { formatRunDateTimeLabel } from './format'
import { getProfileDisplayName } from './profiles'
import { supabase } from './supabase'

export const CHAT_MESSAGE_MAX_LENGTH = 500

type ChatMessageRow = {
  id: string
  user_id: string
  text: string
  created_at: string
  is_deleted: boolean
}

type ProfileRow = {
  id: string
  name: string | null
  nickname?: string | null
  email: string | null
  avatar_url?: string | null
}

export type ChatMessageItem = {
  id: string
  userId: string
  text: string
  createdAt: string
  createdAtLabel: string
  isDeleted: boolean
  displayName: string
  avatarUrl: string | null
}

export async function createChatMessage(userId: string, text: string) {
  const trimmedText = text.trim()

  if (!trimmedText) {
    throw new Error('empty_message')
  }

  if (trimmedText.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw new Error('message_too_long')
  }

  return supabase.from('chat_messages').insert({
    user_id: userId,
    text: trimmedText,
  })
}

export async function loadRecentChatMessages(limit = 50): Promise<ChatMessageItem[]> {
  const { data: messages, error: messagesError } = await supabase
    .from('chat_messages')
    .select('id, user_id, text, created_at, is_deleted')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (messagesError) {
    throw messagesError
  }

  const messageRows = ((messages as ChatMessageRow[] | null) ?? []).slice().reverse()
  const userIds = Array.from(new Set(messageRows.map((message) => message.user_id)))

  let profileById: Record<string, ProfileRow> = {}

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, name, nickname, email, avatar_url')
      .in('id', userIds)

    if (profilesError) {
      throw profilesError
    }

    profileById = Object.fromEntries(((profiles as ProfileRow[] | null) ?? []).map((profile) => [profile.id, profile]))
  }

  return messageRows.map((message) => {
    const profile = profileById[message.user_id]

    return {
      id: message.id,
      userId: message.user_id,
      text: message.is_deleted ? 'Сообщение удалено' : message.text,
      createdAt: message.created_at,
      createdAtLabel: formatRunDateTimeLabel(message.created_at),
      isDeleted: message.is_deleted,
      displayName: getProfileDisplayName(profile, 'Бегун'),
      avatarUrl: profile?.avatar_url ?? null,
    }
  })
}
