'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import type { User } from '@supabase/supabase-js'

type Challenge = {
  id: string
  title: string
  description: string | null
  target_type: 'km_week' | 'km_month' | 'runs'
  target: number
  xp_reward: number
}

function getWeekStart(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const day = x.getDay()
  const diff = x.getDate() - day + (day === 0 ? -6 : 1)
  x.setDate(diff)
  return x
}

function getMonthStart(d: Date): Date {
  const x = new Date(d)
  x.setDate(1)
  x.setHours(0, 0, 0, 0)
  return x
}

export default function ChallengesPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [totalKmWeek, setTotalKmWeek] = useState(0)
  const [totalKmMonth, setTotalKmMonth] = useState(0)
  const [totalRuns, setTotalRuns] = useState(0)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      if (!user) router.push('/login')
    })
  }, [router])

  useEffect(() => {
    if (!user) return
    async function load() {
      const { data: challengesData } = await supabase.from('challenges').select('*')
      setChallenges((challengesData as Challenge[]) ?? [])
      const { data: runs } = await supabase.from('runs').select('distance_km, created_at').eq('user_id', user.id)
      const now = new Date()
      const weekStart = getWeekStart(now).getTime()
      const monthStart = getMonthStart(now).getTime()
      let kmWeek = 0
      let kmMonth = 0
      for (const r of runs ?? []) {
        const t = new Date(r.created_at).getTime()
        if (t >= weekStart) kmWeek += r.distance_km
        if (t >= monthStart) kmMonth += r.distance_km
      }
      setTotalKmWeek(kmWeek)
      setTotalKmMonth(kmMonth)
      setTotalRuns(runs?.length ?? 0)
      setLoading(false)
    }
    load()
  }, [user])

  function getProgress(c: Challenge): { current: number; target: number; completed: boolean } {
    const current =
      c.target_type === 'km_week' ? totalKmWeek : c.target_type === 'km_month' ? totalKmMonth : totalRuns
    return { current, target: c.target, completed: current >= c.target }
  }

  if (loading) return <main className="min-h-screen flex items-center justify-center p-4">Loading...</main>
  if (!user) return null

  return (
    <main className="min-h-screen p-4">
      <h1 className="text-xl font-semibold mb-4">Challenges</h1>
      <div className="space-y-4 max-w-lg">
        {challenges.map((c) => {
          const { current, target, completed } = getProgress(c)
          return (
            <div key={c.id} className="border rounded p-4">
              <div className="flex justify-between items-start gap-2 mb-2">
                <h2 className="font-medium">{c.title}</h2>
                {completed && <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">Completed</span>}
              </div>
              {c.description && <p className="text-sm text-gray-600 mb-2">{c.description}</p>}
              <p className="text-sm">
                Progress: {current} / {target}
                {c.target_type === 'km_week' && ' km this week'}
                {c.target_type === 'km_month' && ' km this month'}
                {c.target_type === 'runs' && ' runs'}
              </p>
              <p className="text-sm font-medium mt-1">{c.xp_reward} XP reward</p>
            </div>
          )
        })}
      </div>
    </main>
  )
}
