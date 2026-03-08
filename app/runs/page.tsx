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

  if (loading) return <main className="min-h-screen flex items-center justify-center p-4">Loading...</main>
  if (!user) return null

  return (
    <main className="min-h-screen p-4">
      <h1 className="text-xl font-semibold mb-4">Runs</h1>
      <form onSubmit={handleSubmit} className="mb-8 space-y-3 max-w-sm">
        <div>
          <label htmlFor="title" className="block text-sm mb-1">Run title</label>
          <input
            id="title"
            type="text"
            placeholder="Morning run"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="run_date" className="block text-sm mb-1">Run date</label>
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
          <label htmlFor="distance_km" className="block text-sm mb-1">Distance (km)</label>
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
          <label htmlFor="duration_minutes" className="block text-sm mb-1">Duration (min)</label>
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
          {submitting ? '...' : 'Add run'}
        </button>
      </form>
      <div className="space-y-3">
        {runs.map((run) => (
          <div key={run.id} className="border rounded p-3 flex justify-between items-center">
            <div>
              <p className="font-medium">{run.title || 'Run'}</p>
              <p>{run.distance_km} km · {run.duration_minutes} min · {run.xp} xp</p>
              <p className="text-sm text-gray-600">{new Date(run.created_at).toLocaleDateString()}</p>
            </div>
            <button onClick={() => handleDelete(run.id)} className="border rounded px-2 py-1 text-sm">
              Delete
            </button>
          </div>
        ))}
      </div>
    </main>
  )
}
