'use client'

import { ArrowUpRight, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import ConfirmActionSheet from '@/components/ConfirmActionSheet'
import { loadActivityRuns, type ActivityRunRow } from '@/lib/activity'
import { formatDistanceKm, formatRunTimestampLabel } from '@/lib/format'
import {
  createRaceEvent,
  deleteRaceEvent,
  isRaceEventUpcoming,
  loadRaceEvents,
  updateRaceEvent,
  type RaceEvent,
  type RaceEventLinkedRunSummary,
} from '@/lib/race-events'

type RacesManagerProps = {
  userId: string
}

type RaceEventCardProps = {
  raceEvent: RaceEvent
  candidateRuns: ActivityRunRow[]
  selectedSuggestedRunId: string
  isMenuOpen: boolean
  isLinking: boolean
  isUnlinking: boolean
  onMenuToggle: (raceEventId: string) => void
  onEdit: (raceEvent: RaceEvent) => void
  onDelete: (raceEvent: RaceEvent) => void
  onConfirmSuggestedLink: (raceEvent: RaceEvent) => void
  onSelectSuggestedRun: (raceEventId: string, runId: string) => void
  onUnlink: (raceEvent: RaceEvent) => void
}

const DEFAULT_WORKOUT_NAME = 'Бег'
const DEFAULT_RACE_EVENT_NAME = 'Новый старт'
const ONE_DAY_MS = 24 * 60 * 60 * 1000

function formatRaceDateLabel(dateValue: string) {
  const parsedDate = new Date(`${dateValue}T12:00:00`)

  if (Number.isNaN(parsedDate.getTime())) {
    return dateValue
  }

  return parsedDate.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
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

function getRunDisplayName(run: Pick<ActivityRunRow, 'name' | 'title'>) {
  return run.name?.trim() || run.title?.trim() || DEFAULT_WORKOUT_NAME
}

function formatDistanceKmLabel(run: Pick<ActivityRunRow, 'distance_km' | 'external_source'>) {
  const distanceValue = Number(run.distance_km ?? 0)

  if (run.external_source === 'strava') {
    return formatPreciseDistanceKm(distanceValue)
  }

  return formatDistanceKm(distanceValue)
}

function getRaceEventLinkedRun(raceEvent: Pick<RaceEvent, 'linked_run'>) {
  const linkedRun = raceEvent.linked_run

  if (Array.isArray(linkedRun)) {
    return (linkedRun[0] ?? null) as RaceEventLinkedRunSummary | null
  }

  return (linkedRun ?? null) as RaceEventLinkedRunSummary | null
}

function getRaceEventLinkedRunLabel(raceEvent: RaceEvent) {
  const linkedRun = getRaceEventLinkedRun(raceEvent)

  if (!linkedRun) {
    return null
  }

  const runName = linkedRun.name?.trim() || linkedRun.title?.trim() || DEFAULT_WORKOUT_NAME
  const distanceKm = Number(linkedRun.distance_km ?? 0)
  const distanceSuffix = distanceKm > 0 ? ` • ${formatDistanceKm(distanceKm)} км` : ''

  return `${formatRunTimestampLabel(linkedRun.created_at, null)} • ${runName}${distanceSuffix}`
}

function getDateOnlyTimestamp(dateValue: string) {
  if (!dateValue) {
    return null
  }

  const [yearString, monthString, dayString] = dateValue.slice(0, 10).split('-')
  const year = Number(yearString)
  const month = Number(monthString)
  const day = Number(dayString)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }

  const nextDate = new Date(year, month - 1, day, 12)

  if (Number.isNaN(nextDate.getTime())) {
    return null
  }

  return nextDate.getTime()
}

function getCandidateRunsForRaceDate(raceDate: string, runs: ActivityRunRow[]) {
  const raceDateTimestamp = getDateOnlyTimestamp(raceDate)

  if (raceDateTimestamp == null) {
    return [] as ActivityRunRow[]
  }

  return runs
    .map((run) => ({
      run,
      runDateTimestamp: getDateOnlyTimestamp(run.created_at),
    }))
    .filter((entry) => entry.runDateTimestamp != null)
    .filter((entry) => Math.abs((entry.runDateTimestamp as number) - raceDateTimestamp) <= ONE_DAY_MS)
    .sort((left, right) => {
      const leftDiff = Math.abs((left.runDateTimestamp as number) - raceDateTimestamp)
      const rightDiff = Math.abs((right.runDateTimestamp as number) - raceDateTimestamp)

      if (leftDiff !== rightDiff) {
        return leftDiff - rightDiff
      }

      return right.run.created_at.localeCompare(left.run.created_at)
    })
    .map((entry) => entry.run)
}

function getCandidateRunLabel(run: ActivityRunRow) {
  return `${formatRunTimestampLabel(run.created_at, run.external_source)} • ${getRunDisplayName(run)} • ${formatDistanceKmLabel(run)} км`
}

function formatResultTimeClock(totalSeconds: number | null | undefined) {
  if (!Number.isFinite(totalSeconds) || (totalSeconds ?? 0) < 0) {
    return null
  }

  const normalizedSeconds = Math.round(totalSeconds ?? 0)
  const hours = Math.floor(normalizedSeconds / 3600)
  const minutes = Math.floor((normalizedSeconds % 3600) / 60)
  const seconds = normalizedSeconds % 60

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':')
}

function parseResultTimeClock(value: string) {
  const normalizedValue = value.trim()

  if (!normalizedValue) {
    return { value: null, isValid: true }
  }

  const match = normalizedValue.match(/^(\d+):([0-5]\d):([0-5]\d)$/)

  if (!match) {
    return { value: null, isValid: false }
  }

  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return { value: null, isValid: false }
  }

  return {
    value: (hours * 3600) + (minutes * 60) + seconds,
    isValid: true,
  }
}

function getRaceEventDisplayTimeSeconds(raceEvent: RaceEvent) {
  const linkedRun = getRaceEventLinkedRun(raceEvent)

  if (Number.isFinite(linkedRun?.moving_time_seconds) && (linkedRun?.moving_time_seconds ?? 0) >= 0) {
    return {
      seconds: Math.round(linkedRun?.moving_time_seconds ?? 0),
      source: 'linked_run' as const,
    }
  }

  if (Number.isFinite(raceEvent.result_time_seconds) && (raceEvent.result_time_seconds ?? 0) >= 0) {
    return {
      seconds: Math.round(raceEvent.result_time_seconds ?? 0),
      source: 'manual' as const,
    }
  }

  return null
}

function RaceEventCard({
  raceEvent,
  candidateRuns,
  selectedSuggestedRunId,
  isMenuOpen,
  isLinking,
  isUnlinking,
  onMenuToggle,
  onEdit,
  onDelete,
  onConfirmSuggestedLink,
  onSelectSuggestedRun,
  onUnlink,
}: RaceEventCardProps) {
  const linkedRunLabel = getRaceEventLinkedRunLabel(raceEvent)
  const displayTime = getRaceEventDisplayTimeSeconds(raceEvent)
  const displayTimeLabel = formatResultTimeClock(displayTime?.seconds)

  return (
    <div className="rounded-2xl border px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="app-text-primary text-sm font-semibold">{raceEvent.name}</p>
          <p className="app-text-secondary mt-1 text-sm">
            {formatRaceDateLabel(raceEvent.race_date)}
          </p>
          <p className="app-text-secondary mt-2 text-sm">
            {raceEvent.linked_run_id
              ? 'Тренировка прикреплена'
              : 'Пока нет привязанной тренировки'}
          </p>
          {raceEvent.linked_run_id && linkedRunLabel ? (
            <div className="mt-1">
              <p className="app-text-secondary text-xs">
                {linkedRunLabel}
              </p>
              {displayTimeLabel ? (
                <p className="app-text-primary mt-2 text-sm font-medium">
                  Результат: {displayTimeLabel}
                  {displayTime?.source === 'linked_run' ? ' • из тренировки' : ''}
                </p>
              ) : null}
              <Link
                href={`/runs/${raceEvent.linked_run_id}`}
                className="app-button-secondary mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium"
              >
                <span>Открыть тренировку</span>
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          ) : null}
          {!raceEvent.linked_run_id && displayTimeLabel ? (
            <p className="app-text-primary mt-2 text-sm font-medium">
              Результат: {displayTimeLabel}
            </p>
          ) : null}
          {!raceEvent.linked_run_id && candidateRuns.length > 0 ? (
            <div className="mt-3 rounded-2xl border border-amber-300/60 bg-amber-50/70 px-3 py-3 dark:border-amber-300/20 dark:bg-amber-300/10">
              <p className="app-text-primary text-sm font-medium">Похоже, это был забег — привязать?</p>
              {candidateRuns.length > 1 ? (
                <select
                  value={selectedSuggestedRunId}
                  onChange={(event) => onSelectSuggestedRun(raceEvent.id, event.target.value)}
                  className="app-input mt-3 min-h-11 w-full rounded-lg border px-3 py-2"
                >
                  {candidateRuns.map((run) => (
                    <option key={run.id} value={run.id}>
                      {getCandidateRunLabel(run)}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="app-text-secondary mt-1 text-sm">
                  {getCandidateRunLabel(candidateRuns[0])}
                </p>
              )}
              <button
                type="button"
                onClick={() => void onConfirmSuggestedLink(raceEvent)}
                disabled={isLinking}
                className="app-button-secondary mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLinking ? 'Привязываем...' : 'Привязать тренировку'}
              </button>
            </div>
          ) : null}
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => onMenuToggle(raceEvent.id)}
            className="app-button-secondary inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border px-2 py-2"
            aria-label="Открыть действия со стартом"
            aria-expanded={isMenuOpen}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {isMenuOpen ? (
            <div className="app-card absolute right-0 top-12 z-20 min-w-44 rounded-2xl border p-1.5 shadow-lg">
              <button
                type="button"
                onClick={() => onEdit(raceEvent)}
                className="app-text-primary flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5"
              >
                <Pencil className="h-4 w-4" />
                Редактировать
              </button>
              {raceEvent.linked_run_id ? (
                <button
                  type="button"
                  onClick={() => onUnlink(raceEvent)}
                  disabled={isUnlinking}
                  className="app-text-primary flex min-h-10 w-full items-center rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/5"
                >
                  {isUnlinking ? 'Убираем связь...' : 'Отвязать тренировку'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onDelete(raceEvent)}
                className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4" />
                Удалить
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function RacesManager({ userId }: RacesManagerProps) {
  const [pendingDeleteRaceEvent, setPendingDeleteRaceEvent] = useState<RaceEvent | null>(null)
  const [submittingRaceEvent, setSubmittingRaceEvent] = useState(false)
  const [deletingRaceEventId, setDeletingRaceEventId] = useState<string | null>(null)
  const [editingRaceEventId, setEditingRaceEventId] = useState<string | null>(null)
  const [openRaceEventMenuId, setOpenRaceEventMenuId] = useState<string | null>(null)
  const [raceEventName, setRaceEventName] = useState('')
  const [raceEventDate, setRaceEventDate] = useState('')
  const [resultTimeInput, setResultTimeInput] = useState('')
  const [selectedLinkedRunId, setSelectedLinkedRunId] = useState('')
  const [formSuggestedRunId, setFormSuggestedRunId] = useState('')
  const [suggestedRunIdsByRaceEvent, setSuggestedRunIdsByRaceEvent] = useState<Record<string, string>>({})
  const [raceEventsError, setRaceEventsError] = useState('')
  const [linkingRaceEventId, setLinkingRaceEventId] = useState<string | null>(null)
  const [unlinkingRaceEventId, setUnlinkingRaceEventId] = useState<string | null>(null)
  const menuContainerRef = useRef<HTMLDivElement | null>(null)
  const { data: runs } = useSWR(
    ['activity-runs', userId] as const,
    ([, nextUserId]: readonly [string, string]) => loadActivityRuns(nextUserId),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      dedupingInterval: 15000,
      focusThrottleInterval: 15000,
    }
  )
  const {
    data: raceEvents,
    error: raceEventsLoadError,
    isLoading: isRaceEventsLoading,
    mutate: mutateRaceEvents,
  } = useSWR(
    ['race-events', userId] as const,
    () => loadRaceEvents(),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      dedupingInterval: 15000,
      focusThrottleInterval: 15000,
    }
  )
  const workoutOptions = useMemo(() => (
    (runs ?? []).map((run) => ({
      id: run.id,
      label: getCandidateRunLabel(run),
    }))
  ), [runs])
  const formCandidateRuns = useMemo(
    () => getCandidateRunsForRaceDate(raceEventDate, runs ?? []),
    [raceEventDate, runs]
  )
  const upcomingRaceEvents = useMemo(() => (
    (raceEvents ?? [])
      .filter((raceEvent) => isRaceEventUpcoming(raceEvent))
      .sort((left, right) => left.race_date.localeCompare(right.race_date))
  ), [raceEvents])
  const pastRaceEvents = useMemo(() => (
    (raceEvents ?? [])
      .filter((raceEvent) => !isRaceEventUpcoming(raceEvent))
      .sort((left, right) => right.race_date.localeCompare(left.race_date))
  ), [raceEvents])
  const deletingActiveRaceEvent = pendingDeleteRaceEvent ? deletingRaceEventId === pendingDeleteRaceEvent.id : false

  useEffect(() => {
    if (raceEventsLoadError) {
      setRaceEventsError('Не удалось загрузить старты')
    }
  }, [raceEventsLoadError])

  useEffect(() => {
    if (selectedLinkedRunId) {
      setFormSuggestedRunId('')
      return
    }

    const bestCandidateRunId = formCandidateRuns[0]?.id ?? ''
    setFormSuggestedRunId((currentValue) => {
      if (!bestCandidateRunId) {
        return ''
      }

      if (currentValue && formCandidateRuns.some((run) => run.id === currentValue)) {
        return currentValue
      }

      return bestCandidateRunId
    })
  }, [formCandidateRuns, selectedLinkedRunId])

  useEffect(() => {
    setSuggestedRunIdsByRaceEvent((currentValue) => {
      const nextValue: Record<string, string> = {}

      for (const raceEvent of raceEvents ?? []) {
        if (raceEvent.linked_run_id) {
          continue
        }

        const candidateRuns = getCandidateRunsForRaceDate(raceEvent.race_date, runs ?? [])
        const currentCandidateId = currentValue[raceEvent.id]

        if (currentCandidateId && candidateRuns.some((run) => run.id === currentCandidateId)) {
          nextValue[raceEvent.id] = currentCandidateId
          continue
        }

        if (candidateRuns[0]?.id) {
          nextValue[raceEvent.id] = candidateRuns[0].id
        }
      }

      return nextValue
    })
  }, [raceEvents, runs])

  useEffect(() => {
    if (!openRaceEventMenuId) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      if (!menuContainerRef.current?.contains(event.target as Node)) {
        setOpenRaceEventMenuId(null)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [openRaceEventMenuId])

  const upsertRaceEvent = useCallback(async (nextRaceEvent: RaceEvent) => {
    await mutateRaceEvents((currentRaceEvents) => {
      const previousRaceEvents = currentRaceEvents ?? []
      const hasExistingRaceEvent = previousRaceEvents.some((raceEvent) => raceEvent.id === nextRaceEvent.id)

      if (!hasExistingRaceEvent) {
        return [nextRaceEvent, ...previousRaceEvents]
      }

      return previousRaceEvents.map((raceEvent) => (
        raceEvent.id === nextRaceEvent.id ? nextRaceEvent : raceEvent
      ))
    }, { revalidate: false })
  }, [mutateRaceEvents])

  const resetRaceEventForm = useCallback(() => {
    setEditingRaceEventId(null)
    setOpenRaceEventMenuId(null)
    setRaceEventName('')
    setRaceEventDate('')
    setResultTimeInput('')
    setSelectedLinkedRunId('')
    setFormSuggestedRunId('')
    setRaceEventsError('')
  }, [])

  const handleSubmitRaceEvent = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (submittingRaceEvent) {
      return
    }

    const normalizedName = raceEventName.trim() || DEFAULT_RACE_EVENT_NAME
    const normalizedRaceDate = raceEventDate.trim()
    const normalizedResultTime = parseResultTimeClock(resultTimeInput)
    const normalizedLinkedRunId = selectedLinkedRunId.trim() || null

    if (!normalizedRaceDate) {
      setRaceEventsError('Укажите дату старта')
      return
    }

    if (!normalizedResultTime.isValid) {
      setRaceEventsError('Укажите время в формате чч:мм:сс')
      return
    }

    setSubmittingRaceEvent(true)
    setRaceEventsError('')

    try {
      const mutation = editingRaceEventId
        ? await updateRaceEvent(editingRaceEventId, {
          name: normalizedName,
          raceDate: normalizedRaceDate,
          resultTimeSeconds: normalizedResultTime.value,
          linkedRunId: normalizedLinkedRunId,
        })
        : await createRaceEvent({
          name: normalizedName,
          raceDate: normalizedRaceDate,
          resultTimeSeconds: normalizedResultTime.value,
          linkedRunId: normalizedLinkedRunId,
        })

      if (mutation.error || !mutation.data) {
        setRaceEventsError(editingRaceEventId ? 'Не удалось обновить старт' : 'Не удалось создать старт')
        return
      }

      await upsertRaceEvent(mutation.data)
      resetRaceEventForm()
    } catch {
      setRaceEventsError(editingRaceEventId ? 'Не удалось обновить старт' : 'Не удалось создать старт')
    } finally {
      setSubmittingRaceEvent(false)
    }
  }, [editingRaceEventId, raceEventDate, raceEventName, resetRaceEventForm, resultTimeInput, selectedLinkedRunId, submittingRaceEvent, upsertRaceEvent])

  const handleStartEditingRaceEvent = useCallback((raceEvent: RaceEvent) => {
    setOpenRaceEventMenuId(null)
    setEditingRaceEventId(raceEvent.id)
    setRaceEventName(raceEvent.name)
    setRaceEventDate(raceEvent.race_date)
    setResultTimeInput(formatResultTimeClock(raceEvent.result_time_seconds) ?? '')
    setSelectedLinkedRunId(raceEvent.linked_run_id ?? '')
    setFormSuggestedRunId('')
    setRaceEventsError('')
  }, [])

  const handleConfirmSuggestedLink = useCallback(async (raceEvent: RaceEvent) => {
    const suggestedRunId = suggestedRunIdsByRaceEvent[raceEvent.id] ?? ''

    if (!suggestedRunId || linkingRaceEventId) {
      return
    }

    setLinkingRaceEventId(raceEvent.id)
    setRaceEventsError('')

    try {
      const mutation = await updateRaceEvent(raceEvent.id, {
        name: raceEvent.name,
        raceDate: raceEvent.race_date,
        linkedRunId: suggestedRunId,
      })

      if (mutation.error || !mutation.data) {
        setRaceEventsError('Не удалось привязать тренировку')
        return
      }

      await upsertRaceEvent(mutation.data)
    } catch {
      setRaceEventsError('Не удалось привязать тренировку')
    } finally {
      setLinkingRaceEventId(null)
    }
  }, [linkingRaceEventId, suggestedRunIdsByRaceEvent, upsertRaceEvent])

  const handleUnlinkRaceEvent = useCallback(async (raceEvent: RaceEvent) => {
    if (!raceEvent.linked_run_id || unlinkingRaceEventId) {
      return
    }

    setOpenRaceEventMenuId(null)
    setUnlinkingRaceEventId(raceEvent.id)
    setRaceEventsError('')

    try {
      const mutation = await updateRaceEvent(raceEvent.id, {
        name: raceEvent.name,
        raceDate: raceEvent.race_date,
        linkedRunId: null,
      })

      if (mutation.error || !mutation.data) {
        setRaceEventsError('Не удалось отвязать тренировку')
        return
      }

      await upsertRaceEvent(mutation.data)

      if (editingRaceEventId === raceEvent.id) {
        setSelectedLinkedRunId('')
      }
    } catch {
      setRaceEventsError('Не удалось отвязать тренировку')
    } finally {
      setUnlinkingRaceEventId(null)
    }
  }, [editingRaceEventId, unlinkingRaceEventId, upsertRaceEvent])

  const handleConfirmDeleteRaceEvent = useCallback(async () => {
    if (!pendingDeleteRaceEvent || deletingRaceEventId) {
      return
    }

    setDeletingRaceEventId(pendingDeleteRaceEvent.id)
    setRaceEventsError('')

    try {
      const { error: deleteError } = await deleteRaceEvent(pendingDeleteRaceEvent.id)

      if (deleteError) {
        setRaceEventsError('Не удалось удалить старт')
        return
      }

      await mutateRaceEvents(
        (currentRaceEvents) => (currentRaceEvents ?? []).filter((raceEvent) => raceEvent.id !== pendingDeleteRaceEvent.id),
        { revalidate: false }
      )

      if (editingRaceEventId === pendingDeleteRaceEvent.id) {
        resetRaceEventForm()
      }

      setPendingDeleteRaceEvent(null)
    } catch {
      setRaceEventsError('Не удалось удалить старт')
    } finally {
      setDeletingRaceEventId(null)
    }
  }, [deletingRaceEventId, editingRaceEventId, mutateRaceEvents, pendingDeleteRaceEvent, resetRaceEventForm])

  return (
    <>
      <section className="app-card rounded-2xl border p-4 shadow-sm">
        <div className="flex flex-col gap-1">
          <h2 className="app-text-primary text-lg font-semibold">
            {editingRaceEventId ? 'Редактировать старт' : 'Новый старт'}
          </h2>
          <p className="app-text-secondary text-sm">
            {editingRaceEventId
              ? 'Измените название, дату старта и привязанную тренировку.'
              : 'Создавайте отдельные старты и при необходимости прикрепляйте к ним тренировку.'}
          </p>
        </div>

        <form onSubmit={handleSubmitRaceEvent} className="mt-4 space-y-3">
          <div>
            <label htmlFor="race-event-name" className="app-text-secondary mb-1 block text-sm">
              Название старта
            </label>
            <input
              id="race-event-name"
              type="text"
              value={raceEventName}
              onChange={(event) => setRaceEventName(event.target.value)}
              placeholder="Например: Московский марафон"
              disabled={submittingRaceEvent}
              className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="race-event-date" className="app-text-secondary mb-1 block text-sm">
              Дата старта
            </label>
            <input
              id="race-event-date"
              type="date"
              value={raceEventDate}
              onChange={(event) => setRaceEventDate(event.target.value)}
              disabled={submittingRaceEvent}
              className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="race-event-result-time" className="app-text-secondary mb-1 block text-sm">
              Результат
            </label>
            <input
              id="race-event-result-time"
              type="text"
              inputMode="numeric"
              value={resultTimeInput}
              onChange={(event) => setResultTimeInput(event.target.value)}
              placeholder="Например: 03:15:42"
              disabled={submittingRaceEvent}
              className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
            />
            <p className="app-text-secondary mt-2 text-xs">
              Формат: чч:мм:сс. Если привязана тренировка, на карточке будет показано время из нее.
            </p>
          </div>
          <div>
            <label htmlFor="race-event-linked-run" className="app-text-secondary mb-1 block text-sm">
              Привязать тренировку
            </label>
            <select
              id="race-event-linked-run"
              value={selectedLinkedRunId}
              onChange={(event) => setSelectedLinkedRunId(event.target.value)}
              disabled={submittingRaceEvent || !runs}
              className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
            >
              <option value="">Без привязанной тренировки</option>
              {workoutOptions.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.label}
                </option>
              ))}
            </select>
          </div>
          {!selectedLinkedRunId && formCandidateRuns.length > 0 ? (
            <div className="rounded-2xl border border-amber-300/60 bg-amber-50/70 px-4 py-3 dark:border-amber-300/20 dark:bg-amber-300/10">
              <p className="app-text-primary text-sm font-medium">Похоже, это был забег — привязать?</p>
              <p className="app-text-secondary mt-1 text-sm">
                {formCandidateRuns.length === 1
                  ? getCandidateRunLabel(formCandidateRuns[0])
                  : 'Найдено несколько тренировок рядом с датой старта.'}
              </p>
              {formCandidateRuns.length > 1 ? (
                <select
                  value={formSuggestedRunId}
                  onChange={(event) => setFormSuggestedRunId(event.target.value)}
                  className="app-input mt-3 min-h-11 w-full rounded-lg border px-3 py-2"
                >
                  {formCandidateRuns.map((run) => (
                    <option key={run.id} value={run.id}>
                      {getCandidateRunLabel(run)}
                    </option>
                  ))}
                </select>
              ) : null}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setSelectedLinkedRunId(formSuggestedRunId || formCandidateRuns[0]?.id || '')}
                  className="app-button-secondary inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium"
                >
                  Привязать выбранную тренировку
                </button>
              </div>
            </div>
          ) : null}
          {raceEventsError ? <p className="text-sm text-red-600">{raceEventsError}</p> : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="submit"
              disabled={submittingRaceEvent}
              className="app-button-primary inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submittingRaceEvent
                ? (editingRaceEventId ? 'Сохраняем старт...' : 'Создаем старт...')
                : (editingRaceEventId ? 'Сохранить старт' : 'Добавить старт')}
            </button>
            {editingRaceEventId ? (
              <button
                type="button"
                onClick={resetRaceEventForm}
                disabled={submittingRaceEvent}
                className="app-button-secondary inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
              >
                Отмена
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section ref={menuContainerRef} className="mt-5 rounded-2xl">
        {isRaceEventsLoading && !raceEvents ? (
          <div className="app-card rounded-2xl border px-4 py-5 shadow-sm">
            <p className="app-text-secondary text-sm">Загружаем старты...</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="app-card rounded-2xl border p-4 shadow-sm">
              <h3 className="app-text-primary text-base font-semibold">Предстоящие</h3>
              {upcomingRaceEvents.length === 0 ? (
                <p className="app-text-secondary mt-2 text-sm">Нет предстоящих стартов.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {upcomingRaceEvents.map((raceEvent) => (
                    <RaceEventCard
                      key={raceEvent.id}
                      raceEvent={raceEvent}
                      candidateRuns={getCandidateRunsForRaceDate(raceEvent.race_date, runs ?? [])}
                      selectedSuggestedRunId={suggestedRunIdsByRaceEvent[raceEvent.id] ?? ''}
                      isMenuOpen={openRaceEventMenuId === raceEvent.id}
                      isLinking={linkingRaceEventId === raceEvent.id}
                      isUnlinking={unlinkingRaceEventId === raceEvent.id}
                      onMenuToggle={(raceEventId) => {
                        setOpenRaceEventMenuId((currentValue) => currentValue === raceEventId ? null : raceEventId)
                      }}
                      onEdit={handleStartEditingRaceEvent}
                      onDelete={(nextRaceEvent) => {
                        setOpenRaceEventMenuId(null)
                        setPendingDeleteRaceEvent(nextRaceEvent)
                      }}
                      onConfirmSuggestedLink={handleConfirmSuggestedLink}
                      onSelectSuggestedRun={(raceEventId, runId) => {
                        setSuggestedRunIdsByRaceEvent((currentValue) => ({
                          ...currentValue,
                          [raceEventId]: runId,
                        }))
                      }}
                      onUnlink={handleUnlinkRaceEvent}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="app-card rounded-2xl border p-4 shadow-sm">
              <h3 className="app-text-primary text-base font-semibold">Прошедшие</h3>
              {pastRaceEvents.length === 0 ? (
                <p className="app-text-secondary mt-2 text-sm">Нет прошедших стартов.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {pastRaceEvents.map((raceEvent) => (
                    <RaceEventCard
                      key={raceEvent.id}
                      raceEvent={raceEvent}
                      candidateRuns={getCandidateRunsForRaceDate(raceEvent.race_date, runs ?? [])}
                      selectedSuggestedRunId={suggestedRunIdsByRaceEvent[raceEvent.id] ?? ''}
                      isMenuOpen={openRaceEventMenuId === raceEvent.id}
                      isLinking={linkingRaceEventId === raceEvent.id}
                      isUnlinking={unlinkingRaceEventId === raceEvent.id}
                      onMenuToggle={(raceEventId) => {
                        setOpenRaceEventMenuId((currentValue) => currentValue === raceEventId ? null : raceEventId)
                      }}
                      onEdit={handleStartEditingRaceEvent}
                      onDelete={(nextRaceEvent) => {
                        setOpenRaceEventMenuId(null)
                        setPendingDeleteRaceEvent(nextRaceEvent)
                      }}
                      onConfirmSuggestedLink={handleConfirmSuggestedLink}
                      onSelectSuggestedRun={(raceEventId, runId) => {
                        setSuggestedRunIdsByRaceEvent((currentValue) => ({
                          ...currentValue,
                          [raceEventId]: runId,
                        }))
                      }}
                      onUnlink={handleUnlinkRaceEvent}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <ConfirmActionSheet
        open={Boolean(pendingDeleteRaceEvent)}
        title="Удалить старт?"
        description="Это действие нельзя отменить."
        confirmLabel={deletingActiveRaceEvent ? 'Удаляем...' : 'Удалить'}
        cancelLabel="Отмена"
        loading={deletingActiveRaceEvent}
        destructive
        onConfirm={() => {
          void handleConfirmDeleteRaceEvent()
        }}
        onCancel={() => {
          if (!deletingActiveRaceEvent) {
            setPendingDeleteRaceEvent(null)
          }
        }}
      />
    </>
  )
}
