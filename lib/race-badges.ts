type RaceBadgeWeekDateRange = {
  startsAt?: string | null
  endsAt?: string | null
  timezone?: string | null
  starts_at?: string | null
  ends_at?: string | null
}

export type RacePodiumBadgeTone = 'gold' | 'silver' | 'bronze' | null

export function formatRaceRankLabel(rank: number | null | undefined) {
  if (typeof rank !== 'number' || rank <= 0) {
    return ''
  }

  return `${rank} место`
}

export function isMatchingRacePodiumBadge(badgeCode: string | null | undefined, rank: number | null | undefined) {
  if (typeof rank !== 'number' || rank < 1 || rank > 3) {
    return false
  }

  if (rank === 1) {
    return badgeCode === 'weekly_race_1' || badgeCode === 'race_week_winner' || badgeCode === 'race_week_top_3'
  }

  if (rank === 2) {
    return badgeCode === 'weekly_race_2' || badgeCode === 'race_week_top_3'
  }

  return badgeCode === 'weekly_race_3' || badgeCode === 'race_week_top_3'
}

export function getRacePodiumBadgeTone(badgeCode: string | null | undefined, rank: number | null | undefined): RacePodiumBadgeTone {
  if (badgeCode === 'weekly_race_1' || badgeCode === 'race_week_winner') {
    return 'gold'
  }

  if (badgeCode === 'weekly_race_2') {
    return 'silver'
  }

  if (badgeCode === 'weekly_race_3') {
    return 'bronze'
  }

  if (badgeCode === 'race_week_top_3' && rank === 1) {
    return 'gold'
  }

  if (badgeCode === 'race_week_top_3' && rank === 2) {
    return 'silver'
  }

  if (badgeCode === 'race_week_top_3' && rank === 3) {
    return 'bronze'
  }

  return null
}

export function isRacePodiumBadge(badgeCode: string | null | undefined, rank: number | null | undefined) {
  return getRacePodiumBadgeTone(badgeCode, rank) !== null
}

export function getRaceBadgeLabel(badgeCode: string | null | undefined, rank: number | null | undefined) {
  if (badgeCode === 'weekly_race_1' || badgeCode === 'race_week_winner') {
    return '1 место'
  }

  if (badgeCode === 'weekly_race_2') {
    return '2 место'
  }

  if (badgeCode === 'weekly_race_3') {
    return '3 место'
  }

  if (badgeCode === 'race_week_top_3' && rank === 2) {
    return '2 место'
  }

  if (badgeCode === 'race_week_top_3' && rank === 3) {
    return '3 место'
  }

  if (badgeCode === 'race_week_top_3') {
    return 'Топ-3'
  }

  if (badgeCode === 'race_week_top_10') {
    return typeof rank === 'number' && rank > 0 ? formatRaceRankLabel(rank) : 'Топ-10'
  }

  if (typeof rank === 'number' && rank > 0) {
    return formatRaceRankLabel(rank)
  }

  return 'Без бейджа'
}

export function formatRacePlacementLabel(args: {
  badgeCode: string | null | undefined
  rank: number | null | undefined
  totalParticipants: number | null | undefined
}) {
  const { badgeCode, rank, totalParticipants } = args

  if (!Number.isFinite(totalParticipants) || (totalParticipants ?? 0) <= 0) {
    return ''
  }

  if (badgeCode === 'weekly_race_1' || badgeCode === 'race_week_winner') {
    return `1 из ${totalParticipants} участников`
  }

  if (badgeCode === 'weekly_race_2') {
    return `2 из ${totalParticipants} участников`
  }

  if (badgeCode === 'weekly_race_3') {
    return `3 из ${totalParticipants} участников`
  }

  if (badgeCode === 'race_week_top_3' && typeof rank === 'number' && rank > 0) {
    return `${rank} из ${totalParticipants} участников`
  }

  if (badgeCode === 'race_week_top_10') {
    return typeof rank === 'number' && rank > 0
      ? `${rank} из ${totalParticipants} участников`
      : `Топ-10 из ${totalParticipants} участников`
  }

  if (typeof rank === 'number' && rank > 0) {
    return `${rank} из ${totalParticipants} участников`
  }

  return ''
}

export function formatRaceWeekDateRange(week: RaceBadgeWeekDateRange) {
  const startsAt = week.startsAt ?? week.starts_at ?? null
  const endsAt = week.endsAt ?? week.ends_at ?? null
  const timezone = week.timezone ?? 'UTC'

  if (!startsAt || !endsAt) {
    return 'Даты недели неизвестны'
  }

  const startDate = new Date(startsAt)
  const endDateInclusive = new Date(new Date(endsAt).getTime() - 1)

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDateInclusive.getTime())) {
    return 'Даты недели неизвестны'
  }

  const formatter = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  })

  return `${formatter.format(startDate)} - ${formatter.format(endDateInclusive)}`
}
