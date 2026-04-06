import Link from 'next/link'
import { redirect } from 'next/navigation'
import InnerPageHeader from '@/components/InnerPageHeader'
import { loadUserAchievements } from '@/lib/achievements'
import { getAuthenticatedUser } from '@/lib/supabase-server'

function formatAchievementDate(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function getAchievementSourceLabel(sourceType: 'weekly_race' | 'challenge') {
  return sourceType === 'weekly_race' ? 'Гонка недели' : 'Челлендж'
}

export default async function ActivityAchievementsPage() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    redirect('/login')
  }

  try {
    const achievements = await loadUserAchievements(user.id)

    return (
      <main className="min-h-screen">
        <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
          <InnerPageHeader title="Все достижения" fallbackHref="/activity" />

          <div className="mt-4">
            {achievements.length === 0 ? (
              <div className="app-card rounded-2xl border p-5 text-center shadow-sm md:p-6">
                <p className="app-text-secondary text-sm">Пока нет достижений.</p>
                <p className="app-text-secondary mt-2 text-sm">Участвуй в гонке недели и выполняй челленджи.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {achievements.map((achievement) => {
                  const cardContent = (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="app-text-secondary text-xs font-medium uppercase tracking-wide">
                          {getAchievementSourceLabel(achievement.source_type)}
                        </p>
                        <p className="app-text-primary mt-1 text-base font-semibold">{achievement.label}</p>
                        <p className="app-text-secondary mt-1 text-sm">{achievement.subtitle}</p>
                        <p className="app-text-secondary mt-2 text-xs">{formatAchievementDate(achievement.date)}</p>
                      </div>
                      {achievement.rank ? (
                        <p className="shrink-0 rounded-full border border-black/[0.06] bg-black/[0.04] px-2.5 py-1 text-xs font-semibold text-black/70 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-white/80">
                          #{achievement.rank}
                        </p>
                      ) : null}
                    </div>
                  )

                  if (achievement.href) {
                    return (
                      <Link
                        key={achievement.id}
                        href={achievement.href}
                        className="app-card app-surface-muted block rounded-2xl border border-black/[0.05] p-4 shadow-sm transition-transform transition-shadow hover:shadow-md active:scale-[0.99] dark:border-white/[0.08]"
                      >
                        {cardContent}
                      </Link>
                    )
                  }

                  return (
                    <div
                      key={achievement.id}
                      className="app-card app-surface-muted rounded-2xl border border-black/[0.05] p-4 shadow-sm dark:border-white/[0.08]"
                    >
                      {cardContent}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    )
  } catch {
    return (
      <main className="min-h-screen">
        <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
          <InnerPageHeader title="Все достижения" fallbackHref="/activity" />

          <div className="app-card mt-4 rounded-2xl border p-4 shadow-sm">
            <p className="text-sm text-red-600">Не удалось загрузить достижения</p>
            <Link href="/activity" className="app-button-secondary mt-4 inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm">
              Вернуться в активность
            </Link>
          </div>
        </div>
      </main>
    )
  }
}
