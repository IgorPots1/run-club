'use client'

import { Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getBootstrapUser } from '@/lib/auth'
import { formatDistanceKm } from '@/lib/format'
import WheelPickerColumn from '@/components/WheelPickerColumn'
import WheelPickerSheet from '@/components/WheelPickerSheet'
import { ensureProfileExists } from '@/lib/profiles'
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

function formatDurationMinutesLabel(totalMinutes: number) {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    return '0 мин'
  }

  if (totalMinutes < 60) {
    return `${totalMinutes} мин`
  }

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (minutes === 0) {
    return `${hours} ч`
  }

  return `${hours} ч ${minutes} мин`
}

function formatDistanceKmLabel(distanceKm: number) {
  return formatDistanceKm(distanceKm)
}

function formatRunPaceFromMinutes(distanceKm: number, durationMinutes: number) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return ''
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return ''

  return formatPaceLabel(Math.round(durationMinutes * 60), distanceKm)
}

function formatRunDateLabel(dateString: string) {
  const runDate = new Date(dateString)

  if (Number.isNaN(runDate.getTime())) {
    return 'Дата неизвестна'
  }

  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  const runDayKey = `${runDate.getFullYear()}-${runDate.getMonth()}-${runDate.getDate()}`
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`
  const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`

  if (runDayKey === todayKey) {
    return 'Сегодня'
  }

  if (runDayKey === yesterdayKey) {
    return 'Вчера'
  }

  return runDate.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  })
}

function buildRunTitle(rawTitle: string) {
  const baseTitle = rawTitle.trim()
  if (baseTitle) return baseTitle
  return 'Пробежка'
}

function getTodayDateValue() {
  return new Date().toISOString().slice(0, 10)
}

function isFutureRunDate(dateValue: string) {
  if (!dateValue) return false

  return dateValue > getTodayDateValue()
}

function parseDateParts(dateValue: string) {
  const [yearString, monthString, dayString] = dateValue.split('-')

  return {
    year: Number(yearString),
    month: Number(monthString),
    day: Number(dayString),
  }
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function buildDateValue(year: number, month: number, day: number) {
  return `${year}-${formatTwoDigits(month)}-${formatTwoDigits(day)}`
}

function formatRunDatePickerLabel(dateValue: string) {
  const { year, month, day } = parseDateParts(dateValue)
  const date = new Date(year, month - 1, day)

  if (Number.isNaN(date.getTime())) {
    return 'Выбрать дату'
  }

  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
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
  const [runDate, setRunDate] = useState(getTodayDateValue())
  const [distanceWholeKm, setDistanceWholeKm] = useState(0)
  const [distanceTenthsKm, setDistanceTenthsKm] = useState(0)
  const [durationHours, setDurationHours] = useState(0)
  const [durationClockMinutes, setDurationClockMinutes] = useState(0)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const todayParts = parseDateParts(getTodayDateValue())
  const [distancePickerOpen, setDistancePickerOpen] = useState(false)
  const [durationPickerOpen, setDurationPickerOpen] = useState(false)
  const [runDatePickerOpen, setRunDatePickerOpen] = useState(false)
  const [draftDistanceWholeKm, setDraftDistanceWholeKm] = useState(0)
  const [draftDistanceTenthsKm, setDraftDistanceTenthsKm] = useState(0)
  const [draftDurationHours, setDraftDurationHours] = useState(0)
  const [draftDurationClockMinutes, setDraftDurationClockMinutes] = useState(0)
  const [draftDurationSeconds, setDraftDurationSeconds] = useState(0)
  const [draftRunYear, setDraftRunYear] = useState(todayParts.year)
  const [draftRunMonth, setDraftRunMonth] = useState(todayParts.month)
  const [draftRunDay, setDraftRunDay] = useState(todayParts.day)
  const [error, setError] = useState('')
  const [runsError, setRunsError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [deletingRunIds, setDeletingRunIds] = useState<string[]>([])
  const selectedDistanceLabel = formatDistanceLabel(distanceWholeKm, distanceTenthsKm)
  const compactDistanceLabel = formatCompactDistanceLabel(distanceWholeKm, distanceTenthsKm)
  const selectedDistanceKm = Number(selectedDistanceLabel)
  const compactDurationLabel = formatCompactDurationLabel(durationHours, durationClockMinutes, durationSeconds)
  const selectedDurationSeconds = durationHours * 3600 + durationClockMinutes * 60 + durationSeconds
  const selectedDurationMinutes = selectedDurationSeconds > 0 ? Math.max(1, Math.round(selectedDurationSeconds / 60)) : 0
  const pacePreview = formatPaceLabel(selectedDurationSeconds, selectedDistanceKm)
  const showPacePreview = shouldShowPace(selectedDurationSeconds, selectedDistanceKm)
  const selectedDate = runDate || getTodayDateValue()
  const runDateLabel = formatRunDatePickerLabel(selectedDate)
  const yearOptions = Array.from({ length: todayParts.year - 1999 }, (_, index) => 2000 + index)
  const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1)
  const dayOptions = Array.from({ length: getDaysInMonth(draftRunYear, draftRunMonth) }, (_, index) => index + 1)
  const maxSelectableMonth = draftRunYear === todayParts.year ? todayParts.month : 12
  const maxSelectableDay = draftRunYear === todayParts.year && draftRunMonth === todayParts.month
    ? todayParts.day
    : getDaysInMonth(draftRunYear, draftRunMonth)
  const isWorkoutFormValid =
    Number.isFinite(selectedDistanceKm) &&
    selectedDistanceKm > 0 &&
    Number.isFinite(selectedDurationMinutes) &&
    selectedDurationMinutes > 0 &&
    selectedDurationSeconds > 0 &&
    !isFutureRunDate(selectedDate)

  function openRunDatePicker() {
    const nextDateParts = parseDateParts(selectedDate)
    setDraftRunYear(nextDateParts.year)
    setDraftRunMonth(nextDateParts.month)
    setDraftRunDay(nextDateParts.day)
    setRunDatePickerOpen(true)
  }

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
    if (draftRunMonth > maxSelectableMonth) {
      setDraftRunMonth(maxSelectableMonth)
    }
  }, [draftRunMonth, maxSelectableMonth])

  useEffect(() => {
    if (draftRunDay > maxSelectableDay) {
      setDraftRunDay(maxSelectableDay)
    }
  }, [draftRunDay, maxSelectableDay])

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

    try {
      const { data, error: runsLoadError } = await supabase
        .from('runs')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })

      if (runsLoadError) {
        setRunsError('Не удалось загрузить тренировки')
        return
      }

      setRuns((data as Run[] | null) ?? [])
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
  }, [user])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || submitting) return

    const currentUser = user
    const normalizedTitle = title.trim()
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

    if (isFutureRunDate(selectedDate)) {
      setError('Нельзя добавить тренировку в будущем')
      return
    }

    setError('')
    setSubmitting(true)
    const runTitle = buildRunTitle(normalizedTitle)
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
      setRunDate(getTodayDateValue())
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

  if (loading) return <main className="min-h-screen flex items-center justify-center p-4">Загрузка...</main>
  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

  return (
    <main className="min-h-screen pb-[calc(96px+env(safe-area-inset-bottom))] md:pb-0">
      <div className="mx-auto max-w-xl p-4">
      <h1 className="app-text-primary mb-4 text-2xl font-bold">Тренировки</h1>
      <form onSubmit={handleSubmit} className="app-card mb-8 space-y-3 rounded-2xl border p-4 shadow-sm">
        <div>
          <label htmlFor="title" className="app-text-secondary block text-sm mb-1">Название тренировки (необязательно)</label>
          <input
            id="title"
            type="text"
            placeholder="Например: Интервалы или парк"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={submitting}
            className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="run_date" className="app-text-secondary block text-sm mb-1">Дата тренировки</label>
          <button
            id="run_date"
            type="button"
            onClick={openRunDatePicker}
            disabled={submitting}
            className="app-button-secondary flex min-h-11 w-full items-center justify-between rounded-lg border px-3 py-2 text-left"
          >
            <span className="app-text-primary font-semibold">{runDateLabel}</span>
          </button>
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
        <button
          type="submit"
          disabled={submitting || !isWorkoutFormValid}
          className="app-button-secondary min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {submitting ? 'Сохраняем тренировку...' : 'Добавить тренировку'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
      {runsError ? <p className="mb-4 text-sm text-red-600">{runsError}</p> : null}
      <div className="mb-4 space-y-4">
        {loadingRuns ? (
          <p className="app-text-secondary text-sm">Загрузка тренировок...</p>
        ) : runs.length === 0 ? (
          <div className="app-text-secondary mt-10 text-center">
            <p>Пока здесь пусто.</p>
            <p className="mt-2 text-sm">Добавьте первую тренировку и начните собирать прогресс.</p>
          </div>
        ) : (
          runs.map((run) => (
            <div key={run.id} className="compact-run-card app-card overflow-hidden rounded-2xl border p-4 shadow-sm">
              <div className="compact-run-card-layout flex flex-col gap-3">
                <div className="min-w-0 flex-1">
                  <p className="compact-run-card-primary compact-run-card-title app-text-primary break-words text-base font-semibold">
                    {formatDistanceKmLabel(run.distance_km)} км • {formatDurationMinutesLabel(run.duration_minutes)}
                    {formatRunPaceFromMinutes(run.distance_km, run.duration_minutes)
                      ? ` • ${formatRunPaceFromMinutes(run.distance_km, run.duration_minutes)}`
                      : ''}
                  </p>
                  <p className="compact-run-card-secondary compact-run-card-meta app-text-muted text-sm mt-1">
                    {formatRunDateLabel(run.created_at)}
                  </p>
                  <div className="compact-run-card-like">
                    <p className="app-text-secondary text-sm">⚡ +{run.xp} XP</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(run.id)}
                  disabled={deletingRunIds.includes(run.id)}
                  className="compact-run-card-action app-text-secondary inline-flex min-h-10 w-full items-center justify-center gap-1 self-start rounded-lg px-2 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-9 sm:w-auto"
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                  <span>{deletingRunIds.includes(run.id) ? 'Удаляем...' : 'Удалить'}</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      </div>
      <WheelPickerSheet
        title="Дата тренировки"
        open={runDatePickerOpen}
        onCancel={() => setRunDatePickerOpen(false)}
        onDone={() => {
          setRunDate(buildDateValue(draftRunYear, draftRunMonth, draftRunDay))
          setRunDatePickerOpen(false)
        }}
      >
        <div className="grid grid-cols-3 gap-2">
          <WheelPickerColumn
            label="ГОД"
            value={draftRunYear}
            options={yearOptions}
            onChange={setDraftRunYear}
          />
          <WheelPickerColumn
            label="МЕС"
            value={draftRunMonth}
            options={monthOptions}
            onChange={setDraftRunMonth}
            formatter={formatTwoDigits}
            isOptionDisabled={(month) => month > maxSelectableMonth}
          />
          <WheelPickerColumn
            label="ДЕНЬ"
            value={draftRunDay}
            options={dayOptions}
            onChange={setDraftRunDay}
            formatter={formatTwoDigits}
            isOptionDisabled={(day) => day > maxSelectableDay}
          />
        </div>
      </WheelPickerSheet>
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
