'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getBootstrapUser } from '@/lib/auth'
import WheelPickerColumn from '@/components/WheelPickerColumn'
import WheelPickerSheet from '@/components/WheelPickerSheet'
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
const QUICK_DISTANCE_CHIPS = [
  { label: '5 км', wholeKm: 5, tenthsKm: 0 },
  { label: '10 км', wholeKm: 10, tenthsKm: 0 },
  { label: '15 км', wholeKm: 15, tenthsKm: 0 },
  { label: '20 км', wholeKm: 20, tenthsKm: 0 },
]

function formatTwoDigits(value: number) {
  return String(value).padStart(2, '0')
}

function formatDistanceLabel(wholeKm: number, tenthsKm: number) {
  return `${wholeKm}.${tenthsKm}`
}

function formatCompactDistanceLabel(wholeKm: number, tenthsKm: number) {
  return tenthsKm === 0 ? `${wholeKm}` : `${wholeKm}.${tenthsKm}`
}

function formatDurationLabel(hours: number, minutes: number, seconds: number) {
  return `${formatTwoDigits(hours)}:${formatTwoDigits(minutes)}:${formatTwoDigits(seconds)}`
}

function formatCompactDurationLabel(hours: number, minutes: number, seconds: number) {
  if (hours > 0) {
    return `${formatTwoDigits(hours)}:${formatTwoDigits(minutes)}:${formatTwoDigits(seconds)}`
  }

  return `${formatTwoDigits(minutes)}:${formatTwoDigits(seconds)}`
}

function formatPaceLabel(totalSeconds: number, distanceKm: number) {
  if (distanceKm <= 0 || totalSeconds <= 0) return ''

  const paceSeconds = Math.round(totalSeconds / distanceKm)
  const minutes = Math.floor(paceSeconds / 60)
  const seconds = paceSeconds % 60

  return `${minutes}:${formatTwoDigits(seconds)}/км`
}

function shouldShowPace(totalSeconds: number, distanceKm: number) {
  if (distanceKm < 0.5 || totalSeconds <= 0) return false

  const paceSeconds = totalSeconds / distanceKm
  return paceSeconds <= 1200
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
  const [distancePickerOpen, setDistancePickerOpen] = useState(false)
  const [durationPickerOpen, setDurationPickerOpen] = useState(false)
  const [draftDistanceWholeKm, setDraftDistanceWholeKm] = useState(0)
  const [draftDistanceTenthsKm, setDraftDistanceTenthsKm] = useState(0)
  const [draftDurationHours, setDraftDurationHours] = useState(0)
  const [draftDurationClockMinutes, setDraftDurationClockMinutes] = useState(0)
  const [draftDurationSeconds, setDraftDurationSeconds] = useState(0)
  const [error, setError] = useState('')
  const [runsError, setRunsError] = useState('')
  const [likesError, setLikesError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [deletingRunIds, setDeletingRunIds] = useState<string[]>([])
  const [pendingRunIds, setPendingRunIds] = useState<string[]>([])
  const selectedDistanceLabel = formatDistanceLabel(distanceWholeKm, distanceTenthsKm)
  const compactDistanceLabel = formatCompactDistanceLabel(distanceWholeKm, distanceTenthsKm)
  const selectedDistanceKm = Number(selectedDistanceLabel)
  const selectedDurationLabel = formatDurationLabel(durationHours, durationClockMinutes, durationSeconds)
  const compactDurationLabel = formatCompactDurationLabel(durationHours, durationClockMinutes, durationSeconds)
  const selectedDurationSeconds = durationHours * 3600 + durationClockMinutes * 60 + durationSeconds
  const selectedDurationMinutes = selectedDurationSeconds > 0 ? Math.max(1, Math.round(selectedDurationSeconds / 60)) : 0
  const pacePreview = formatPaceLabel(selectedDurationSeconds, selectedDistanceKm)
  const showPacePreview = shouldShowPace(selectedDurationSeconds, selectedDistanceKm)

  function openDistancePicker() {
    setDraftDistanceWholeKm(distanceWholeKm)
    setDraftDistanceTenthsKm(distanceTenthsKm)
    setDistancePickerOpen(true)
  }

  function openDurationPicker() {
    setDraftDurationHours(durationHours)
    setDraftDurationClockMinutes(durationClockMinutes)
    setDraftDurationSeconds(durationSeconds)
    setDurationPickerOpen(true)
  }

  function applyQuickDistance(wholeKm: number, tenthsKm: number) {
    setDistanceWholeKm(wholeKm)
    setDistanceTenthsKm(tenthsKm)
    setDraftDistanceWholeKm(wholeKm)
    setDraftDistanceTenthsKm(tenthsKm)
  }

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
      setDraftDistanceWholeKm(0)
      setDraftDistanceTenthsKm(0)
      setDraftDurationHours(0)
      setDraftDurationClockMinutes(0)
      setDraftDurationSeconds(0)
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
      <h1 className="app-text-primary mb-4 text-2xl font-bold">Тренировки</h1>
      <form onSubmit={handleSubmit} className="app-card mb-8 space-y-3 rounded-2xl border p-4 shadow-sm">
        <div>
          <label htmlFor="title" className="app-text-secondary block text-sm mb-1">Название тренировки</label>
          <input
            id="title"
            type="text"
            placeholder="Утренняя пробежка"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={submitting}
            className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="run_date" className="app-text-secondary block text-sm mb-1">Дата тренировки</label>
          <input
            id="run_date"
            type="date"
            value={runDate}
            onChange={(e) => setRunDate(e.target.value)}
            required
            disabled={submitting}
            className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </div>
        <div>
          <label className="app-text-secondary mb-1 block text-sm">Дистанция</label>
          <button
            type="button"
            onClick={openDistancePicker}
            className="app-button-secondary flex min-h-11 w-full items-center justify-between rounded-lg border px-3 py-2 text-left"
          >
            <span className="app-text-primary font-semibold">{compactDistanceLabel} км</span>
          </button>
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK_DISTANCE_CHIPS.map((chip) => {
              const isActive = distanceWholeKm === chip.wholeKm && distanceTenthsKm === chip.tenthsKm

              return (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => applyQuickDistance(chip.wholeKm, chip.tenthsKm)}
                  className={`min-h-10 rounded-full border px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'app-button-primary'
                      : 'app-button-secondary'
                  }`}
                >
                  {chip.label}
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <label className="app-text-secondary mb-1 block text-sm">Время</label>
          <button
            type="button"
            onClick={openDurationPicker}
            className="app-button-secondary flex min-h-11 w-full items-center justify-between rounded-lg border px-3 py-2 text-left"
          >
            <span className="app-text-primary font-semibold">{compactDurationLabel}</span>
          </button>
        </div>
        <div className="app-surface-muted rounded-xl px-4 py-3">
          <p className="app-text-muted text-xs font-medium uppercase tracking-wide">Предпросмотр</p>
          <div className="app-text-secondary mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <p>{compactDistanceLabel} км</p>
            <p>•</p>
            <p>{compactDurationLabel}</p>
            {showPacePreview ? (
              <>
                <p>•</p>
                <p className="app-text-primary font-medium">{pacePreview}</p>
              </>
            ) : null}
          </div>
        </div>
        <button type="submit" disabled={submitting} className="app-button-secondary min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-medium sm:w-auto">
          {submitting ? '...' : 'Добавить тренировку'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
      {runsError ? <p className="mb-4 text-sm text-red-600">{runsError}</p> : null}
      {likesError ? <p className="mb-4 text-sm text-red-600">{likesError}</p> : null}
      <div className="space-y-3 mb-4">
        {loadingRuns ? (
          <p className="app-text-secondary text-sm">Загрузка тренировок...</p>
        ) : runs.length === 0 ? (
          <div className="app-text-secondary mt-10 text-center">
            <p>Пока нет тренировок</p>
            <p className="mt-2 text-sm">Добавьте первую тренировку через форму выше</p>
          </div>
        ) : (
          runs.map((run) => (
            <div key={run.id} className="compact-run-card app-card overflow-hidden rounded-xl border p-4 shadow-sm">
              <div className="compact-run-card-layout flex flex-col gap-3 sm:flex-row sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="compact-run-card-title app-text-primary break-words font-medium">{run.title || 'Тренировка'}</p>
                  <p className="compact-run-card-meta app-text-primary text-sm mt-1">🏃 {run.distance_km} км</p>
                  <p className="compact-run-card-meta app-text-secondary text-sm mt-1">
                    {new Date(run.created_at).toLocaleDateString('ru-RU', {
                      day: 'numeric',
                      month: 'long'
                    })}
                  </p>
                  <div className="compact-run-card-like">
                    <RunLikeControl
                      likesCount={run.likesCount}
                      likedByMe={run.likedByMe}
                      pending={pendingRunIds.includes(run.id)}
                      onToggle={() => handleLikeToggle(run.id)}
                      summaryPrefix={`⚡ +${run.xp} XP`}
                      compactOnSmall
                    />
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(run.id)}
                  className="compact-run-card-action app-button-secondary min-h-11 w-full shrink-0 rounded-lg border px-3 py-2 text-sm sm:h-fit sm:w-auto"
                >
                  {deletingRunIds.includes(run.id) ? '...' : 'Удалить'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      </div>
      <WheelPickerSheet
        title="Дистанция"
        open={distancePickerOpen}
        onCancel={() => setDistancePickerOpen(false)}
        onDone={() => {
          setDistanceWholeKm(draftDistanceWholeKm)
          setDistanceTenthsKm(draftDistanceTenthsKm)
          setDistancePickerOpen(false)
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <WheelPickerColumn
            label="КМ"
            value={draftDistanceWholeKm}
            options={DISTANCE_WHOLE_OPTIONS}
            onChange={setDraftDistanceWholeKm}
          />
          <WheelPickerColumn
            label="0.1 КМ"
            value={draftDistanceTenthsKm}
            options={DISTANCE_TENTHS_OPTIONS}
            onChange={setDraftDistanceTenthsKm}
          />
        </div>
      </WheelPickerSheet>
      <WheelPickerSheet
        title="Время"
        open={durationPickerOpen}
        onCancel={() => setDurationPickerOpen(false)}
        onDone={() => {
          setDurationHours(draftDurationHours)
          setDurationClockMinutes(draftDurationClockMinutes)
          setDurationSeconds(draftDurationSeconds)
          setDurationPickerOpen(false)
        }}
      >
        <div className="grid grid-cols-3 gap-2">
          <WheelPickerColumn
            label="ЧАСЫ"
            value={draftDurationHours}
            options={DURATION_HOUR_OPTIONS}
            onChange={setDraftDurationHours}
            formatter={formatTwoDigits}
          />
          <WheelPickerColumn
            label="МИН"
            value={draftDurationClockMinutes}
            options={TIME_OPTIONS}
            onChange={setDraftDurationClockMinutes}
            formatter={formatTwoDigits}
          />
          <WheelPickerColumn
            label="СЕК"
            value={draftDurationSeconds}
            options={TIME_OPTIONS}
            onChange={setDraftDurationSeconds}
            formatter={formatTwoDigits}
          />
        </div>
      </WheelPickerSheet>
    </main>
  )
}
