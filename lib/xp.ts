const LEGACY_XP_BY_LEVEL = [0, 200, 500, 900, 1400, 2000, 2700, 3500, 4400, 5400]
const MAX_LEVEL = 100

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
  elevationXp?: number
  weeklyConsistencyBonus?: number
}

function getGeneratedMinXpForLevel(level: number) {
  if (!Number.isFinite(level) || level <= 1) {
    return 0
  }

  // Preserve the existing 1-10 thresholds exactly, then continue the same
  // quadratic-like cumulative curve where each next level needs 100 XP more.
  return 100 * (((level * (level + 1)) / 2) - 1)
}

function buildLevelDefinitions() {
  return Array.from({ length: MAX_LEVEL }, (_, index) => {
    const level = index + 1
    const legacyMinXp = LEGACY_XP_BY_LEVEL[index]

    return {
      level,
      minXp: typeof legacyMinXp === 'number' ? legacyMinXp : getGeneratedMinXpForLevel(level),
      title: getRankTitleFromLevel(level),
    } satisfies ClubLevelDefinition
  })
}

const LEVEL_DEFINITIONS = buildLevelDefinitions()

export function getLevelFromXP(totalXP: number): { level: number; nextLevelXP: number | null } {
  const normalizedTotalXP = Number.isFinite(totalXP) ? Math.max(totalXP, 0) : 0
  let levelDefinition = LEVEL_DEFINITIONS[0]

  for (let i = LEVEL_DEFINITIONS.length - 1; i >= 0; i--) {
    if (normalizedTotalXP >= LEVEL_DEFINITIONS[i].minXp) {
      levelDefinition = LEVEL_DEFINITIONS[i]
      break
    }
  }

  const nextLevelDefinition = LEVEL_DEFINITIONS[levelDefinition.level] ?? null

  return {
    level: levelDefinition.level,
    nextLevelXP: nextLevelDefinition?.minXp ?? null,
  }
}

export function getRankTitleFromLevel(level: number): string {
  if (level <= 2) return 'Новичок'
  if (level <= 4) return 'Вкатился'
  if (level <= 6) return 'Стабильный'
  if (level <= 8) return 'В форме'
  if (level <= 10) return 'Мотор клуба'
  if (level <= 20) return 'Ритм клуба'
  if (level <= 30) return 'Темп клуба'
  if (level <= 40) return 'Пейсмейкер'
  if (level <= 50) return 'Капитан дистанции'
  if (level <= 60) return 'Опора клуба'
  if (level <= 70) return 'Сердце клуба'
  if (level <= 80) return 'Лидер маршрута'
  if (level <= 90) return 'Легенда трассы'
  return 'Легенда клуба'
}

export function getRankTitleFromXP(totalXP: number): string {
  return getRankTitleFromLevel(getLevelFromXP(totalXP).level)
}

export function getClubLevelDefinitions(): ClubLevelDefinition[] {
  return LEVEL_DEFINITIONS
}

export function buildRunXpBreakdown({
  workoutXp,
  distanceXp,
  elevationXp = 0,
  weeklyConsistencyBonus = 0,
}: RunXpBreakdownParts): XpBreakdownItem[] {
  const breakdown: XpBreakdownItem[] = []

  if (Number.isFinite(workoutXp) && workoutXp > 0) {
    breakdown.push({ label: 'Тренировка', value: Math.round(workoutXp) })
  }

  if (Number.isFinite(distanceXp) && distanceXp > 0) {
    breakdown.push({ label: 'Дистанция', value: Math.round(distanceXp) })
  }

  if (Number.isFinite(elevationXp) && elevationXp > 0) {
    breakdown.push({ label: 'Набор высоты', value: Math.round(elevationXp) })
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
  const currentLevelThreshold = LEVEL_DEFINITIONS[level - 1]?.minXp ?? 0

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
