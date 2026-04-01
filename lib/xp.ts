const XP_BY_LEVEL = [0, 200, 500, 900, 1400, 2000, 2700, 3500, 4400, 5400]

export type ClubLevelDefinition = {
  level: number
  minXp: number
  title: string
}

export type XpBreakdownItem = {
  label: string
  value: number
}

type RunXpBreakdownParts = {
  workoutXp: number
  distanceXp: number
  weeklyConsistencyBonus?: number
}

export function getLevelFromXP(totalXP: number): { level: number; nextLevelXP: number | null } {
  let level = 1
  for (let i = XP_BY_LEVEL.length - 1; i >= 0; i--) {
    if (totalXP >= XP_BY_LEVEL[i]) {
      level = i + 1
      break
    }
  }
  const nextLevelXP = level < 10 ? XP_BY_LEVEL[level] : null
  return { level, nextLevelXP }
}

export function getRankTitleFromLevel(level: number): string {
  if (level <= 2) return 'Новичок'
  if (level <= 4) return 'Вкатился'
  if (level <= 6) return 'Стабильный'
  if (level <= 8) return 'В форме'
  return 'Мотор клуба'
}

export function getRankTitleFromXP(totalXP: number): string {
  return getRankTitleFromLevel(getLevelFromXP(totalXP).level)
}

export function getClubLevelDefinitions(): ClubLevelDefinition[] {
  return XP_BY_LEVEL.map((minXp, index) => ({
    level: index + 1,
    minXp,
    title: getRankTitleFromLevel(index + 1),
  }))
}

export function buildRunXpBreakdown({
  workoutXp,
  distanceXp,
  weeklyConsistencyBonus = 0,
}: RunXpBreakdownParts): XpBreakdownItem[] {
  const breakdown: XpBreakdownItem[] = []

  if (Number.isFinite(workoutXp) && workoutXp > 0) {
    breakdown.push({ label: 'Тренировка', value: Math.round(workoutXp) })
  }

  if (Number.isFinite(distanceXp) && distanceXp > 0) {
    breakdown.push({ label: 'Дистанция', value: Math.round(distanceXp) })
  }

  if (Number.isFinite(weeklyConsistencyBonus) && weeklyConsistencyBonus > 0) {
    breakdown.push({ label: 'Регулярность', value: Math.round(weeklyConsistencyBonus) })
  }

  return breakdown
}

export function capXpBreakdownItems(breakdown: XpBreakdownItem[], maxTotalXp: number): XpBreakdownItem[] {
  let remainingXp = Number.isFinite(maxTotalXp) ? Math.max(0, Math.round(maxTotalXp)) : 0

  if (remainingXp <= 0) {
    return []
  }

  const nextBreakdown: XpBreakdownItem[] = []

  for (const item of breakdown) {
    if (remainingXp <= 0) {
      break
    }

    const normalizedValue = Number.isFinite(item.value) ? Math.max(0, Math.round(item.value)) : 0

    if (normalizedValue <= 0) {
      continue
    }

    const appliedValue = Math.min(normalizedValue, remainingXp)

    if (appliedValue > 0) {
      nextBreakdown.push({
        label: item.label,
        value: appliedValue,
      })
      remainingXp -= appliedValue
    }
  }

  return nextBreakdown
}

export function formatXpBreakdownLabels(breakdown: XpBreakdownItem[]): string {
  return breakdown
    .map((item, index) => {
      if (index === 0) {
        return item.label
      }

      return item.label.charAt(0).toLowerCase() + item.label.slice(1)
    })
    .join(' + ')
}

export function getLevelProgressFromXP(totalXP: number): {
  level: number
  nextLevelXP: number | null
  currentLevelXp: number
  xpToNextLevel: number
  progressPercent: number
} {
  const normalizedTotalXP = Number.isFinite(totalXP) ? Math.max(totalXP, 0) : 0
  const { level, nextLevelXP } = getLevelFromXP(normalizedTotalXP)
  const currentLevelThreshold = XP_BY_LEVEL[level - 1] ?? 0

  if (nextLevelXP === null) {
    return {
      level,
      nextLevelXP: null,
      currentLevelXp: normalizedTotalXP - currentLevelThreshold,
      xpToNextLevel: 0,
      progressPercent: 100,
    }
  }

  const xpIntoLevel = normalizedTotalXP - currentLevelThreshold
  const xpNeededForLevel = nextLevelXP - currentLevelThreshold
  const progressPercent = xpNeededForLevel > 0
    ? Math.min(Math.max((xpIntoLevel / xpNeededForLevel) * 100, 0), 100)
    : 0

  return {
    level,
    nextLevelXP,
    currentLevelXp: xpIntoLevel,
    xpToNextLevel: Math.max(nextLevelXP - normalizedTotalXP, 0),
    progressPercent,
  }
}
