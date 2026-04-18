import 'server-only'

import {
  CLUB_PERSONAL_RECORD_EXCLUDED_USER_ID,
  type ClubPersonalRecordDistance,
  type ClubPersonalRecordLeaderboardRow,
} from '@/lib/club-personal-records'
import { getProfileDisplayName } from '@/lib/profiles'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type PersonalRecordLeaderboardQueryRow = {
  user_id: string
  run_id: string | null
  duration_seconds: number
  record_date: string | null
}

type PersonalRecordLeaderboardProfileRow = {
  id: string
  first_name: string | null
  last_name: string | null
  name: string | null
  nickname: string | null
  avatar_url: string | null
}

export async function loadClubPersonalRecordLeaderboard(
  distance: ClubPersonalRecordDistance
): Promise<ClubPersonalRecordLeaderboardRow[]> {
  const supabaseAdmin = createSupabaseAdminClient()
  const { data: recordRows, error: recordError } = await supabaseAdmin
    .from('personal_records')
    .select('user_id, run_id, duration_seconds, record_date')
    .eq('distance_meters', distance)
    .neq('user_id', CLUB_PERSONAL_RECORD_EXCLUDED_USER_ID)
    .order('duration_seconds', { ascending: true })
    .order('record_date', { ascending: true, nullsFirst: false })
    .order('user_id', { ascending: true })

  if (recordError) {
    throw recordError
  }

  const records = ((recordRows as PersonalRecordLeaderboardQueryRow[] | null) ?? [])
    .filter((row) => Number.isFinite(row.duration_seconds) && Number(row.duration_seconds) > 0)
  const userIds = Array.from(new Set(records.map((row) => row.user_id)))
  const { data: profileRows, error: profileError } = userIds.length === 0
    ? { data: [] as PersonalRecordLeaderboardProfileRow[], error: null }
    : await supabaseAdmin
        .from('profiles')
        .select('id, first_name, last_name, name, nickname, avatar_url')
        .in('id', userIds)

  if (profileError) {
    throw profileError
  }

  const profilesById = new Map(
    ((profileRows as PersonalRecordLeaderboardProfileRow[] | null) ?? []).map((profile) => [profile.id, profile])
  )

  return records.map((row, index) => {
    const profile = profilesById.get(row.user_id)

    return {
      rank: index + 1,
      userId: row.user_id,
      displayName: getProfileDisplayName(profile, 'Бегун'),
      avatarUrl: profile?.avatar_url ?? null,
      runId: row.run_id ?? null,
      durationSeconds: Number(row.duration_seconds),
      recordDate: row.record_date ?? null,
    }
  })
}
