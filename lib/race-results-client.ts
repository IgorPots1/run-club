import { supabase } from './supabase'

export type RaceWeekSummary = {
  id: string
  slug: string
  startsAt: string
  endsAt: string
  timezone: string
  status: 'active' | 'finalized'
  finalizedAt: string | null
}

export type RaceWeekResultRow = {
  id: string
  raceWeekId: string
  userId: string
  rank: number
  totalXp: number
  runXp: number
  likeXp: number
  challengeXp: number
  raceBonusXp: number
  runsCount: number | null
  displayName: string
  finalizedAt: string
}

export type RaceWeekBadgeAward = {
  id: string
  userId: string
  badgeCode: string
  raceWeekId: string | null
  sourceType: string
  sourceRank: number | null
  awardedAt: string
}

export type UserRaceBadgeAwardSummary = {
  badge_code: string
  race_week_id: string | null
  source_rank: number | null
  starts_at: string | null
  ends_at: string | null
  timezone: string | null
  participant_count: number | null
}

type RaceWeekDbRow = {
  id: string
  slug: string
  starts_at: string
  ends_at: string
  timezone: string
  status: 'active' | 'finalized'
  finalized_at: string | null
}

type RaceWeekDateRangeDbRow = {
  id: string
  starts_at: string
  ends_at: string
  timezone: string
}

type RaceWeekResultDbRow = {
  id: string
  race_week_id: string
  user_id: string
  rank: number | string | null
  total_xp: number | string | null
  run_xp: number | string | null
  like_xp: number | string | null
  challenge_xp: number | string | null
  race_bonus_xp: number | string | null
  runs_count: number | string | null
  display_name_snapshot: string | null
  finalized_at: string
}

type RaceWeekBadgeDbRow = {
  id: string
  user_id: string
  badge_code: string
  race_week_id: string | null
  source_type: string
  source_rank: number | string | null
  awarded_at: string
}

type RaceWeekResultWeekIdDbRow = {
  id: string
  race_week_id: string
}

function toSafeNumber(value: number | string | null | undefined) {
  const numericValue = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(numericValue) ? Number(numericValue) : 0
}

function mapRaceWeek(row: RaceWeekDbRow | null): RaceWeekSummary | null {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    slug: row.slug,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    status: row.status,
    finalizedAt: row.finalized_at,
  }
}

function mapRaceWeekResult(row: RaceWeekResultDbRow): RaceWeekResultRow {
  return {
    id: row.id,
    raceWeekId: row.race_week_id,
    userId: row.user_id,
    rank: Math.max(0, toSafeNumber(row.rank)),
    totalXp: toSafeNumber(row.total_xp),
    runXp: toSafeNumber(row.run_xp),
    likeXp: toSafeNumber(row.like_xp),
    challengeXp: toSafeNumber(row.challenge_xp),
    raceBonusXp: toSafeNumber(row.race_bonus_xp),
    runsCount: row.runs_count === null ? null : toSafeNumber(row.runs_count),
    displayName: row.display_name_snapshot?.trim() || 'Бегун',
    finalizedAt: row.finalized_at,
  }
}

function mapBadgeAward(row: RaceWeekBadgeDbRow | null): RaceWeekBadgeAward | null {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    userId: row.user_id,
    badgeCode: row.badge_code,
    raceWeekId: row.race_week_id,
    sourceType: row.source_type,
    sourceRank: row.source_rank === null ? null : toSafeNumber(row.source_rank),
    awardedAt: row.awarded_at,
  }
}

export async function loadLatestFinalizedRaceWeek() {
  const { data, error } = await supabase
    .from('race_weeks')
    .select('id, slug, starts_at, ends_at, timezone, status, finalized_at')
    .eq('status', 'finalized')
    .order('ends_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error('Не удалось загрузить завершенную неделю гонки')
  }

  return mapRaceWeek((data as RaceWeekDbRow | null) ?? null)
}

export async function loadRaceWeekUserResult(weekId: string, userId: string) {
  const { data, error } = await supabase
    .from('race_week_results')
    .select(
      'id, race_week_id, user_id, rank, total_xp, run_xp, like_xp, challenge_xp, race_bonus_xp, runs_count, display_name_snapshot, finalized_at'
    )
    .eq('race_week_id', weekId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw new Error('Не удалось загрузить результат пользователя за неделю')
  }

  return data ? mapRaceWeekResult(data as RaceWeekResultDbRow) : null
}

export async function loadRaceWeekUserBadge(weekId: string, userId: string) {
  const { data, error } = await supabase
    .from('user_badge_awards')
    .select('id, user_id, badge_code, race_week_id, source_type, source_rank, awarded_at')
    .eq('race_week_id', weekId)
    .eq('user_id', userId)
    .eq('source_type', 'weekly_race')
    .order('awarded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error('Не удалось загрузить бейдж пользователя за неделю')
  }

  return mapBadgeAward((data as RaceWeekBadgeDbRow | null) ?? null)
}

export async function loadUserRaceBadgeAwards(userId: string, limit = 3): Promise<UserRaceBadgeAwardSummary[]> {
  const safeLimit = Math.max(1, Math.floor(limit))
  const { data, error } = await supabase
    .from('user_badge_awards')
    .select('badge_code, race_week_id, source_rank')
    .eq('user_id', userId)
    .eq('source_type', 'weekly_race')
    .order('awarded_at', { ascending: false })
    .limit(safeLimit)

  if (error) {
    throw new Error('Не удалось загрузить достижения пользователя')
  }

  const awards = ((data as Pick<RaceWeekBadgeDbRow, 'badge_code' | 'race_week_id' | 'source_rank'>[] | null) ?? []).map((row) => ({
    badge_code: row.badge_code,
    race_week_id: row.race_week_id,
    source_rank: row.source_rank === null ? null : toSafeNumber(row.source_rank),
  }))
  const raceWeekIds = Array.from(
    new Set(
      awards
        .map((award) => award.race_week_id)
        .filter((raceWeekId): raceWeekId is string => typeof raceWeekId === 'string' && raceWeekId.length > 0)
    )
  )

  if (raceWeekIds.length === 0) {
    return awards.map((award) => ({
      ...award,
      starts_at: null,
      ends_at: null,
      timezone: null,
      participant_count: null,
    }))
  }

  const [{ data: raceWeeks, error: raceWeeksError }, { data: raceWeekResults, error: raceWeekResultsError }] = await Promise.all([
    supabase
      .from('race_weeks')
      .select('id, starts_at, ends_at, timezone')
      .in('id', raceWeekIds),
    supabase
      .from('race_week_results')
      .select('id, race_week_id')
      .in('race_week_id', raceWeekIds),
  ])

  if (raceWeeksError) {
    throw new Error('Не удалось загрузить недели гонки для достижений')
  }

  if (raceWeekResultsError) {
    throw new Error('Не удалось загрузить участников недели для достижений')
  }

  const raceWeeksById = new Map(
    (((raceWeeks as RaceWeekDateRangeDbRow[] | null) ?? [])).map((week) => [week.id, week] as const)
  )
  const participantCountsByWeekId = (((raceWeekResults as RaceWeekResultWeekIdDbRow[] | null) ?? [])).reduce<Record<string, number>>(
    (totals, row) => {
      totals[row.race_week_id] = (totals[row.race_week_id] ?? 0) + 1
      return totals
    },
    {}
  )

  return awards.map((award) => {
    const week = award.race_week_id ? raceWeeksById.get(award.race_week_id) : null

    return {
      ...award,
      starts_at: week?.starts_at ?? null,
      ends_at: week?.ends_at ?? null,
      timezone: week?.timezone ?? null,
      participant_count: award.race_week_id ? (participantCountsByWeekId[award.race_week_id] ?? 0) : null,
    }
  })
}
