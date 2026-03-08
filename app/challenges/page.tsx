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
  xp_reward: number
}

type ProgressItem = {
  id: string
  title: string
  description: string | null
  xp_reward: number
  progress: number
  goal: number
  unit: string
  completed: boolean
}

function getChallengeTitle(title: string) {
  if (title === 'Weekly 30 km') return '30 км за неделю'
  if (title === 'Monthly 100 km') return '100 км за месяц'
  if (title === 'First 10 runs') return 'Первые 10 тренировок'
  return title
}

function getWeekStart(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function getMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export default function ChallengesPage() {
  const router = useRouter()
  const [items, setItems] = useState<ProgressItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      const userId = user.id

      const { data: challengesData } = await supabase
        .from('challenges')
        .select('*')

      const { data: runsData } = await supabase
        .from('runs')
        .select('distance_km, created_at')
        .eq('user_id', userId)

      const challenges = (challengesData as Challenge[]) ?? []
      const runs = runsData ?? []

      const now = new Date()
      const weekStart = getWeekStart(now).getTime()
      const monthStart = getMonthStart(now).getTime()

      const totalRuns = runs.length

      const totalKmThisWeek = runs.reduce((sum, run) => {
        const runTime = new Date(run.created_at).getTime()
        if (runTime >= weekStart) {
          return sum + Number(run.distance_km || 0)
        }
        return sum
      }, 0)

      const totalKmThisMonth = runs.reduce((sum, run) => {
        const runTime = new Date(run.created_at).getTime()
        if (runTime >= monthStart) {
          return sum + Number(run.distance_km || 0)
        }
        return sum
      }, 0)

      const mapped = challenges.map((challenge) => {
        if (challenge.title === 'Weekly 30 km') {
          const goal = challenge.goal_km ?? 30
          return {
            id: challenge.id,
            title: challenge.title,
            description: challenge.description,
            xp_reward: challenge.xp_reward,
            progress: totalKmThisWeek,
            goal,
            unit: 'km',
            completed: totalKmThisWeek >= goal,
          }
        }

        if (challenge.title === 'Monthly 100 km') {
          const goal = challenge.goal_km ?? 100
          return {
            id: challenge.id,
            title: challenge.title,
            description: challenge.description,
            xp_reward: challenge.xp_reward,
            progress: totalKmThisMonth,
            goal,
            unit: 'km',
            completed: totalKmThisMonth >= goal,
          }
        }

        if (challenge.title === 'First 10 runs') {
          const goal = challenge.goal_runs ?? 10
          return {
            id: challenge.id,
            title: challenge.title,
            description: challenge.description,
            xp_reward: challenge.xp_reward,
            progress: totalRuns,
            goal,
            unit: 'runs',
            completed: totalRuns >= goal,
          }
        }

        return {
          id: challenge.id,
          title: challenge.title,
          description: challenge.description,
          xp_reward: challenge.xp_reward,
          progress: 0,
          goal: challenge.goal_km ?? challenge.goal_runs ?? 1,
          unit: challenge.goal_km ? 'km' : 'runs',
          completed: false,
        }
      })

      setItems(mapped)
      setLoading(false)
    }

    loadData()
  }, [router])

  if (loading) {
    return (
      <main className="min-h-screen">
        <div className="p-4">
          <h1 className="text-2xl font-bold mb-4">Челленджи</h1>
          <p>Загрузка...</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen">
      <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Челленджи</h1>

      <div className="space-y-3 mb-4">
        {items.length === 0 ? (
          <div className="mt-10 text-center text-gray-500">
            <p>Челленджи скоро появятся</p>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="border rounded-xl p-4 shadow-sm bg-white">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">{getChallengeTitle(item.title)}</h2>
                  {item.description ? (
                    <p className="mt-1 text-sm text-gray-600">{item.description}</p>
                  ) : null}
                </div>

                <div className="text-right">
                  <p className="text-sm font-medium">{item.xp_reward} XP</p>
                  {item.completed ? (
                    <span className="mt-2 inline-block rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                      Выполнено
                    </span>
                  ) : null}
                </div>
              </div>

              <p className="mt-4 text-sm">
                Прогресс: {item.progress} / {item.goal} {item.unit === 'km' ? 'км' : 'тренировок'}
              </p>
            </div>
          ))
        )}
      </div>
      </div>
    </main>
  )
}