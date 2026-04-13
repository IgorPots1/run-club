import 'server-only'

import { formatRacePlacementLabel, formatRaceWeekDateRange, getRaceBadgeLabel } from './race-badges'
import { createSupabaseServerClient } from './supabase-server'

type RaceBadgeAwardDbRow = {
  id: string
  badge_code: string
  race_week_id: string | null
  source_rank: number | string | null
  awarded_at: string
}

type RaceWeekDbRow = {
  id: string
  starts_at: string
  ends_at: string
  timezone: string
}

type RaceWeekResultWeekIdDbRow = {
  id: string
  race_week_id: string
  user_id: string
}

type ProfileAccessDbRow = {
  id: string
  app_access_status: 'active' | 'blocked' | null
}

type ChallengeCompletionDbRow = {
  challenge_id: string
  completed_at: string
  period_key: string | null
}

type ChallengeDbRow = {
  id: string
  title: string
  description: string | null
  xp_reward: number | null
  kind: string | null
}

export type UserAchievement = {
  id: string
  source_type: 'weekly_race' | 'challenge'
  badge_code?: string | null
  label: string
  date: string
  subtitle: string
  href: string | null
  rank?: number | null
}

type LoadUserAchievementsOptions = {
  limit?: number
}

function toSafeNumber(value: number | string | null | undefined) {
  const numericValue = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(numericValue) ? Number(numericValue) : null
}

function getChallengeSubtitle(challenge: Pick<ChallengeDbRow, 'description' | 'xp_reward'>) {
  const description = challenge.description?.trim() ?? ''
  const xpReward = Number(challenge.xp_reward ?? 0)

  if (description && xpReward > 0) {
    return `${description} • +${xpReward} XP`
  }

  if (description) {
    return description
  }

  if (xpReward > 0) {
    return `Челлендж выполнен • +${xpReward} XP`
  }

  return 'Челлендж выполнен'
}

function compareByDateDesc(left: Pick<UserAchievement, 'date' | 'id'>, right: Pick<UserAchievement, 'date' | 'id'>) {
  const leftTime = new Date(left.date).getTime()
  const rightTime = new Date(right.date).getTime()

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime
  }

  if (Number.isFinite(leftTime) && !Number.isFinite(rightTime)) {
    return -1
  }

  if (!Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return 1
  }

  return right.id.localeCompare(left.id)
}

function isMissingChallengeKindColumnError(error: { code?: string | null; message?: string | null }) {
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    Boolean(error.message?.includes('challenges.kind')) ||
    Boolean(error.message?.includes("'kind' column of 'challenges'"))
  )
}

async function loadChallengesByIds(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  challengeIds: string[]
) {
  if (challengeIds.length === 0) {
    return [] as ChallengeDbRow[]
  }

  const primaryResult = await supabase
    .from('challenges')
    .select('id, title, description, xp_reward, kind')
    .in('id', challengeIds)

  if (!primaryResult.error) {
    return (primaryResult.data as ChallengeDbRow[] | null) ?? []
  }

  if (!isMissingChallengeKindColumnError(primaryResult.error)) {
    throw primaryResult.error
  }

  const fallbackResult = await supabase
    .from('challenges')
    .select('id, title, description, xp_reward')
    .in('id', challengeIds)

  if (fallbackResult.error) {
    throw fallbackResult.error
  }

  return (((fallbackResult.data as Array<Omit<ChallengeDbRow, 'kind'>> | null) ?? [])).map((challenge) => ({
    ...challenge,
    kind: null,
  }))
}

export async function loadUserAchievements(userId: string, options: LoadUserAchievementsOptions = {}): Promise<UserAchievement[]> {
  const supabase = await createSupabaseServerClient()
  const limit = typeof options.limit === 'number' && Number.isFinite(options.limit)
    ? Math.max(1, Math.floor(options.limit))
    : null

  const [{ data: raceAwards, error: raceAwardsError }, { data: challengeCompletions, error: challengeCompletionsError }] = await Promise.all([
    (async () => {
      let query = supabase
        .from('user_badge_awards')
        .select('id, badge_code, race_week_id, source_rank, awarded_at')
        .eq('user_id', userId)
        .eq('source_type', 'weekly_race')
        .order('awarded_at', { ascending: false })

      if (limit !== null) {
        query = query.limit(limit)
      }

      return query
    })(),
    (async () => {
      let query = supabase
        .from('user_challenges')
        .select('challenge_id, completed_at, period_key')
        .eq('user_id', userId)
        .order('completed_at', { ascending: false })

      if (limit !== null) {
        query = query.limit(limit)
      }

      return query
    })(),
  ])

  if (raceAwardsError) {
    throw new Error('Не удалось загрузить достижения гонки')
  }

  if (challengeCompletionsError) {
    throw new Error('Не удалось загрузить достижения челленджей')
  }

  const safeRaceAwards = (raceAwards as RaceBadgeAwardDbRow[] | null) ?? []
  const safeChallengeCompletions = (challengeCompletions as ChallengeCompletionDbRow[] | null) ?? []
  const raceWeekIds = Array.from(
    new Set(
      safeRaceAwards
        .map((award) => award.race_week_id)
        .filter((raceWeekId): raceWeekId is string => typeof raceWeekId === 'string' && raceWeekId.length > 0)
    )
  )
  const challengeIds = Array.from(new Set(safeChallengeCompletions.map((completion) => completion.challenge_id)))

  const [
    { data: raceWeeks, error: raceWeeksError },
    { data: raceWeekResults, error: raceWeekResultsError },
    { data: challenges, error: challengesError },
  ] = await Promise.all([
    raceWeekIds.length > 0
      ? supabase
          .from('race_weeks')
          .select('id, starts_at, ends_at, timezone')
          .in('id', raceWeekIds)
      : Promise.resolve({ data: [] as RaceWeekDbRow[], error: null }),
    raceWeekIds.length > 0
      ? supabase
          .from('race_week_results')
          .select('id, race_week_id, user_id')
          .in('race_week_id', raceWeekIds)
      : Promise.resolve({ data: [] as RaceWeekResultWeekIdDbRow[], error: null }),
    loadChallengesByIds(supabase, challengeIds)
      .then((data) => ({ data, error: null }))
      .catch((error: unknown) => ({ data: [] as ChallengeDbRow[], error })),
  ])

  if (raceWeeksError) {
    throw new Error('Не удалось загрузить недели гонки для достижений')
  }

  if (raceWeekResultsError) {
    throw new Error('Не удалось загрузить участников недели для достижений')
  }

  const participantUserIds = Array.from(
    new Set((((raceWeekResults as RaceWeekResultWeekIdDbRow[] | null) ?? [])).map((row) => row.user_id))
  )
  const { data: profiles, error: profilesError } = participantUserIds.length === 0
    ? { data: [] as ProfileAccessDbRow[], error: null }
    : await supabase
        .from('profiles')
        .select('id, app_access_status')
        .in('id', participantUserIds)

  if (profilesError) {
    throw new Error('Не удалось загрузить участников недели для достижений')
  }

  if (challengesError) {
    throw new Error('Не удалось загрузить челленджи для достижений')
  }

  const raceWeeksById = new Map(((raceWeeks as RaceWeekDbRow[] | null) ?? []).map((week) => [week.id, week] as const))
  const activeUserIds = new Set(
    ((profiles as ProfileAccessDbRow[] | null) ?? [])
      .filter((profile) => profile.app_access_status === 'active')
      .map((profile) => profile.id)
  )
  const participantCountsByWeekId = (((raceWeekResults as RaceWeekResultWeekIdDbRow[] | null) ?? [])).reduce<Record<string, number>>(
    (totals, row) => {
      if (!activeUserIds.has(row.user_id)) {
        return totals
      }

      totals[row.race_week_id] = (totals[row.race_week_id] ?? 0) + 1
      return totals
    },
    {}
  )
  const challengesById = new Map(((challenges as ChallengeDbRow[] | null) ?? []).map((challenge) => [challenge.id, challenge] as const))

  const raceAchievements: UserAchievement[] = safeRaceAwards.map((award) => {
    const week = award.race_week_id ? raceWeeksById.get(award.race_week_id) : null
    const rank = toSafeNumber(award.source_rank)
    const subtitle = formatRacePlacementLabel({
      badgeCode: award.badge_code,
      rank,
      totalParticipants: award.race_week_id ? (participantCountsByWeekId[award.race_week_id] ?? 0) : null,
    })
    const dateRangeLabel = formatRaceWeekDateRange({
      starts_at: week?.starts_at ?? null,
      ends_at: week?.ends_at ?? null,
      timezone: week?.timezone ?? null,
    })

    return {
      id: `race-${award.id}`,
      source_type: 'weekly_race',
      badge_code: award.badge_code,
      label: getRaceBadgeLabel(award.badge_code, rank),
      date: award.awarded_at,
      subtitle: subtitle ? `${dateRangeLabel} • ${subtitle}` : dateRangeLabel,
      href: award.race_week_id ? `/race/history/${award.race_week_id}` : null,
      rank,
    }
  })

  const challengeAchievements = safeChallengeCompletions.reduce<UserAchievement[]>((achievements, completion) => {
    const challenge = challengesById.get(completion.challenge_id)

    if (!challenge) {
      return achievements
    }

    achievements.push({
      id: `challenge-${completion.challenge_id}-${completion.period_key ?? 'legacy'}`,
      source_type: 'challenge',
      badge_code: 'challenge_completion',
      label: challenge.title,
      date: completion.completed_at,
      subtitle: getChallengeSubtitle(challenge),
      href: null,
      rank: null,
    })

    return achievements
  }, [])

  const achievements = [...raceAchievements, ...challengeAchievements].sort(compareByDateDesc)

  return limit === null ? achievements : achievements.slice(0, limit)
}
