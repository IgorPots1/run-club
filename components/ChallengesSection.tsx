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

export default function ChallengesSection({ showTitle = true }: ChallengesSectionProps) {
  const router = useRouter()
  const [items, setItems] = useState<Challenge[]>([])
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

      const { data: challengesData, error } = await supabase
        .from('challenges')
        .select('id, title, description, goal_km, goal_runs')
        .order('created_at', { ascending: true })

      if (error) {
        setError('Не удалось загрузить челленджи')
        setLoading(false)
        return
      }

      setItems((challengesData as Challenge[]) ?? [])
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
