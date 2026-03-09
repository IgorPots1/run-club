const XP_BY_LEVEL = [0, 200, 500, 900, 1400, 2000, 2700, 3500, 4400, 5400]

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

export function getLevelProgressFromXP(totalXP: number): {
  level: number
  nextLevelXP: number | null
  currentLevelXp: number
  xpToNextLevel: number
  progressPercent: number
} {
  const { level, nextLevelXP } = getLevelFromXP(totalXP)
  const currentLevelThreshold = XP_BY_LEVEL[level - 1] ?? 0

  if (nextLevelXP === null) {
    return {
      level,
      nextLevelXP: null,
      currentLevelXp: totalXP - currentLevelThreshold,
      xpToNextLevel: 0,
      progressPercent: 100,
    }
  }

  const xpIntoLevel = totalXP - currentLevelThreshold
  const xpNeededForLevel = nextLevelXP - currentLevelThreshold

  return {
    level,
    nextLevelXP,
    currentLevelXp: xpIntoLevel,
    xpToNextLevel: Math.max(nextLevelXP - totalXP, 0),
    progressPercent: Math.min((xpIntoLevel / xpNeededForLevel) * 100, 100),
  }
}
