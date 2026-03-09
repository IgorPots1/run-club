'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getBootstrapUser } from '@/lib/auth'
import { ensureProfileExists } from '@/lib/profiles'
import RunLikeControl from '@/components/RunLikeControl'
import { loadRunLikesSummary, subscribeToRunLikes, toggleRunLike } from '@/lib/run-likes'
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
  likesCount: number
  likedByMe: boolean
}

function buildRunTitle(rawTitle: string, rawDistanceKm: string) {
  const baseTitle = rawTitle.trim()
  const distanceLabel = rawDistanceKm.trim()

  if (baseTitle && distanceLabel) {
    return `${baseTitle} - ${distanceLabel} км`
  }

  if (!baseTitle && distanceLabel) {
    return `${distanceLabel} км`
  }

  if (baseTitle) {
    return baseTitle
  }

  return 'Тренировка'
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
  const [error, setError] = useState('')
  const [runsError, setRunsError] = useState('')
  const [likesError, setLikesError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [deletingRunIds, setDeletingRunIds] = useState<string[]>([])
  const [pendingRunIds, setPendingRunIds] = useState<string[]>([])

  useEffect(() => {
    let isMounted = true

    async function loadUser() {
      try {
        if (!isMounted) return

        const nextUser = await getBootstrapUser()
        setUser(nextUser)

        if (nextUser) {
          void ensureProfileExists(nextUser)
        }

        if (!nextUser) {
          router.push('/login')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    void loadUser()

    return () => {
      isMounted = false
    }
  }, [router])

  async function fetchRuns(currentUser: User) {
    setLoadingRuns(true)
    setRunsError('')
    setLikesError('')

    try {
      const { data, error: runsLoadError } = await supabase
        .from('runs')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })

      if (runsLoadError) {
        setRunsError('Не удалось загрузить тренировки')
        return
      }

      let likesByRunId: Record<string, number> = {}
      let likedRunIds = new Set<string>()

      try {
        const likesSummary = await loadRunLikesSummary(currentUser.id)
        likesByRunId = likesSummary.likesByRunId
        likedRunIds = likesSummary.likedRunIds
      } catch {
        setLikesError('Не удалось загрузить лайки')
      }

      const items = (data ?? []).map((run) => ({
        ...run,
        likesCount: likesByRunId[run.id] ?? 0,
        likedByMe: likedRunIds.has(run.id),
      }))

      setRuns(items)
    } catch {
      setRunsError('Не удалось загрузить тренировки')
    } finally {
      setLoadingRuns(false)
    }
  }

  useEffect(() => {
    if (!user) return
    const currentUser = user

    async function loadRuns() {
      await fetchRuns(currentUser)
    }

    void loadRuns()
    const unsubscribe = subscribeToRunLikes(() => {
      void loadRuns()
    })

    return () => {
      unsubscribe()
    }
  }, [user])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || submitting) return

    const currentUser = user
    const normalizedTitle = title.trim()
    const selectedDate = runDate || new Date().toISOString().slice(0, 10)
    const d = Number(distanceKm)
    const dur = Number(durationMinutes)

    if (!Number.isFinite(d) || d <= 0) {
      setError('Укажите дистанцию больше 0 км')
      return
    }

    if (!Number.isFinite(dur) || dur <= 0) {
      setError('Укажите время больше 0 минут')
      return
    }

    const createdAtDate = new Date(`${selectedDate}T12:00:00`)
    if (Number.isNaN(createdAtDate.getTime())) {
      setError('Укажите корректную дату тренировки')
      return
    }

    setError('')
    setSubmitting(true)
    const runTitle = buildRunTitle(normalizedTitle, distanceKm)
    const xp = 50 + d * 10

    try {
      const { error } = await supabase.from('runs').insert({
        user_id: user.id,
        title: runTitle,
        distance_km: d,
        duration_minutes: dur,
        created_at: createdAtDate.toISOString(),
        xp
      })

      if (error) {
        setError(error.message)
        return
      }

      setTitle('')
      setRunDate(new Date().toISOString().slice(0, 10))
      setDistanceKm('')
      setDurationMinutes('')
      setError('')
      await fetchRuns(currentUser)
    } catch {
      setError('Не удалось сохранить тренировку')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    if (deletingRunIds.includes(id)) return

    setError('')
    setDeletingRunIds((prev) => [...prev, id])

    try {
      const { error } = await supabase.from('runs').delete().eq('id', id)

      if (error) {
        setError('Не удалось удалить тренировку')
        return
      }

      setRuns((prev) => prev.filter((r) => r.id !== id))
    } catch {
      setError('Не удалось удалить тренировку')
    } finally {
      setDeletingRunIds((prev) => prev.filter((runId) => runId !== id))
    }
  }

  async function handleLikeToggle(runId: string) {
    if (!user) {
      router.push('/login')
      return
    }

    if (pendingRunIds.includes(runId)) return

    const currentRun = runs.find((run) => run.id === runId)
    if (!currentRun) return

    const wasLiked = currentRun.likedByMe
    const previousRuns = runs

    setLikesError('')
    setPendingRunIds((prev) => [...prev, runId])

    try {
      setRuns((prev) =>
        prev.map((run) =>
          run.id === runId
            ? {
                ...run,
                likedByMe: !wasLiked,
                likesCount: Math.max(0, run.likesCount + (wasLiked ? -1 : 1)),
              }
            : run
        )
      )

      const { error: likeError } = await toggleRunLike(runId, user.id, wasLiked)

      if (likeError) {
        setRuns(previousRuns)
        setLikesError('Не удалось обновить лайк')
      }
    } catch {
      setRuns(previousRuns)
      setLikesError('Не удалось обновить лайк')
    } finally {
      setPendingRunIds((prev) => prev.filter((id) => id !== runId))
    }
  }

  if (loading) return <main className="min-h-screen flex items-center justify-center p-4">Загрузка...</main>
  if (!user) return null

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-xl p-4">
      <h1 className="mb-4 text-2xl font-bold">Тренировки</h1>
      <form onSubmit={handleSubmit} className="mb-8 space-y-3 rounded-2xl border bg-white p-4 shadow-sm">
        <div>
          <label htmlFor="title" className="block text-sm mb-1">Название тренировки</label>
          <input
            id="title"
            type="text"
            placeholder="Утренняя пробежка"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={submitting}
            className="min-h-11 w-full rounded-lg border px-3 py-2"
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
            disabled={submitting}
            className="min-h-11 w-full rounded-lg border px-3 py-2"
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
            disabled={submitting}
            className="min-h-11 w-full rounded-lg border px-3 py-2"
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
            disabled={submitting}
            className="min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </div>
        <button type="submit" disabled={submitting} className="min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-medium sm:w-auto">
          {submitting ? '...' : 'Добавить тренировку'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
      {runsError ? <p className="mb-4 text-sm text-red-600">{runsError}</p> : null}
      {likesError ? <p className="mb-4 text-sm text-red-600">{likesError}</p> : null}
      <div className="space-y-3 mb-4">
        {loadingRuns ? (
          <p className="text-sm text-gray-500">Загрузка тренировок...</p>
        ) : runs.length === 0 ? (
          <div className="mt-10 text-center text-gray-500">
            <p>Пока нет тренировок</p>
            <p className="mt-2 text-sm">Добавьте первую тренировку через форму выше</p>
          </div>
        ) : (
          runs.map((run) => (
            <div key={run.id} className="overflow-hidden rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{run.title || 'Тренировка'}</p>
                  <p className="text-sm mt-1">🏃 {run.distance_km} км</p>
                  <p className="text-sm mt-1">+{run.xp} XP</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {new Date(run.created_at).toLocaleDateString('ru-RU', {
                      day: 'numeric',
                      month: 'long'
                    })}
                  </p>
                  <RunLikeControl
                    likesCount={run.likesCount}
                    likedByMe={run.likedByMe}
                    pending={pendingRunIds.includes(run.id)}
                    onToggle={() => handleLikeToggle(run.id)}
                  />
                </div>
                <button
                  onClick={() => handleDelete(run.id)}
                  className="min-h-11 w-full shrink-0 rounded-lg border px-3 py-2 text-sm sm:h-fit sm:w-auto"
                >
                  {deletingRunIds.includes(run.id) ? '...' : 'Удалить'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      </div>
    </main>
  )
}
