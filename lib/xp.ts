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
