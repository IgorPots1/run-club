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
  name: string | null
  title?: string | null
  distance_km: number
  duration_minutes: number
  xp: number
  created_at: string
}

const DEFAULT_WORKOUT_NAME = 'Бег'

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

function getRunDisplayName(run: Pick<Run, 'name' | 'title'>) {
  return run.name?.trim() || run.title?.trim() || DEFAULT_WORKOUT_NAME
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

const DISTANCE_WHOLE_OPTIONS = Array.from({ length: 201 }, (_, index) => index)
const DISTANCE_TENTHS_OPTIONS = Array.from({ length: 10 }, (_, index) => index)
const DISTANCE_HUNDREDTHS_OPTIONS = Array.from({ length: 10 }, (_, index) => index)
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

function buildDistanceKm(wholeKm: number, tenthsKm: number, hundredthsKm = 0) {
  const normalizedHundredths = Math.max(0, Math.min(9, hundredthsKm))
  return Number((wholeKm + tenthsKm / 10 + normalizedHundredths / 100).toFixed(2))
}

function formatCompactDistanceLabel(wholeKm: number, tenthsKm: number, hundredthsKm = 0) {
  const value = buildDistanceKm(wholeKm, tenthsKm, hundredthsKm)
  return value.toFixed(2).replace(/\.?0+$/, '')
}

function formatDistanceInputValue(wholeKm: number, tenthsKm: number, hundredthsKm = 0) {
  return buildDistanceKm(wholeKm, tenthsKm, hundredthsKm).toFixed(2).replace(/\.?0+$/, '')
}

function parseDistanceInput(rawValue: string) {
  const normalizedValue = rawValue.trim().replace(',', '.')

  if (!normalizedValue) {
    return null
  }

  if (!/^\d+(\.\d{0,2})?$/.test(normalizedValue)) {
    return null
  }

  const parsedValue = Number(normalizedValue)

  if (!Number.isFinite(parsedValue)) {
    return null
  }

  return Number(parsedValue.toFixed(2))
}

function getDistanceParts(distanceKm: number) {
  const normalizedDistance = Math.max(0, Math.round(distanceKm * 100))

  return {
    wholeKm: Math.floor(normalizedDistance / 100),
    tenthsKm: Math.floor((normalizedDistance % 100) / 10),
    hundredthsKm: normalizedDistance % 10,
  }
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
  const [distanceHundredthsKm, setDistanceHundredthsKm] = useState(0)
  const [durationHours, setDurationHours] = useState(0)
  const [durationClockMinutes, setDurationClockMinutes] = useState(0)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const todayParts = parseDateParts(getTodayDateValue())
  const [distancePickerOpen, setDistancePickerOpen] = useState(false)
  const [durationPickerOpen, setDurationPickerOpen] = useState(false)
  const [runDatePickerOpen, setRunDatePickerOpen] = useState(false)
  const [draftDistanceWholeKm, setDraftDistanceWholeKm] = useState(0)
  const [draftDistanceTenthsKm, setDraftDistanceTenthsKm] = useState(0)
  const [draftDistanceHundredthsKm, setDraftDistanceHundredthsKm] = useState(0)
  const [distanceEntryMode, setDistanceEntryMode] = useState<'wheel' | 'manual'>('wheel')
  const [draftDistanceInput, setDraftDistanceInput] = useState('')
  const [distancePickerError, setDistancePickerError] = useState('')
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
  const compactDistanceLabel = formatCompactDistanceLabel(distanceWholeKm, distanceTenthsKm, distanceHundredthsKm)
  const selectedDistanceKm = buildDistanceKm(distanceWholeKm, distanceTenthsKm, distanceHundredthsKm)
  const compactDurationLabel = formatCompactDurationLabel(durationHours, durationClockMinutes, durationSeconds)
  const selectedDurationSeconds = durationHours * 3600 + durationClockMinutes * 60 + durationSeconds
  const selectedDurationMinutes = selectedDurationSeconds > 0 ? Math.max(1, Math.round(selectedDurationSeconds / 60)) : 0
  const normalizedWorkoutName = title.trim()
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
    Boolean(selectedDate) &&
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
    const nextDistanceInput = formatDistanceInputValue(distanceWholeKm, distanceTenthsKm, distanceHundredthsKm)
    setDraftDistanceWholeKm(distanceWholeKm)
    setDraftDistanceTenthsKm(distanceTenthsKm)
    setDraftDistanceHundredthsKm(distanceHundredthsKm)
    setDraftDistanceInput(nextDistanceInput)
    setDistancePickerError('')
    setDistancePickerOpen(true)
  }

  function openDurationPicker() {
    setDraftDurationHours(durationHours)
    setDraftDurationClockMinutes(durationClockMinutes)
    setDraftDurationSeconds(durationSeconds)
    setDurationPickerOpen(true)
  }

  function applyQuickDistance(wholeKm: number, tenthsKm: number, hundredthsKm = 0) {
    setDistanceWholeKm(wholeKm)
    setDistanceTenthsKm(tenthsKm)
    setDistanceHundredthsKm(hundredthsKm)
    setDraftDistanceWholeKm(wholeKm)
    setDraftDistanceTenthsKm(tenthsKm)
    setDraftDistanceHundredthsKm(hundredthsKm)
    setDraftDistanceInput(formatDistanceInputValue(wholeKm, tenthsKm, hundredthsKm))
  }

  function syncDraftDistanceInput(wholeKm: number, tenthsKm: number, hundredthsKm: number) {
    setDraftDistanceInput(formatDistanceInputValue(wholeKm, tenthsKm, hundredthsKm))
    setDistancePickerError('')
  }

  function handleDraftDistanceWholeChange(nextWholeKm: number) {
    setDraftDistanceWholeKm(nextWholeKm)
    syncDraftDistanceInput(nextWholeKm, draftDistanceTenthsKm, draftDistanceHundredthsKm)
  }

  function handleDraftDistanceTenthsChange(nextTenthsKm: number) {
    setDraftDistanceTenthsKm(nextTenthsKm)
    syncDraftDistanceInput(draftDistanceWholeKm, nextTenthsKm, draftDistanceHundredthsKm)
  }

  function handleDraftDistanceHundredthsChange(nextHundredthsKm: number) {
    setDraftDistanceHundredthsKm(nextHundredthsKm)
    syncDraftDistanceInput(draftDistanceWholeKm, draftDistanceTenthsKm, nextHundredthsKm)
  }

  function handleDistanceModeChange(nextMode: 'wheel' | 'manual') {
    setDistanceEntryMode(nextMode)
    setDistancePickerError('')

    if (nextMode === 'manual') {
      setDraftDistanceInput(formatDistanceInputValue(draftDistanceWholeKm, draftDistanceTenthsKm, draftDistanceHundredthsKm))
    }
  }

  function handleDraftDistanceInputChange(nextValue: string) {
    setDraftDistanceInput(nextValue)
    setDistancePickerError('')

    const parsedDistance = parseDistanceInput(nextValue)
    if (parsedDistance == null) return

    const parts = getDistanceParts(parsedDistance)
    setDraftDistanceWholeKm(parts.wholeKm)
    setDraftDistanceTenthsKm(parts.tenthsKm)
    setDraftDistanceHundredthsKm(parts.hundredthsKm)
  }

  function applyDraftDistance() {
    if (distanceEntryMode === 'manual') {
      const parsedDistance = parseDistanceInput(draftDistanceInput)

      if (parsedDistance == null || parsedDistance <= 0) {
        setDistancePickerError('Введите дистанцию больше 0 км, например 5.25')
        return
      }

      const parts = getDistanceParts(parsedDistance)
      setDistanceWholeKm(parts.wholeKm)
      setDistanceTenthsKm(parts.tenthsKm)
      setDistanceHundredthsKm(parts.hundredthsKm)
      setDraftDistanceWholeKm(parts.wholeKm)
      setDraftDistanceTenthsKm(parts.tenthsKm)
      setDraftDistanceHundredthsKm(parts.hundredthsKm)
      setDraftDistanceInput(formatDistanceInputValue(parts.wholeKm, parts.tenthsKm, parts.hundredthsKm))
      setDistancePickerOpen(false)
      setDistancePickerError('')
      return
    }

    setDistanceWholeKm(draftDistanceWholeKm)
    setDistanceTenthsKm(draftDistanceTenthsKm)
    setDistanceHundredthsKm(draftDistanceHundredthsKm)
    setDraftDistanceInput(formatDistanceInputValue(draftDistanceWholeKm, draftDistanceTenthsKm, draftDistanceHundredthsKm))
    setDistancePickerOpen(false)
    setDistancePickerError('')
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
    const normalizedTitle = normalizedWorkoutName || DEFAULT_WORKOUT_NAME
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
    const xp = 50 + d * 10

    try {
      const { error } = await supabase.from('runs').insert({
        user_id: user.id,
        name: normalizedTitle,
        title: normalizedTitle,
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
      setDistanceHundredthsKm(0)
      setDurationHours(0)
      setDurationClockMinutes(0)
      setDurationSeconds(0)
      setDraftDistanceWholeKm(0)
      setDraftDistanceTenthsKm(0)
      setDraftDistanceHundredthsKm(0)
      setDraftDistanceInput('')
      setDistancePickerError('')
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
            placeholder={`По умолчанию: ${DEFAULT_WORKOUT_NAME}`}
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
              const isActive =
                distanceWholeKm === chip.wholeKm &&
                distanceTenthsKm === chip.tenthsKm &&
                distanceHundredthsKm === 0

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
          className={`min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed sm:w-auto ${
            submitting || !isWorkoutFormValid
              ? 'app-button-secondary text-[var(--text-muted)] opacity-70'
              : 'app-button-primary shadow-sm'
          }`}
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
                  <p className="app-text-primary break-words text-base font-semibold">
                    {getRunDisplayName(run)}
                  </p>
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
        onCancel={() => {
          setDistancePickerOpen(false)
          setDistancePickerError('')
        }}
        onDone={applyDraftDistance}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleDistanceModeChange('wheel')}
              className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-medium ${
                distanceEntryMode === 'wheel' ? 'app-button-primary' : 'app-button-secondary'
              }`}
            >
              Колесо
            </button>
            <button
              type="button"
              onClick={() => handleDistanceModeChange('manual')}
              className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-medium ${
                distanceEntryMode === 'manual' ? 'app-button-primary' : 'app-button-secondary'
              }`}
            >
              Ввести вручную
            </button>
          </div>
          {distanceEntryMode === 'manual' ? (
            <div>
              <label htmlFor="distance_manual" className="app-text-secondary mb-1 block text-sm">Дистанция в км</label>
              <input
                id="distance_manual"
                type="text"
                inputMode="decimal"
                placeholder="Например: 5.25"
                value={draftDistanceInput}
                onChange={(event) => handleDraftDistanceInputChange(event.target.value)}
                className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
              />
              <p className="app-text-secondary mt-2 text-xs">Можно вводить десятичные значения, например 5.25 км.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="app-text-secondary text-sm">Выберите дистанцию колесом или переключитесь на ручной ввод для точного значения.</p>
              <div className="grid grid-cols-3 gap-3">
                <WheelPickerColumn
                  label="КМ"
                  value={draftDistanceWholeKm}
                  options={DISTANCE_WHOLE_OPTIONS}
                  onChange={handleDraftDistanceWholeChange}
                />
                <WheelPickerColumn
                  label="0.1 КМ"
                  value={draftDistanceTenthsKm}
                  options={DISTANCE_TENTHS_OPTIONS}
                  onChange={handleDraftDistanceTenthsChange}
                />
                <WheelPickerColumn
                  label="0.01 КМ"
                  value={draftDistanceHundredthsKm}
                  options={DISTANCE_HUNDREDTHS_OPTIONS}
                  onChange={handleDraftDistanceHundredthsChange}
                />
              </div>
            </div>
          )}
          <div className="app-surface-muted rounded-xl px-4 py-3">
            <p className="app-text-muted text-xs font-medium uppercase tracking-wide">Выбрано</p>
            <p className="app-text-primary mt-1 text-base font-semibold">
              {formatCompactDistanceLabel(draftDistanceWholeKm, draftDistanceTenthsKm, draftDistanceHundredthsKm)} км
            </p>
          </div>
          {distancePickerError ? <p className="text-sm text-red-600">{distancePickerError}</p> : null}
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
