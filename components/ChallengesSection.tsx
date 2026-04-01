'use client'

import { CheckCircle2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBootstrapUser } from '@/lib/auth'
import { ensureProfileExists } from '@/lib/profiles'
import { supabase } from '@/lib/supabase'
import { awardChallengeCompletion, loadCompletedChallenges } from '@/lib/user-challenges'
import {
  getChallengeProgress,
  isAchievementChallenge,
  sortChallengesByPriority,
  type Challenge,
  type ChallengeKind,
  type ChallengeWithProgress,
  type RunRecord,
} from '@/lib/challenges'

type ChallengesSectionProps = {
  showTitle?: boolean
}

const challengeKindLabel: Record<ChallengeKind, string> = {
  weekly: 'Еженедельный',
  monthly: 'Ежемесячный',
  milestone: 'Достижение',
}

function ChallengeCard({ item, completed }: { item: ChallengeWithProgress; completed: boolean }) {
  return (
    <div className="app-card overflow-hidden rounded-2xl border p-4 shadow-sm">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h3 className="app-text-primary break-words text-lg font-semibold">{item.title}</h3>
          <span className="app-text-secondary shrink-0 rounded-full border px-2 py-1 text-[11px] font-medium">
            {challengeKindLabel[item.kind]}
          </span>
        </div>
        {item.description ? (
          <p className="app-text-secondary mt-1 break-words text-sm">{item.description}</p>
        ) : null}
        {item.xp_reward ? (
          <p className="mt-3 text-sm font-medium text-green-700">
            {completed ? `Получено +${item.xp_reward} XP` : `+${item.xp_reward} XP`}
          </p>
        ) : null}
        {item.progressItems.length > 0 ? (
          <div className="mt-4 space-y-4">
            {item.progressItems.map((progressItem) => (
              <div key={progressItem.label}>
                {completed || progressItem.completed ? (
                  <p className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
                    <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                    <span>Выполнено</span>
                  </p>
                ) : null}
                <div className="app-progress-track h-2 w-full overflow-hidden rounded-full">
                  <div
                    className="app-accent-bg h-full rounded-full"
                    style={{ width: `${progressItem.percent}%` }}
                  />
                </div>
                <p className="app-text-secondary mt-2 break-words text-sm">Прогресс: {progressItem.label}</p>
              </div>
            ))}
          </div>
        ) : completed ? (
          <p className="app-text-secondary mt-3 text-sm">Достижение открыто</p>
        ) : null}
      </div>
    </div>
  )
}

export default function ChallengesSection({ showTitle = true }: ChallengesSectionProps) {
  const router = useRouter()
  const [items, setItems] = useState<ChallengeWithProgress[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [levelUpToastLevel, setLevelUpToastLevel] = useState<number | null>(null)

  useEffect(() => {
    if (levelUpToastLevel == null) {
      return
    }

    const timer = window.setTimeout(() => {
      setLevelUpToastLevel(null)
    }, 3000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [levelUpToastLevel])

  useEffect(() => {
    let isMounted = true

    async function loadData() {
      setError('')

      try {
        if (!isMounted) return

        const user = await getBootstrapUser()

        if (!user) {
          router.replace('/login')
          return
        }

        void ensureProfileExists(user)

        const [
          { data: challengesData, error: challengesError },
          { data: runsData, error: runsError },
          completedChallenges,
        ] = await Promise.all([
          supabase
            .from('challenges')
            .select('*')
            .order('created_at', { ascending: true }),
          supabase
            .from('runs')
            .select('distance_km, created_at')
            .eq('user_id', user.id),
          loadCompletedChallenges(user.id),
        ])

        if (!isMounted) return

        if (challengesError || runsError) {
          setError('Не удалось загрузить челленджи')
          return
        }

        const challenges = (challengesData as Challenge[]) ?? []
        const runs = (runsData as RunRecord[]) ?? []
        const itemsWithProgress = sortChallengesByPriority(
          challenges.map((challenge) => getChallengeProgress(challenge, runs))
        )

        const completedNow = itemsWithProgress.filter(
          (challenge) => challenge.isCompleted && !completedChallenges.has(challenge.id)
        )

        if (completedNow.length > 0) {
          const results = await Promise.all(
            completedNow.map((challenge) =>
              awardChallengeCompletion(user.id, challenge.id, Number(challenge.xp_reward ?? 0))
            )
          )

          if (results.some((result) => !result.success)) {
            setError('Не удалось сохранить прогресс челленджей')
          }

          const highestNewLevel = results.reduce<number | null>((highestLevel, result) => {
            if (!result.levelUp || result.newLevel == null) {
              return highestLevel
            }

            return Math.max(highestLevel ?? 0, result.newLevel)
          }, null)

          if (highestNewLevel != null) {
            setLevelUpToastLevel(highestNewLevel)
          }
        }

        setItems(itemsWithProgress)
      } catch (loadError) {
        console.error('[challenges] failed to load challenge section', loadError)
        if (isMounted) {
          setError('Не удалось загрузить челленджи')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    void loadData()

    return () => {
      isMounted = false
    }
  }, [router])

  const activeItems = items.filter((item) => !item.isCompleted)
  const achievementItems = items.filter((item) => item.isCompleted && isAchievementChallenge(item))

  return (
    <div className="mx-auto max-w-xl p-4 md:max-w-none">
      {levelUpToastLevel != null ? (
        <div className="pointer-events-none fixed inset-x-4 top-4 z-50 flex justify-center">
          <div className="app-card w-full max-w-sm rounded-2xl border px-4 py-3 text-center text-sm font-medium shadow-lg ring-1 ring-black/5 dark:ring-white/10">
            {`🔥 Новый уровень: ${levelUpToastLevel}`}
          </div>
        </div>
      ) : null}
      {showTitle ? <h1 className="app-text-primary mb-4 text-2xl font-bold">Челленджи</h1> : null}
      {loading ? (
        <p>Загрузка...</p>
      ) : (
        <>
          {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}
          {items.length === 0 ? (
            <div className="app-text-secondary mt-10 text-center">
              <p>Челленджи скоро появятся.</p>
              <p className="mt-2 text-sm">Загляните позже за новыми целями.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <section>
                <h2 className="app-text-primary mb-3 text-lg font-semibold">Активные</h2>
                <div className="space-y-4">
                  {activeItems.length === 0 ? (
                    <div className="app-card rounded-2xl border p-4 shadow-sm">
                      <p className="app-text-secondary text-sm">Все активные челленджи уже закрыты.</p>
                      <p className="app-text-secondary mt-2 text-sm">Скоро появятся новые цели.</p>
                    </div>
                  ) : (
                    activeItems.map((item) => (
                      <ChallengeCard key={item.id} item={item} completed={false} />
                    ))
                  )}
                </div>
              </section>

              <section>
                <h2 className="app-text-primary mb-3 text-lg font-semibold">Достижения</h2>
                <div className="space-y-4">
                  {achievementItems.length === 0 ? (
                    <div className="app-card rounded-2xl border p-4 shadow-sm">
                      <p className="app-text-secondary text-sm">Достижений пока нет.</p>
                      <p className="app-text-secondary mt-2 text-sm">Выполняйте челленджи и собирайте коллекцию.</p>
                    </div>
                  ) : (
                    achievementItems.map((item) => (
                      <ChallengeCard key={item.id} item={item} completed />
                    ))
                  )}
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  )
}
