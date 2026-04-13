import 'server-only'

import { createSupabaseServerClient } from './supabase-server'

export type RaceWeekSummary = {
  id: string
  slug: string
  startsAt: string
  endsAt: string
  timezone: string
  status: 'scheduled' | 'active' | 'finalized'
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

type RaceWeekDbRow = {
  id: string
  slug: string
  starts_at: string
  ends_at: string
  timezone: string
  status: 'scheduled' | 'active' | 'finalized'
  finalized_at: string | null
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

type RaceWeekResultIdDbRow = {
  id: string
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
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('race_weeks')
    .select('id, slug, starts_at, ends_at, timezone, status, finalized_at')
    .not('finalized_at', 'is', null)
    .order('finalized_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error('Не удалось загрузить завершенную неделю гонки')
  }

  return mapRaceWeek((data as RaceWeekDbRow | null) ?? null)
}

export async function loadFinalizedRaceWeek(weekId: string) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('race_weeks')
    .select('id, slug, starts_at, ends_at, timezone, status, finalized_at')
    .eq('id', weekId)
    .eq('status', 'finalized')
    .maybeSingle()

  if (error) {
    throw new Error('Не удалось загрузить неделю гонки')
  }

  return mapRaceWeek((data as RaceWeekDbRow | null) ?? null)
}

export async function loadRaceWeekTopResults(weekId: string) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('race_week_results')
    .select(
      'id, race_week_id, user_id, rank, total_xp, run_xp, like_xp, challenge_xp, race_bonus_xp, runs_count, display_name_snapshot, finalized_at'
    )
    .eq('race_week_id', weekId)
    .order('rank', { ascending: true })
    .limit(10)

  if (error) {
    throw new Error('Не удалось загрузить итоговые результаты недели')
  }

  return ((data as RaceWeekResultDbRow[] | null) ?? []).map(mapRaceWeekResult)
}

export async function loadRaceWeekUserResult(weekId: string, userId: string) {
  const supabase = await createSupabaseServerClient()
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
  const supabase = await createSupabaseServerClient()
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

export async function loadRaceWeekBadgesByUserIds(weekId: string, userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.filter((userId) => typeof userId === 'string' && userId.length > 0)))

  if (uniqueUserIds.length === 0) {
    return new Map<string, RaceWeekBadgeAward>()
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('user_badge_awards')
    .select('id, user_id, badge_code, race_week_id, source_type, source_rank, awarded_at')
    .eq('race_week_id', weekId)
    .eq('source_type', 'weekly_race')
    .in('user_id', uniqueUserIds)
    .order('awarded_at', { ascending: false })

  if (error) {
    throw new Error('Не удалось загрузить бейджи недели для таблицы результатов')
  }

  const badgesByUserId = new Map<string, RaceWeekBadgeAward>()

  for (const row of (data as RaceWeekBadgeDbRow[] | null) ?? []) {
    const badge = mapBadgeAward(row)

    if (!badge || badgesByUserId.has(badge.userId)) {
      continue
    }

    badgesByUserId.set(badge.userId, badge)
  }

  return badgesByUserId
}

export async function loadRaceWeekParticipantCount(weekId: string) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('race_week_results')
    .select('id')
    .eq('race_week_id', weekId)

  if (error) {
    throw new Error('Не удалось загрузить количество участников недели')
  }

  return ((data as RaceWeekResultIdDbRow[] | null) ?? []).length
}
