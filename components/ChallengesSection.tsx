'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ensureProfileExists } from '@/lib/profiles'
import { supabase } from '@/lib/supabase'
import { awardChallengeCompletion, loadCompletedChallengeIds } from '@/lib/user-challenges'
import { getChallengeProgress, type Challenge, type ChallengeWithProgress, type RunRecord } from '@/lib/challenges'

type ChallengesSectionProps = {
  showTitle?: boolean
}

export default function ChallengesSection({ showTitle = true }: ChallengesSectionProps) {
  const router = useRouter()
  const [items, setItems] = useState<ChallengeWithProgress[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadData() {
      setError('')

      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser()

        if (!isMounted) return

        if (authError) {
          setError('Не удалось проверить сессию')
          return
        }

        if (!user) {
          router.push('/login')
          return
        }

        void ensureProfileExists(user)

        const [
          { data: challengesData, error: challengesError },
          { data: runsData, error: runsError },
          completedChallengeIds,
        ] = await Promise.all([
          supabase
            .from('challenges')
            .select('*')
            .order('created_at', { ascending: true }),
          supabase
            .from('runs')
            .select('distance_km, created_at')
            .eq('user_id', user.id),
          loadCompletedChallengeIds(user.id),
        ])

        if (!isMounted) return

        if (challengesError || runsError) {
          setError('Не удалось загрузить челленджи')
          return
        }

        const challenges = (challengesData as Challenge[]) ?? []
        const runs = (runsData as RunRecord[]) ?? []
        const itemsWithProgress = challenges.map((challenge) => getChallengeProgress(challenge, runs))

        const completedNow = itemsWithProgress.filter(
          (challenge) => challenge.isCompleted && !completedChallengeIds.has(challenge.id)
        )

        if (completedNow.length > 0) {
          const results = await Promise.all(
            completedNow.map((challenge) =>
              awardChallengeCompletion(user.id, challenge.id, Number(challenge.xp_reward ?? 0))
            )
          )

          if (results.some((result) => result.error)) {
            setError('Не удалось сохранить прогресс челленджей')
          }
        }

        setItems(itemsWithProgress)
      } catch {
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

  return (
    <div className="mx-auto max-w-xl p-4 md:max-w-none">
      {showTitle ? <h1 className="mb-4 text-2xl font-bold">Челленджи</h1> : null}
      {loading ? (
        <p>Загрузка...</p>
      ) : (
        <>
          {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}
          <div className="space-y-3 mb-4">
            {items.length === 0 ? (
              <div className="mt-10 text-center text-gray-500">
                <p>Челленджей пока нет</p>
              </div>
            ) : (
              items.map((item) => (
                <div key={item.id} className="overflow-hidden rounded-xl border bg-white p-4 shadow-sm">
                  <div>
                    <h2 className="break-words text-lg font-semibold">{item.title}</h2>
                    {item.description ? (
                      <p className="mt-1 break-words text-sm text-gray-600">{item.description}</p>
                    ) : null}
                    {item.xp_reward ? (
                      <p className="mt-3 text-sm font-medium text-green-700">+{item.xp_reward} XP</p>
                    ) : null}
                    {item.progressItems.length > 0 ? (
                      <div className="mt-4 space-y-4">
                        {item.progressItems.map((progressItem) => (
                          <div key={progressItem.label}>
                            {progressItem.completed ? (
                              <p className="mb-2 text-sm font-medium text-green-700">✔ Выполнено</p>
                            ) : null}
                            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                              <div
                                className="h-full rounded-full bg-black"
                                style={{ width: `${progressItem.percent}%` }}
                              />
                            </div>
                            <p className="mt-2 break-words text-sm text-gray-600">Прогресс: {progressItem.label}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
