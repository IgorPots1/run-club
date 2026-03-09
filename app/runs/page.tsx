'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getBootstrapUser } from '@/lib/auth'
import WheelPickerColumn from '@/components/WheelPickerColumn'
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

const DISTANCE_WHOLE_OPTIONS = Array.from({ length: 101 }, (_, index) => index)
const DISTANCE_TENTHS_OPTIONS = Array.from({ length: 10 }, (_, index) => index)
const DURATION_HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => index)
const TIME_OPTIONS = Array.from({ length: 60 }, (_, index) => index)

function formatTwoDigits(value: number) {
  return String(value).padStart(2, '0')
}

function formatDistanceLabel(wholeKm: number, tenthsKm: number) {
  return `${wholeKm}.${tenthsKm}`
}

function formatDurationLabel(hours: number, minutes: number, seconds: number) {
  return `${formatTwoDigits(hours)}:${formatTwoDigits(minutes)}:${formatTwoDigits(seconds)}`
}

function formatPaceLabel(totalSeconds: number, distanceKm: number) {
  if (distanceKm <= 0 || totalSeconds <= 0) return ''

  const paceSeconds = Math.round(totalSeconds / distanceKm)
  const minutes = Math.floor(paceSeconds / 60)
  const seconds = paceSeconds % 60

  return `${minutes}:${formatTwoDigits(seconds)} / км`
}

export default function RunsPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [runs, setRuns] = useState<Run[]>([])
  const [title, setTitle] = useState('')
  const [runDate, setRunDate] = useState(new Date().toISOString().slice(0, 10))
  const [distanceWholeKm, setDistanceWholeKm] = useState(0)
  const [distanceTenthsKm, setDistanceTenthsKm] = useState(0)
  const [durationHours, setDurationHours] = useState(0)
  const [durationClockMinutes, setDurationClockMinutes] = useState(0)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [error, setError] = useState('')
  const [runsError, setRunsError] = useState('')
  const [likesError, setLikesError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [deletingRunIds, setDeletingRunIds] = useState<string[]>([])
  const [pendingRunIds, setPendingRunIds] = useState<string[]>([])
  const selectedDistanceLabel = formatDistanceLabel(distanceWholeKm, distanceTenthsKm)
  const selectedDistanceKm = Number(selectedDistanceLabel)
  const selectedDurationLabel = formatDurationLabel(durationHours, durationClockMinutes, durationSeconds)
  const selectedDurationSeconds = durationHours * 3600 + durationClockMinutes * 60 + durationSeconds
  const selectedDurationMinutes = selectedDurationSeconds > 0 ? Math.max(1, Math.round(selectedDurationSeconds / 60)) : 0
  const pacePreview = formatPaceLabel(selectedDurationSeconds, selectedDistanceKm)

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
          router.replace('/login')
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
    const d = selectedDistanceKm
    const dur = selectedDurationMinutes

    if (!Number.isFinite(d) || d <= 0) {
      setError('Укажите дистанцию больше 0 км')
      return
    }

    if (!Number.isFinite(dur) || dur <= 0 || selectedDurationSeconds <= 0) {
      setError('Укажите время больше 0 секунд')
      return
    }

    const createdAtDate = new Date(`${selectedDate}T12:00:00`)
    if (Number.isNaN(createdAtDate.getTime())) {
      setError('Укажите корректную дату тренировки')
      return
    }

    setError('')
    setSubmitting(true)
    const runTitle = buildRunTitle(normalizedTitle, selectedDistanceLabel)
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
      setDistanceWholeKm(0)
      setDistanceTenthsKm(0)
      setDurationHours(0)
      setDurationClockMinutes(0)
      setDurationSeconds(0)
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
      router.replace('/login')
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
  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

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
          <div className="mb-2 flex items-center justify-between gap-3">
            <label className="block text-sm">Дистанция (км)</label>
            <p className="shrink-0 text-sm font-semibold text-gray-900">{selectedDistanceLabel} км</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <WheelPickerColumn
              label="Км"
              value={distanceWholeKm}
              options={DISTANCE_WHOLE_OPTIONS}
              onChange={setDistanceWholeKm}
            />
            <WheelPickerColumn
              label="0.1 км"
              value={distanceTenthsKm}
              options={DISTANCE_TENTHS_OPTIONS}
              onChange={setDistanceTenthsKm}
            />
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <label className="block text-sm">Время</label>
            <p className="shrink-0 text-sm font-semibold text-gray-900">{selectedDurationLabel}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <WheelPickerColumn
              label="Часы"
              value={durationHours}
              options={DURATION_HOUR_OPTIONS}
              onChange={setDurationHours}
              formatter={formatTwoDigits}
            />
            <WheelPickerColumn
              label="Мин"
              value={durationClockMinutes}
              options={TIME_OPTIONS}
              onChange={setDurationClockMinutes}
              formatter={formatTwoDigits}
            />
            <WheelPickerColumn
              label="Сек"
              value={durationSeconds}
              options={TIME_OPTIONS}
              onChange={setDurationSeconds}
              formatter={formatTwoDigits}
            />
          </div>
        </div>
        <div className="rounded-xl bg-gray-50 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Предпросмотр</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <p className="font-medium text-gray-900">{selectedDistanceLabel} км</p>
            <p className="font-medium text-gray-900">{selectedDurationLabel}</p>
            <p className={pacePreview ? 'font-medium text-gray-900' : 'text-gray-500'}>
              {pacePreview || 'Темп появится после выбора дистанции и времени'}
            </p>
          </div>
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
