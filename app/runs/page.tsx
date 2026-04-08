'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getBootstrapUser } from '@/lib/auth'
import InnerPageHeader from '@/components/InnerPageHeader'
import MyShoesPicker from '@/components/MyShoesPicker'
import XpGainToast from '@/components/XpGainToast'
import {
  buildPostRunChallengeFeedbackItems,
  getAffectedChallengeIdsForRun,
  saveRecentAffectedChallengeIds,
  type PostRunChallengeFeedbackItem,
} from '@/lib/challenge-ux'
import { loadDashboardOverview } from '@/lib/dashboard'
import { dispatchRunsUpdatedEvent } from '@/lib/runs-refresh'
import { createRun } from '@/lib/runs'
import { loadUserShoeSelectionData, type UserShoeRecord } from '@/lib/shoes-client'
import type { XpBreakdownItem } from '@/lib/xp'
import type { User } from '@supabase/supabase-js'

type CalendarDayCell = {
  key: string
  dateValue: string
  dayNumber: number
  isDisabled: boolean
  isToday: boolean
}

const DEFAULT_WORKOUT_NAME = 'Бег'
const CALENDAR_WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

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

function hashStringToInt(value: string) {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash * 31) + value.charCodeAt(index)) >>> 0
  }

  return hash
}

function buildManualRunCreatedAt(dateValue: string, userId: string) {
  const [yearString, monthString, dayString] = dateValue.split('-')
  const year = Number(yearString)
  const month = Number(monthString)
  const day = Number(dayString)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }

  const selectedDateValue = `${yearString}-${monthString}-${dayString}`
  const now = new Date()
  const createdAt = new Date(year, month - 1, day)

  if (selectedDateValue === getTodayDateValue()) {
    createdAt.setHours(
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
      now.getMilliseconds()
    )
  } else {
    const seed = hashStringToInt(`${userId}:${selectedDateValue}`)
    const secondsInWindow = 16 * 60 * 60
    const offsetSeconds = seed % (secondsInWindow + 1)
    const totalSeconds = (6 * 60 * 60) + offsetSeconds
    createdAt.setHours(
      Math.floor(totalSeconds / 3600),
      Math.floor((totalSeconds % 3600) / 60),
      totalSeconds % 60,
      0
    )
  }

  if (Number.isNaN(createdAt.getTime())) {
    return null
  }

  return createdAt
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
  const searchParams = useSearchParams()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
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
  const [xpToast, setXpToast] = useState<{ xpGained: number; breakdown: XpBreakdownItem[]; challengeMessages: PostRunChallengeFeedbackItem[] } | null>(null)
  const [submitting, setSubmitting] = useState(false)
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
  const shouldReturnToDashboardAfterCreate = searchParams.get('from') === 'onboarding'
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

    void loadUserShoeSelectionData({ activeOnly: true })
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
    if (!xpToast) {
      return
    }

    const timer = window.setTimeout(() => {
      setXpToast(null)
    }, 3000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [xpToast])

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

    const createdAtDate = buildManualRunCreatedAt(selectedDate, user.id)
    if (!createdAtDate || Number.isNaN(createdAtDate.getTime())) {
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

    try {
      const { error: createError, shoeWearMessage, xpGained, breakdown } = await createRun({
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
        shoeId: selectedShoeId || null,
      })

      if (createError) {
        setError(createError.message)
        return
      }

      if (shouldReturnToDashboardAfterCreate) {
        dispatchRunsUpdatedEvent()
        router.replace('/dashboard')
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
      const overview = await loadDashboardOverview(user.id)
      const runContext = {
        distanceKm: d,
        createdAt: createdAtDate.toISOString(),
      }
      const challengeMessages = buildPostRunChallengeFeedbackItems(overview.activeChallenges, {
        distanceKm: runContext.distanceKm,
        createdAt: runContext.createdAt,
      })
      saveRecentAffectedChallengeIds(getAffectedChallengeIdsForRun(overview.activeChallenges, runContext))

      if (xpGained > 0 || challengeMessages.length > 0) {
        setXpToast({
          xpGained,
          breakdown,
          challengeMessages,
        })
      }
      dispatchRunsUpdatedEvent()
    } catch {
      setError('Не удалось сохранить тренировку')
    } finally {
      setSubmitting(false)
    }
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
    <main className="min-h-screen pt-[env(safe-area-inset-top)] md:pt-0">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <InnerPageHeader title="Тренировки" fallbackHref="/activity" sticky />
        <div className="mt-4">
          <form onSubmit={handleSubmit} className="app-card space-y-3 rounded-2xl border p-4 shadow-sm">
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
          <label className="app-text-secondary mb-2 block text-sm">Кроссовки</label>
          <MyShoesPicker
            shoes={availableShoes}
            selectedShoeId={selectedShoeId}
            onSelect={setSelectedShoeId}
            disabled={submitting || loadingShoes}
            loading={loadingShoes}
            hint={
              availableShoes.length > 0
                ? 'По умолчанию выбрана последняя использованная пара, если она есть.'
                : 'Добавьте пару на экране "Активность → Кроссовки", чтобы быстро выбирать ее здесь.'
            }
          />
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
            {xpToast ? (
              <XpGainToast
                xpGained={xpToast.xpGained}
                breakdown={xpToast.breakdown}
                challengeMessages={xpToast.challengeMessages}
              />
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
