const RUN_BASE_XP = 40
const MIN_RUN_DISTANCE_KM_FOR_XP = 1
const RUN_XP_FREQUENCY_WINDOW_MS = 10 * 60 * 1000
const FIRST_DISTANCE_TIER_LIMIT_KM = 10
const SECOND_DISTANCE_TIER_LIMIT_KM = 20
const FIRST_DISTANCE_TIER_XP_PER_KM = 9
const SECOND_DISTANCE_TIER_XP_PER_KM = 7
const THIRD_DISTANCE_TIER_XP_PER_KM = 5
const MIN_DISTANCE_KM_FOR_ELEVATION_XP = 3
const ELEVATION_METERS_PER_XP = 20
const MAX_ELEVATION_XP = 25
const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export type RunXpPresentationRun = {
  id: string
  created_at: string
  distance_km?: number | null
  elevation_gain_meters?: number | null
  external_source?: string | null
  xp?: number | null
}

type RunXpPresentationHistoryRun = Pick<RunXpPresentationRun, 'id' | 'created_at'>

export type RunXpBreakdownRow = {
  id:
    | 'run_effort'
    | 'base_xp'
    | 'distance_contribution'
    | 'consistency_bonus'
    | 'elevation_bonus'
    | 'duration_bonus'
    | 'cap_adjustment'
    | 'final_awarded'
  label: string
  value: number
  emphasis?: 'default' | 'strong' | 'negative'
}

export type RunXpPresentation = {
  finalAwardedXp: number
  runEffortXp: number
  elevationBonusXp: number
  durationBonusXp: number
  weeklyConsistencyBonusXp: number
  capAdjustmentXp: number
  breakdownRows: RunXpBreakdownRow[]
}

function toRoundedNonNegativeNumber(value: unknown) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? Math.max(0, Math.round(numericValue)) : 0
}

function calculateRunDistanceXp(distanceKm: number) {
  const normalizedDistanceKm = Number.isFinite(distanceKm) ? Math.max(0, Number(distanceKm)) : 0
  const firstTierDistanceKm = Math.min(normalizedDistanceKm, FIRST_DISTANCE_TIER_LIMIT_KM)
  const secondTierDistanceKm = Math.min(
    Math.max(normalizedDistanceKm - FIRST_DISTANCE_TIER_LIMIT_KM, 0),
    SECOND_DISTANCE_TIER_LIMIT_KM - FIRST_DISTANCE_TIER_LIMIT_KM
  )
  const thirdTierDistanceKm = Math.max(normalizedDistanceKm - SECOND_DISTANCE_TIER_LIMIT_KM, 0)

  return Math.max(
    0,
    Math.round(
      (firstTierDistanceKm * FIRST_DISTANCE_TIER_XP_PER_KM)
        + (secondTierDistanceKm * SECOND_DISTANCE_TIER_XP_PER_KM)
        + (thirdTierDistanceKm * THIRD_DISTANCE_TIER_XP_PER_KM)
    )
  )
}

function calculateElevationXp(run: RunXpPresentationRun, distanceKm: number) {
  const normalizedElevationGainMeters = Number.isFinite(run.elevation_gain_meters)
    ? Math.max(0, Math.floor(Number(run.elevation_gain_meters)))
    : 0
  const normalizedExternalSource = run.external_source?.trim() ?? ''
  const isTrustedImportedRun = normalizedExternalSource.length > 0

  if (!isTrustedImportedRun || distanceKm < MIN_DISTANCE_KM_FOR_ELEVATION_XP) {
    return 0
  }

  return Math.min(
    Math.floor(normalizedElevationGainMeters / ELEVATION_METERS_PER_XP),
    MAX_ELEVATION_XP
  )
}

function getWeeklyConsistencyBonus(runCountLast7Days: number) {
  const normalizedRunCount = Number.isFinite(runCountLast7Days)
    ? Math.max(0, Math.round(runCountLast7Days))
    : 0

  if (normalizedRunCount >= 5) {
    return 50
  }

  if (normalizedRunCount >= 3) {
    return 30
  }

  if (normalizedRunCount >= 2) {
    return 15
  }

  return 0
}

export function getRunXpPresentation(
  run: RunXpPresentationRun,
  userRunHistory: RunXpPresentationHistoryRun[]
): RunXpPresentation {
  const totalXp = toRoundedNonNegativeNumber(run.xp)

  function buildBreakdownRows({
    runEffortXp,
    baseXp = 0,
    distanceContributionXp = 0,
    elevationBonusXp,
    durationBonusXp,
    weeklyConsistencyBonusXp,
    capAdjustmentXp,
  }: {
    runEffortXp: number
    baseXp?: number
    distanceContributionXp?: number
    elevationBonusXp: number
    durationBonusXp: number
    weeklyConsistencyBonusXp: number
    capAdjustmentXp: number
  }): RunXpBreakdownRow[] {
    const rows: RunXpBreakdownRow[] = []

    if (runEffortXp > 0) {
      rows.push({
        id: 'run_effort',
        label: 'Беговое усилие',
        value: runEffortXp,
        emphasis: 'strong',
      })
    }

    if (baseXp > 0) {
      rows.push({
        id: 'base_xp',
        label: 'Базовый XP',
        value: baseXp,
      })
    }

    if (distanceContributionXp > 0) {
      rows.push({
        id: 'distance_contribution',
        label: 'Дистанция',
        value: distanceContributionXp,
      })
    }

    if (weeklyConsistencyBonusXp > 0) {
      rows.push({
        id: 'consistency_bonus',
        label: 'Бонус за регулярность',
        value: weeklyConsistencyBonusXp,
      })
    }

    if (elevationBonusXp > 0) {
      rows.push({
        id: 'elevation_bonus',
        label: 'Бонус за набор высоты',
        value: elevationBonusXp,
      })
    }

    if (durationBonusXp > 0) {
      rows.push({
        id: 'duration_bonus',
        label: 'Бонус за длительность',
        value: durationBonusXp,
      })
    }

    if (capAdjustmentXp < 0) {
      rows.push({
        id: 'cap_adjustment',
        label: 'Корректировка лимита',
        value: capAdjustmentXp,
        emphasis: 'negative',
      })
    }

    rows.push({
      id: 'final_awarded',
      label: 'Итоговое начисление',
      value: totalXp,
      emphasis: 'strong',
    })

    return rows
  }

  if (totalXp <= 0) {
    return {
      finalAwardedXp: 0,
      runEffortXp: 0,
      elevationBonusXp: 0,
      durationBonusXp: 0,
      weeklyConsistencyBonusXp: 0,
      capAdjustmentXp: 0,
      breakdownRows: buildBreakdownRows({
        runEffortXp: 0,
        elevationBonusXp: 0,
        durationBonusXp: 0,
        weeklyConsistencyBonusXp: 0,
        capAdjustmentXp: 0,
      }),
    }
  }

  const createdAtMs = new Date(run.created_at).getTime()

  if (!Number.isFinite(createdAtMs)) {
    return {
      finalAwardedXp: totalXp,
      runEffortXp: totalXp,
      elevationBonusXp: 0,
      durationBonusXp: 0,
      weeklyConsistencyBonusXp: 0,
      capAdjustmentXp: 0,
      breakdownRows: buildBreakdownRows({
        runEffortXp: totalXp,
        elevationBonusXp: 0,
        durationBonusXp: 0,
        weeklyConsistencyBonusXp: 0,
        capAdjustmentXp: 0,
      }),
    }
  }

  const normalizedDistanceKm = Number.isFinite(run.distance_km) ? Math.max(0, Number(run.distance_km)) : 0

  if (normalizedDistanceKm < MIN_RUN_DISTANCE_KM_FOR_XP) {
    return {
      finalAwardedXp: totalXp,
      runEffortXp: totalXp,
      elevationBonusXp: 0,
      durationBonusXp: 0,
      weeklyConsistencyBonusXp: 0,
      capAdjustmentXp: 0,
      breakdownRows: buildBreakdownRows({
        runEffortXp: totalXp,
        elevationBonusXp: 0,
        durationBonusXp: 0,
        weeklyConsistencyBonusXp: 0,
        capAdjustmentXp: 0,
      }),
    }
  }

  const runFrequencyWindowStartMs = createdAtMs - RUN_XP_FREQUENCY_WINDOW_MS
  const recentRunExists = userRunHistory.some((candidateRun) => {
    if (candidateRun.id === run.id) {
      return false
    }

    const candidateCreatedAtMs = new Date(candidateRun.created_at).getTime()
    return Number.isFinite(candidateCreatedAtMs)
      && candidateCreatedAtMs >= runFrequencyWindowStartMs
      && candidateCreatedAtMs <= createdAtMs
  })

  if (recentRunExists) {
    return {
      finalAwardedXp: totalXp,
      runEffortXp: totalXp,
      elevationBonusXp: 0,
      durationBonusXp: 0,
      weeklyConsistencyBonusXp: 0,
      capAdjustmentXp: 0,
      breakdownRows: buildBreakdownRows({
        runEffortXp: totalXp,
        elevationBonusXp: 0,
        durationBonusXp: 0,
        weeklyConsistencyBonusXp: 0,
        capAdjustmentXp: 0,
      }),
    }
  }

  const workoutXp = RUN_BASE_XP
  const distanceXp = calculateRunDistanceXp(normalizedDistanceKm)
  const runEffortXp = workoutXp + distanceXp
  const elevationXp = calculateElevationXp(run, normalizedDistanceKm)
  const durationBonusXp = 0
  const weeklyWindowStartMs = createdAtMs - WEEKLY_WINDOW_MS
  const runCountLast7Days = userRunHistory.reduce((count, candidateRun) => {
    const candidateCreatedAtMs = new Date(candidateRun.created_at).getTime()

    if (!Number.isFinite(candidateCreatedAtMs)) {
      return count
    }

    return (
      candidateCreatedAtMs >= weeklyWindowStartMs &&
      candidateCreatedAtMs <= createdAtMs
    )
      ? count + 1
      : count
  }, 0)
  const weeklyConsistencyBonus = getWeeklyConsistencyBonus(runCountLast7Days)
  const rawTotalXp = runEffortXp + elevationXp + durationBonusXp + weeklyConsistencyBonus

  if (totalXp > rawTotalXp) {
    return {
      finalAwardedXp: totalXp,
      runEffortXp: totalXp,
      elevationBonusXp: 0,
      durationBonusXp: 0,
      weeklyConsistencyBonusXp: 0,
      capAdjustmentXp: 0,
      breakdownRows: buildBreakdownRows({
        runEffortXp: totalXp,
        elevationBonusXp: 0,
        durationBonusXp: 0,
        weeklyConsistencyBonusXp: 0,
        capAdjustmentXp: 0,
      }),
    }
  }

  const capAdjustmentXp = totalXp < rawTotalXp ? totalXp - rawTotalXp : 0

  return {
    finalAwardedXp: totalXp,
    runEffortXp,
    elevationBonusXp: elevationXp,
    durationBonusXp,
    weeklyConsistencyBonusXp: weeklyConsistencyBonus,
    capAdjustmentXp,
    breakdownRows: buildBreakdownRows({
      runEffortXp,
      baseXp: workoutXp,
      distanceContributionXp: distanceXp,
      elevationBonusXp: elevationXp,
      durationBonusXp,
      weeklyConsistencyBonusXp: weeklyConsistencyBonus,
      capAdjustmentXp,
    }),
  }
}
