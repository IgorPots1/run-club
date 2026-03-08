'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Challenge = {
  id: string
  title: string
  description: string | null
  goal_km: number | null
  goal_runs: number | null
}

type RunRecord = {
  distance_km: number | null
  created_at: string
}

type ChallengeWithProgress = Challenge & {
  progressLabel: string | null
  progressPercent: number
}

type ChallengesSectionProps = {
  showTitle?: boolean
}

function getGoalLabel(challenge: Challenge) {
  if (challenge.goal_km != null) {
    return `Цель: ${challenge.goal_km} км`
  }

  if (challenge.goal_runs != null) {
    return `Цель: ${challenge.goal_runs} тренировок`
  }

  return null
}

function getChallengeProgress(challenge: Challenge, runs: RunRecord[]): ChallengeWithProgress {
  const totalKm = runs.reduce((sum, run) => sum + Number(run.distance_km ?? 0), 0)
  const totalRuns = runs.length

  if (challenge.goal_km != null) {
    const progressPercent = challenge.goal_km > 0 ? Math.min((totalKm / challenge.goal_km) * 100, 100) : 0

    return {
      ...challenge,
      progressLabel: `Прогресс: ${totalKm.toFixed(1)} / ${challenge.goal_km} км`,
      progressPercent,
    }
  }

  if (challenge.goal_runs != null) {
    const progressPercent = challenge.goal_runs > 0 ? Math.min((totalRuns / challenge.goal_runs) * 100, 100) : 0

    return {
      ...challenge,
      progressLabel: `Прогресс: ${totalRuns} / ${challenge.goal_runs} тренировок`,
      progressPercent,
    }
  }

  return {
    ...challenge,
    progressLabel: null,
    progressPercent: 0,
  }
}

export default function ChallengesSection({ showTitle = true }: ChallengesSectionProps) {
  const router = useRouter()
  const [items, setItems] = useState<ChallengeWithProgress[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadData() {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      const [
        { data: challengesData, error: challengesError },
        { data: runsData, error: runsError },
      ] = await Promise.all([
        supabase
          .from('challenges')
          .select('id, title, description, goal_km, goal_runs')
          .order('created_at', { ascending: true }),
        supabase
          .from('runs')
          .select('distance_km, created_at')
          .eq('user_id', user.id),
      ])

      if (challengesError || runsError) {
        setError('Не удалось загрузить челленджи')
        setLoading(false)
        return
      }

      const challenges = (challengesData as Challenge[]) ?? []
      const runs = (runsData as RunRecord[]) ?? []
      const itemsWithProgress = challenges.map((challenge) => getChallengeProgress(challenge, runs))

      setItems(itemsWithProgress)
      setLoading(false)
    }

    void loadData()
  }, [router])

  return (
    <div className="p-4">
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
                <div key={item.id} className="rounded-xl border bg-white p-4 shadow-sm">
                  <div>
                    <h2 className="text-lg font-semibold">{item.title}</h2>
                    {item.description ? (
                      <p className="mt-1 text-sm text-gray-600">{item.description}</p>
                    ) : null}
                    {getGoalLabel(item) ? (
                      <p className="mt-4 text-sm text-gray-600">{getGoalLabel(item)}</p>
                    ) : null}
                    {item.progressLabel ? (
                      <>
                        <p className="mt-2 text-sm text-gray-600">{item.progressLabel}</p>
                        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="h-full rounded-full bg-black"
                            style={{ width: `${item.progressPercent}%` }}
                          />
                        </div>
                      </>
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
