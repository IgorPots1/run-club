'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import type { User } from '@supabase/supabase-js'

type Run = {
  id: string
  user_id: string
  title: string
  distance_km: number
  duration_minutes: number
  xp: number
  created_at: string
}

export default function RunsPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [runs, setRuns] = useState<Run[]>([])
  const [title, setTitle] = useState('')
  const [runDate, setRunDate] = useState(new Date().toISOString().slice(0, 10))
  const [distanceKm, setDistanceKm] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setLoading(false)
      if (!user) router.push('/login')
    })
  }, [router])

  useEffect(() => {
    if (!user) return
    supabase
      .from('runs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRuns(data ?? []))
  }, [user])

  async function fetchRuns() {
    if (!user) return
    const { data } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    setRuns(data ?? [])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setSubmitting(true)
    const runTitle = title.trim() || 'Run'
    const d = Number(distanceKm)
    const dur = Number(durationMinutes)
    const xp = 20 + d * 5
    await supabase.from('runs').insert({
      user_id: user.id,
      title: runTitle,
      distance_km: d,
      duration_minutes: dur,
      created_at: runDate,
      xp
    })
    setTitle('')
    setRunDate(new Date().toISOString().slice(0, 10))
    setDistanceKm('')
    setDurationMinutes('')
    await fetchRuns()
    setSubmitting(false)
  }

  async function handleDelete(id: string) {
    await supabase.from('runs').delete().eq('id', id)
    setRuns((prev) => prev.filter((r) => r.id !== id))
  }

  if (loading) return <main className="min-h-screen flex items-center justify-center p-4">Загрузка...</main>
  if (!user) return null

  return (
    <main className="min-h-screen">
      <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Тренировки</h1>
      <form onSubmit={handleSubmit} className="mb-8 space-y-3 max-w-sm">
        <div>
          <label htmlFor="title" className="block text-sm mb-1">Название тренировки</label>
          <input
            id="title"
            type="text"
            placeholder="Утренняя пробежка"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="run_date" className="block text-sm mb-1">Дата тренировки</label>
          <input
            id="run_date"
            type="date"
            value={runDate}
            onChange={(e) => setRunDate(e.target.value)}
            required
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="distance_km" className="block text-sm mb-1">Дистанция (км)</label>
          <input
            id="distance_km"
            type="number"
            step="0.01"
            min="0"
            value={distanceKm}
            onChange={(e) => setDistanceKm(e.target.value)}
            required
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="duration_minutes" className="block text-sm mb-1">Время (мин)</label>
          <input
            id="duration_minutes"
            type="number"
            min="0"
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            required
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <button type="submit" disabled={submitting} className="border rounded px-3 py-2">
          {submitting ? '...' : 'Добавить тренировку'}
        </button>
      </form>
      <div>
        {runs.map((run) => (
          <div key={run.id} className="border rounded-lg p-4 mb-3">
            <div className="flex justify-between gap-4">
              <div>
              <p className="font-medium">{run.title || 'Тренировка'}</p>
              <p className="text-sm mt-1">🏃 {run.distance_km} км</p>
              <p className="text-sm mt-1">+{run.xp} XP</p>
              <p className="text-sm text-gray-500 mt-1">
                {new Date(run.created_at).toLocaleDateString('ru-RU', {
                  day: 'numeric',
                  month: 'long'
                })}
              </p>
              </div>
              <button onClick={() => handleDelete(run.id)} className="border rounded px-2 py-1 text-sm h-fit">
                Удалить
              </button>
            </div>
          </div>
        ))}
      </div>
      </div>
    </main>
  )
}
