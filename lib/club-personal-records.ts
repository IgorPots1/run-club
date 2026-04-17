export const CLUB_PERSONAL_RECORD_DISTANCES = [5000, 10000, 21097, 42195] as const

export type ClubPersonalRecordDistance = (typeof CLUB_PERSONAL_RECORD_DISTANCES)[number]

export const CLUB_PERSONAL_RECORD_DISTANCE_LABELS: Record<ClubPersonalRecordDistance, string> = {
  5000: '5 км',
  10000: '10 км',
  21097: '21.1 км',
  42195: '42.2 км',
}

export const CLUB_PERSONAL_RECORD_EXCLUDED_USER_ID = '9c831c40-928d-4d0c-99f7-393b2b985290'

export type ClubPersonalRecordLeaderboardRow = {
  rank: number
  userId: string
  displayName: string
  avatarUrl: string | null
  durationSeconds: number
  recordDate: string | null
}

export type ClubPersonalRecordLeaderboardResponse = {
  rows: ClubPersonalRecordLeaderboardRow[]
}

export function isClubPersonalRecordDistance(value: unknown): value is ClubPersonalRecordDistance {
  const normalizedValue = Number(value)

  return CLUB_PERSONAL_RECORD_DISTANCES.some((distance) => distance === normalizedValue)
}
