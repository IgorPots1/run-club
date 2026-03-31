'use client'

import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getBootstrapUser } from '@/lib/auth'
import { formatDistanceKm, formatRunTimestampLabel } from '@/lib/format'
import { ensureProfileExists } from '@/lib/profiles'
import { dispatchRunsUpdatedEvent, RUNS_UPDATED_EVENT, RUNS_UPDATED_STORAGE_KEY } from '@/lib/runs-refresh'
import { createRun, deleteRun } from '@/lib/runs'
import { loadUserShoeSelectionData, type UserShoeRecord } from '@/lib/shoes-client'
import type { User } from '@supabase/supabase-js'

type Run = {
  id: string
  user_id: string
  name: string | null
  title?: string | null
  distance_km: number
  duration_minutes: number
  duration_seconds?: number | null
  xp: number
  created_at: string
  external_source?: string | null
  external_id?: string | null
  average_heartrate?: number | null
  max_heartrate?: number | null
  map_polyline?: string | null
  calories?: number | null
  average_cadence?: number | null
}

type CalendarDayCell = {
  key: string
  dateValue: string
  dayNumber: number
  isDisabled: boolean
  isToday: boolean
}

const DEFAULT_WORKOUT_NAME = 'Бег'
const RUNS_REFETCH_THROTTLE_MS = 8000
const CALENDAR_WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function StravaIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="block h-4 w-4 shrink-0 text-[#FC4C02]"
    >
      <path d="M15.39 1.5 9.45 13.17h3.51l2.43-4.79 2.43 4.79h3.5L15.39 1.5Z" />
      <path d="M10 14.95 7.57 19.73h3.51L10 17.62l-1.08 2.11h3.51L10 14.95Z" />
    </svg>
  )
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

function formatPreciseDurationLabel(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '0:00'
  }

  const normalizedSeconds = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(normalizedSeconds / 3600)
  const minutes = Math.floor((normalizedSeconds % 3600) / 60)
  const seconds = normalizedSeconds % 60

  if (hours > 0) {
    return `${hours}:${formatTwoDigits(minutes)}:${formatTwoDigits(seconds)}`
  }

  return `${minutes}:${formatTwoDigits(seconds)}`
}

function formatPreciseDistanceKm(value: number) {
  const fixed = value.toFixed(2)

  if (fixed.endsWith('00')) {
    return value.toFixed(1)
  }

  if (fixed.endsWith('0')) {
    return fixed.slice(0, -1)
  }

  return fixed
}

function formatDistanceKmLabel(run: Pick<Run, 'distance_km' | 'external_source'>) {
  if (run.external_source === 'strava') {
    return formatPreciseDistanceKm(run.distance_km)
  }

  return formatDistanceKm(run.distance_km)
}

function getRunDurationSeconds(run: Pick<Run, 'duration_minutes' | 'duration_seconds'>) {
  if (Number.isFinite(run.duration_seconds) && (run.duration_seconds ?? 0) > 0) {
    return Math.round(run.duration_seconds ?? 0)
  }

  return Math.round(run.duration_minutes * 60)
}

function formatRunDurationLabel(run: Pick<Run, 'duration_minutes' | 'duration_seconds'>) {
  const totalSeconds = getRunDurationSeconds(run)

  if (Number.isFinite(run.duration_seconds) && (run.duration_seconds ?? 0) > 0) {
    return formatPreciseDurationLabel(totalSeconds)
  }

  return formatDurationMinutesLabel(run.duration_minutes)
}

function formatRunPace(run: Pick<Run, 'distance_km' | 'duration_minutes' | 'duration_seconds'>) {
  const totalSeconds = getRunDurationSeconds(run)

  return formatPaceLabel(totalSeconds, run.distance_km)
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

function parseDateValue(dateValue: string) {
  const [yearString, monthString, dayString] = dateValue.split('-')
  const year = Number(yearString)
  const month = Number(monthString)
  const day = Number(dayString)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }

  const parsedDate = new Date(year, month - 1, day, 12)
  if (Number.isNaN(parsedDate.getTime())) {
    return null
  }

  return parsedDate
}

function getMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12)
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1, 12)
}

function getDateValueFromDate(date: Date) {
  return `${date.getFullYear()}-${formatTwoDigits(date.getMonth() + 1)}-${formatTwoDigits(date.getDate())}`
}

function formatRunDatePickerLabel(dateValue: string) {
  const date = parseDateValue(dateValue)

  if (!date) {
    return 'Выбрать дату'
  }

  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatCalendarMonthLabel(date: Date) {
  const label = date.toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric',
  })

  return label.charAt(0).toUpperCase() + label.slice(1)
}

function isSameMonth(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth()
}

function buildCalendarDays(monthDate: Date, maxDateValue: string) {
  const year = monthDate.getFullYear()
  const monthIndex = monthDate.getMonth()
  const firstDayOfMonth = new Date(year, monthIndex, 1, 12)
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const leadingEmptyCells = (firstDayOfMonth.getDay() + 6) % 7
  const totalCells = Math.ceil((leadingEmptyCells + daysInMonth) / 7) * 7
  const todayValue = getTodayDateValue()

  return Array.from({ length: totalCells }, (_, index) => {
    const dayNumber = index - leadingEmptyCells + 1

    if (dayNumber < 1 || dayNumber > daysInMonth) {
      return null
    }

    const date = new Date(year, monthIndex, dayNumber, 12)
    const dateValue = getDateValueFromDate(date)

    return {
      key: dateValue,
      dateValue,
      dayNumber,
      isDisabled: dateValue > maxDateValue,
      isToday: dateValue === todayValue,
    } satisfies CalendarDayCell
  })
}

type CalendarDatePickerSheetProps = {
  open: boolean
  selectedDate: string
  maxDate: string
  onClose: () => void
  onSelect: (dateValue: string) => void
}

function CalendarDatePickerSheet({
  open,
  selectedDate,
  maxDate,
  onClose,
  onSelect,
}: CalendarDatePickerSheetProps) {
  const fallbackDate = useMemo(() => parseDateValue(maxDate) ?? new Date(), [maxDate])
  const [visibleMonth, setVisibleMonth] = useState(() => getMonthStart(parseDateValue(selectedDate) ?? fallbackDate))

  if (!open) return null

  const maxMonth = getMonthStart(fallbackDate)
  const canGoNext = !isSameMonth(visibleMonth, maxMonth)
  const calendarDays = buildCalendarDays(visibleMonth, maxDate)

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 md:items-center md:justify-center md:p-4" role="dialog" aria-modal="true" aria-label="Выбор даты тренировки">
      <div className="absolute inset-0" aria-hidden="true" onClick={onClose} />
      <div className="app-card relative w-full rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 shadow-xl md:max-w-md md:rounded-3xl">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200 dark:bg-gray-700 md:hidden" />
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="app-text-secondary min-h-11 rounded-lg px-3 py-2 text-sm"
          >
            Отмена
          </button>
          <h2 className="app-text-primary text-base font-semibold">Дата тренировки</h2>
          <div className="w-[84px]" aria-hidden="true" />
        </div>
        <div className="mt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setVisibleMonth((currentMonth) => addMonths(currentMonth, -1))}
              className="app-button-secondary inline-flex min-h-10 min-w-10 items-center justify-center rounded-full border p-2"
              aria-label="Показать предыдущий месяц"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <p className="app-text-primary text-sm font-semibold">{formatCalendarMonthLabel(visibleMonth)}</p>
            <button
              type="button"
              onClick={() => {
                if (!canGoNext) return
                setVisibleMonth((currentMonth) => addMonths(currentMonth, 1))
              }}
              disabled={!canGoNext}
              className="app-button-secondary inline-flex min-h-10 min-w-10 items-center justify-center rounded-full border p-2 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Показать следующий месяц"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {CALENDAR_WEEKDAY_LABELS.map((weekday) => (
              <div key={weekday} className="app-text-secondary px-1 py-2 text-xs font-medium">
                {weekday}
              </div>
            ))}
            {calendarDays.map((day, index) => {
              if (!day) {
                return <div key={`empty-${index}`} className="aspect-square" aria-hidden="true" />
              }

              const isSelected = day.dateValue === selectedDate && !day.isDisabled

              return (
                <button
                  key={day.key}
                  type="button"
                  disabled={day.isDisabled}
                  onClick={() => {
                    if (day.isDisabled) return
                    onSelect(day.dateValue)
                    onClose()
                  }}
                  className={`aspect-square rounded-xl text-sm transition-colors ${
                    day.isDisabled
                      ? 'cursor-not-allowed bg-transparent text-gray-300 dark:text-gray-600'
                      : isSelected
                        ? 'app-button-primary'
                        : day.isToday
                          ? 'app-text-primary ring-1 ring-black/10 dark:ring-white/15'
                          : 'app-text-primary hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10'
                  }`}
                  aria-label={formatRunDatePickerLabel(day.dateValue)}
                >
                  {day.dayNumber}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

const QUICK_DISTANCE_CHIPS = [
  { label: '5 км', wholeKm: 5, tenthsKm: 0 },
  { label: '10 км', wholeKm: 10, tenthsKm: 0 },
  { label: '15 км', wholeKm: 15, tenthsKm: 0 },
  { label: '20 км', wholeKm: 20, tenthsKm: 0 },
]

function formatTwoDigits(value: number) {
  return String(value).padStart(2, '0')
}

function formatCompactDistanceLabel(distanceKm: number) {
  return distanceKm.toFixed(2).replace(/\.?0+$/, '')
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

function normalizeIntegerMetric(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.round(value)
}

function parseDurationPartInput(rawValue: string, maxValue?: number) {
  const normalizedValue = rawValue.trim()

  if (!normalizedValue) {
    return 0
  }

  if (!/^\d+$/.test(normalizedValue)) {
    return null
  }

  const parsedValue = Number(normalizedValue)

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null
  }

  if (typeof maxValue === 'number' && parsedValue > maxValue) {
    return null
  }

  return parsedValue
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
  const [availableShoes, setAvailableShoes] = useState<UserShoeRecord[]>([])
  const [selectedShoeId, setSelectedShoeId] = useState<string>('')
  const [loadingShoes, setLoadingShoes] = useState(false)
  const [title, setTitle] = useState('')
  const [runDate, setRunDate] = useState(getTodayDateValue())
  const [runDatePickerOpen, setRunDatePickerOpen] = useState(false)
  const [distanceInput, setDistanceInput] = useState('')
  const [durationHoursInput, setDurationHoursInput] = useState('0')
  const [durationMinutesInput, setDurationMinutesInput] = useState('0')
  const [durationSecondsInput, setDurationSecondsInput] = useState('0')
  const [error, setError] = useState('')
  const [saveInfoMessage, setSaveInfoMessage] = useState('')
  const [runsError, setRunsError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [deletingRunIds, setDeletingRunIds] = useState<string[]>([])
  const [activeStravaHintRunId, setActiveStravaHintRunId] = useState<string | null>(null)
  const lastRunsFetchAtRef = useRef(0)
  const runsRequestPromiseRef = useRef<Promise<void> | null>(null)
  const suppressNextRunsUpdatedRefreshRef = useRef(false)
  const parsedDistanceKm = parseDistanceInput(distanceInput)
  const selectedDistanceKm = parsedDistanceKm ?? 0
  const compactDistanceLabel = selectedDistanceKm > 0 ? formatCompactDistanceLabel(selectedDistanceKm) : '0'
  const parsedDurationHours = parseDurationPartInput(durationHoursInput)
  const parsedDurationMinutes = parseDurationPartInput(durationMinutesInput, 59)
  const parsedDurationSeconds = parseDurationPartInput(durationSecondsInput, 59)
  const hasValidDuration = parsedDurationHours != null && parsedDurationMinutes != null && parsedDurationSeconds != null
  const compactDurationLabel = formatCompactDurationLabel(
    parsedDurationHours ?? 0,
    parsedDurationMinutes ?? 0,
    parsedDurationSeconds ?? 0
  )
  const selectedDurationSeconds =
    hasValidDuration
      ? (parsedDurationHours ?? 0) * 3600 + (parsedDurationMinutes ?? 0) * 60 + (parsedDurationSeconds ?? 0)
      : 0
  const selectedDurationMinutes = selectedDurationSeconds > 0 ? Math.max(1, Math.round(selectedDurationSeconds / 60)) : 0
  const normalizedWorkoutName = title.trim()
  const pacePreview = formatPaceLabel(selectedDurationSeconds, selectedDistanceKm)
  const showPacePreview = shouldShowPace(selectedDurationSeconds, selectedDistanceKm)
  const selectedDate = runDate || getTodayDateValue()
  const todayDateValue = getTodayDateValue()
  const runDateLabel = formatRunDatePickerLabel(selectedDate)
  const isWorkoutFormValid =
    Boolean(selectedDate) &&
    Number.isFinite(selectedDistanceKm) &&
    selectedDistanceKm > 0 &&
    Number.isFinite(selectedDurationMinutes) &&
    selectedDurationMinutes > 0 &&
    selectedDurationSeconds > 0 &&
    !isFutureRunDate(selectedDate)

  function handleDistanceInputChange(nextValue: string) {
    const normalizedValue = nextValue.replace(',', '.')

    if (!/^\d*([.]\d{0,2})?$/.test(normalizedValue)) {
      return
    }

    setDistanceInput(normalizedValue)
  }

  function applyQuickDistance(wholeKm: number, tenthsKm: number, hundredthsKm = 0) {
    const quickDistance = wholeKm + tenthsKm / 10 + hundredthsKm / 100
    setDistanceInput(formatCompactDistanceLabel(quickDistance))
  }

  function handleDurationInputChange(
    part: 'hours' | 'minutes' | 'seconds',
    nextValue: string
  ) {
    if (!/^\d*$/.test(nextValue)) {
      return
    }

    if (part === 'hours') {
      setDurationHoursInput(nextValue)
      return
    }

    if (part === 'minutes') {
      setDurationMinutesInput(nextValue)
      return
    }

    setDurationSecondsInput(nextValue)
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

  useEffect(() => {
    let isMounted = true

    if (!user) {
      setAvailableShoes([])
      setSelectedShoeId('')
      setLoadingShoes(false)
      return () => {
        isMounted = false
      }
    }

    setLoadingShoes(true)

    void loadUserShoeSelectionData()
      .then((selectionData) => {
        if (!isMounted) {
          return
        }

        setAvailableShoes(selectionData.shoes)
        setSelectedShoeId((currentValue) => {
          if (currentValue) {
            return currentValue
          }

          return selectionData.mostRecentlyUsedShoeId ?? ''
        })
      })
      .catch(() => {
        if (isMounted) {
          setAvailableShoes([])
          setSelectedShoeId('')
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoadingShoes(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [user])

  const fetchRuns = useCallback(async (
    currentUser: User,
    options: { force?: boolean } = {}
  ) => {
    const { force = false } = options

    if (!force && Date.now() - lastRunsFetchAtRef.current < RUNS_REFETCH_THROTTLE_MS) {
      return runsRequestPromiseRef.current ?? Promise.resolve()
    }

    if (runsRequestPromiseRef.current) {
      return runsRequestPromiseRef.current
    }

    setLoadingRuns(true)
    setRunsError('')

    const requestPromise = (async () => {
      try {
        const response = await fetch('/api/runs', {
          method: 'GET',
          cache: 'no-store',
          credentials: 'include',
        })

        if (response.status === 401) {
          router.replace('/login')
          return
        }

        const payload = (await response.json()) as
          | { ok: true; runs: Run[] }
          | { ok: false; step?: string; error?: string }

        if (!response.ok || !payload.ok) {
          setRunsError('Не удалось загрузить тренировки')
          return
        }

        const normalizedRuns = (payload.runs ?? []).map((run) => ({
          ...run,
          distance_km: Number(run.distance_km ?? 0),
          duration_minutes: Number(run.duration_minutes ?? 0),
          duration_seconds:
            run.duration_seconds == null ? null : Number(run.duration_seconds ?? 0),
          xp: Number(run.xp ?? 0),
        }))

        lastRunsFetchAtRef.current = Date.now()
        setRuns(normalizedRuns)
      } catch {
        setRunsError('Не удалось загрузить тренировки')
      } finally {
        setLoadingRuns(false)
        runsRequestPromiseRef.current = null
      }
    })()

    runsRequestPromiseRef.current = requestPromise
    return requestPromise
  }, [router])

  useEffect(() => {
    if (!user) return
    const currentUser = user

    async function loadRuns() {
      await fetchRuns(currentUser, { force: true })
    }

    void loadRuns()
  }, [fetchRuns, user])

  useEffect(() => {
    if (!user) return

    const currentUser = user

    function handleVisibilityRefresh() {
      if (document.visibilityState === 'visible') {
        void fetchRuns(currentUser)
      }
    }

    function handleWindowFocus() {
      void fetchRuns(currentUser)
    }

    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityRefresh)

    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibilityRefresh)
    }
  }, [fetchRuns, user])

  useEffect(() => {
    if (!saveInfoMessage) {
      return
    }

    const timer = window.setTimeout(() => {
      setSaveInfoMessage('')
    }, 3200)

    return () => {
      window.clearTimeout(timer)
    }
  }, [saveInfoMessage])

  useEffect(() => {
    if (!activeStravaHintRunId) {
      return
    }

    const timer = window.setTimeout(() => {
      setActiveStravaHintRunId(null)
    }, 2200)

    return () => {
      window.clearTimeout(timer)
    }
  }, [activeStravaHintRunId])

  useEffect(() => {
    if (!user) return

    const currentUser = user

    function handleRunsUpdated() {
      if (suppressNextRunsUpdatedRefreshRef.current) {
        suppressNextRunsUpdatedRefreshRef.current = false
        return
      }

      void fetchRuns(currentUser, { force: true })
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === RUNS_UPDATED_STORAGE_KEY) {
        void fetchRuns(currentUser, { force: true })
      }
    }

    window.addEventListener(RUNS_UPDATED_EVENT, handleRunsUpdated)
    window.addEventListener('storage', handleStorage)

    return () => {
      window.removeEventListener(RUNS_UPDATED_EVENT, handleRunsUpdated)
      window.removeEventListener('storage', handleStorage)
    }
  }, [fetchRuns, user])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || submitting) return

    const normalizedTitle = normalizedWorkoutName || DEFAULT_WORKOUT_NAME
    const d = selectedDistanceKm
    const dur = selectedDurationMinutes

    if (distanceInput.trim() && parsedDistanceKm == null) {
      setError('Введите корректную дистанцию, например 5.25 км')
      return
    }

    if (!Number.isFinite(d) || d <= 0) {
      setError('Укажите дистанцию больше 0 км')
      return
    }

    if (!hasValidDuration) {
      setError('Проверьте время: часы от 0, минуты и секунды от 0 до 59')
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
    setSaveInfoMessage('')
    setSubmitting(true)
    const distanceMeters = normalizeIntegerMetric(d * 1000)
    const movingTimeSeconds = normalizeIntegerMetric(selectedDurationSeconds)
    const elapsedTimeSeconds = normalizeIntegerMetric(selectedDurationSeconds)
    const averagePaceSeconds = distanceMeters > 0
      ? normalizeIntegerMetric(selectedDurationSeconds / (distanceMeters / 1000))
      : 0
    const xp = normalizeIntegerMetric(50 + d * 10)

    try {
      const { error: createError, shoeWearMessage } = await createRun({
        name: normalizedTitle,
        title: normalizedTitle,
        distanceKm: d,
        distanceMeters,
        durationMinutes: dur,
        durationSeconds: selectedDurationSeconds,
        movingTimeSeconds,
        elapsedTimeSeconds,
        averagePaceSeconds,
        createdAt: createdAtDate.toISOString(),
        xp,
        shoeId: selectedShoeId || null,
      })

      if (createError) {
        setError(createError.message)
        return
      }

      setTitle('')
      setRunDate(getTodayDateValue())
      setDistanceInput('')
      setDurationHoursInput('0')
      setDurationMinutesInput('0')
      setDurationSecondsInput('0')
      setError('')
      setSaveInfoMessage(shoeWearMessage ?? '')
      dispatchRunsUpdatedEvent()
    } catch {
      setError('Не удалось сохранить тренировку')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    if (deletingRunIds.includes(id)) return
    if (typeof window !== 'undefined' && !window.confirm('Удалить тренировку?')) return

    setError('')
    setSaveInfoMessage('')
    setDeletingRunIds((prev) => [...prev, id])

    try {
      const { error } = await deleteRun(id)

      if (error) {
        setError('Не удалось удалить тренировку')
        return
      }

      setRuns((prev) => prev.filter((r) => r.id !== id))
      if (activeStravaHintRunId === id) {
        setActiveStravaHintRunId(null)
      }
      suppressNextRunsUpdatedRefreshRef.current = true
      dispatchRunsUpdatedEvent()
    } catch {
      setError('Не удалось удалить тренировку')
    } finally {
      setDeletingRunIds((prev) => prev.filter((runId) => runId !== id))
    }
  }

  function handleRunCardOpen(runId: string, event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement
    if (target.closest('button,a')) {
      return
    }

    router.push(`/runs/${runId}`)
  }

  if (loading) return <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">Загрузка...</main>
  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

  return (
    <main className="min-h-screen pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
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
            onClick={() => setRunDatePickerOpen(true)}
            disabled={submitting}
            className="app-button-secondary flex min-h-11 w-full items-center justify-between rounded-lg border px-3 py-2 text-left"
          >
            <span className="app-text-primary font-semibold">{runDateLabel}</span>
          </button>
          <p className="app-text-secondary mt-2 text-xs">Будущие даты недоступны и отображаются неактивными в календаре.</p>
        </div>
        <div>
          <label className="app-text-secondary mb-1 block text-sm">Дистанция</label>
          <input
            id="distance"
            type="text"
            inputMode="decimal"
            placeholder="Например: 5.25"
            value={distanceInput}
            onChange={(event) => handleDistanceInputChange(event.target.value)}
            disabled={submitting}
            className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
          />
          <p className="app-text-secondary mt-2 text-xs">Введите дистанцию в километрах. Поддерживаются значения вроде 5, 10, 21.1 и 5.25.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK_DISTANCE_CHIPS.map((chip) => {
              const isActive = parsedDistanceKm === chip.wholeKm + chip.tenthsKm / 10

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
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="duration_hours" className="app-text-secondary mb-1 block text-xs">Часы</label>
              <input
                id="duration_hours"
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={durationHoursInput}
                onChange={(event) => handleDurationInputChange('hours', event.target.value)}
                disabled={submitting}
                className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="duration_minutes" className="app-text-secondary mb-1 block text-xs">Мин</label>
              <input
                id="duration_minutes"
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={durationMinutesInput}
                onChange={(event) => handleDurationInputChange('minutes', event.target.value)}
                disabled={submitting}
                className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="duration_seconds" className="app-text-secondary mb-1 block text-xs">Сек</label>
              <input
                id="duration_seconds"
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={durationSecondsInput}
                onChange={(event) => handleDurationInputChange('seconds', event.target.value)}
                disabled={submitting}
                className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
              />
            </div>
          </div>
          <p className="app-text-secondary mt-2 text-xs">Минуты и секунды должны быть в диапазоне от 0 до 59.</p>
        </div>
        <div>
          <label htmlFor="shoe_id" className="app-text-secondary mb-1 block text-sm">Кроссовки</label>
          <select
            id="shoe_id"
            value={selectedShoeId}
            onChange={(event) => setSelectedShoeId(event.target.value)}
            disabled={submitting || loadingShoes}
            className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
          >
            <option value="">Без кроссовок</option>
            {availableShoes.map((shoe) => (
              <option key={shoe.id} value={shoe.id}>
                {shoe.displayName}
                {shoe.nickname ? ` (${shoe.nickname})` : ''}
              </option>
            ))}
          </select>
          <p className="app-text-secondary mt-2 text-xs">
            {availableShoes.length > 0
              ? 'По умолчанию выбрана последняя использованная пара, если она есть.'
              : 'Сначала добавьте пару на экране "Активность → Кроссовки".'}
          </p>
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
        {saveInfoMessage ? (
          <div className="rounded-xl border border-amber-300/70 bg-amber-100/80 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100">
            {saveInfoMessage}
          </div>
        ) : null}
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
            <div
              key={run.id}
              className="compact-run-card app-card relative cursor-pointer overflow-hidden rounded-2xl border p-4 shadow-sm"
              role="button"
              tabIndex={0}
              onClick={(event) => handleRunCardOpen(run.id, event)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                handleRunCardOpen(run.id, event)
              }}
            >
              <div className="compact-run-card-layout flex flex-col gap-3">
                <div className="min-w-0 flex-1">
                  <p className="app-text-primary break-words text-base font-semibold">
                    {getRunDisplayName(run)}
                  </p>
                  <p className="compact-run-card-primary compact-run-card-title app-text-primary break-words text-base font-semibold">
                    {formatDistanceKmLabel(run)} км • {formatRunDurationLabel(run)}
                    {formatRunPace(run)
                      ? ` • ${formatRunPace(run)}`
                      : ''}
                  </p>
                  <p className="compact-run-card-secondary compact-run-card-meta app-text-muted text-sm mt-1">
                    {formatRunTimestampLabel(run.created_at, run.external_source)}
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
              {run.external_source === 'strava' ? (
                <>
                  {activeStravaHintRunId === run.id ? (
                    <div className="app-text-secondary absolute bottom-12 right-4 z-10 rounded-full border bg-white/95 px-3 py-1.5 text-xs shadow-sm dark:bg-black/90">
                      Импортировано из Strava
                    </div>
                  ) : null}
                  <button
                    type="button"
                    aria-label="Показать источник Strava"
                    onClick={() =>
                      setActiveStravaHintRunId((current) => (current === run.id ? null : run.id))
                    }
                    className="absolute bottom-4 right-4 inline-flex h-6 w-6 items-center justify-center rounded-full border bg-white/80 dark:bg-black/20"
                  >
                    <StravaIcon />
                  </button>
                </>
              ) : null}
            </div>
          ))
        )}
      </div>
      </div>
      <CalendarDatePickerSheet
        key={`${selectedDate}:${todayDateValue}`}
        open={runDatePickerOpen}
        selectedDate={selectedDate}
        maxDate={todayDateValue}
        onClose={() => setRunDatePickerOpen(false)}
        onSelect={setRunDate}
      />
    </main>
  )
}
