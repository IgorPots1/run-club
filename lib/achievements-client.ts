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

type AchievementsResponse =
  | {
      ok: true
      achievements: UserAchievement[]
    }
  | {
      ok: false
      error?: string
    }

export async function loadUserAchievements(): Promise<UserAchievement[]> {
  const response = await fetch('/api/achievements', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => null) as AchievementsResponse | null

  if (!response.ok || !payload?.ok) {
    throw new Error(
      payload && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : 'Не удалось загрузить достижения'
    )
  }

  return Array.isArray(payload.achievements) ? payload.achievements : []
}
