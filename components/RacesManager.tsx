'use client'

import { Pencil, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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

export default function RacesManager({ userId }: RacesManagerProps) {
  const [pendingDeleteRaceEvent, setPendingDeleteRaceEvent] = useState<RaceEvent | null>(null)
  const [submittingRaceEvent, setSubmittingRaceEvent] = useState(false)
  const [deletingRaceEventId, setDeletingRaceEventId] = useState<string | null>(null)
  const [editingRaceEventId, setEditingRaceEventId] = useState<string | null>(null)
  const [raceEventName, setRaceEventName] = useState('')
  const [raceEventDate, setRaceEventDate] = useState('')
  const [selectedLinkedRunId, setSelectedLinkedRunId] = useState('')
  const [formSuggestedRunId, setFormSuggestedRunId] = useState('')
  const [suggestedRunIdsByRaceEvent, setSuggestedRunIdsByRaceEvent] = useState<Record<string, string>>({})
  const [raceEventsError, setRaceEventsError] = useState('')
  const [linkingRaceEventId, setLinkingRaceEventId] = useState<string | null>(null)
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

  const resetRaceEventForm = useCallback(() => {
    setEditingRaceEventId(null)
    setRaceEventName('')
    setRaceEventDate('')
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
    const normalizedLinkedRunId = selectedLinkedRunId.trim() || null

    if (!normalizedRaceDate) {
      setRaceEventsError('Укажите дату старта')
      return
    }

    setSubmittingRaceEvent(true)
    setRaceEventsError('')

    try {
      const mutation = editingRaceEventId
        ? await updateRaceEvent(editingRaceEventId, {
          name: normalizedName,
          raceDate: normalizedRaceDate,
          linkedRunId: normalizedLinkedRunId,
        })
        : await createRaceEvent({
          name: normalizedName,
          raceDate: normalizedRaceDate,
          linkedRunId: normalizedLinkedRunId,
        })

      if (mutation.error || !mutation.data) {
        setRaceEventsError(editingRaceEventId ? 'Не удалось обновить старт' : 'Не удалось создать старт')
        return
      }

      await mutateRaceEvents((currentRaceEvents) => {
        const previousRaceEvents = currentRaceEvents ?? []

        if (editingRaceEventId) {
          return previousRaceEvents.map((raceEvent) => (
            raceEvent.id === mutation.data!.id ? mutation.data! : raceEvent
          ))
        }

        return [mutation.data!, ...previousRaceEvents]
      }, { revalidate: false })

      resetRaceEventForm()
    } catch {
      setRaceEventsError(editingRaceEventId ? 'Не удалось обновить старт' : 'Не удалось создать старт')
    } finally {
      setSubmittingRaceEvent(false)
    }
  }, [editingRaceEventId, mutateRaceEvents, raceEventDate, raceEventName, resetRaceEventForm, selectedLinkedRunId, submittingRaceEvent])

  const handleStartEditingRaceEvent = useCallback((raceEvent: RaceEvent) => {
    setEditingRaceEventId(raceEvent.id)
    setRaceEventName(raceEvent.name)
    setRaceEventDate(raceEvent.race_date)
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

      await mutateRaceEvents((currentRaceEvents) => (
        (currentRaceEvents ?? []).map((currentRaceEvent) => (
          currentRaceEvent.id === mutation.data!.id ? mutation.data! : currentRaceEvent
        ))
      ), { revalidate: false })
    } catch {
      setRaceEventsError('Не удалось привязать тренировку')
    } finally {
      setLinkingRaceEventId(null)
    }
  }, [linkingRaceEventId, mutateRaceEvents, suggestedRunIdsByRaceEvent])

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
          <h2 className="app-text-primary text-lg font-semibold">Новый старт</h2>
          <p className="app-text-secondary text-sm">
            Создавайте отдельные старты и при необходимости прикрепляйте к ним тренировку.
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

      <section className="mt-5 rounded-2xl">
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
                    <div key={raceEvent.id} className="rounded-2xl border px-4 py-3">
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
                          {raceEvent.linked_run_id && getRaceEventLinkedRunLabel(raceEvent) ? (
                            <p className="app-text-secondary mt-1 text-xs">
                              {getRaceEventLinkedRunLabel(raceEvent)}
                            </p>
                          ) : null}
                          {!raceEvent.linked_run_id && getCandidateRunsForRaceDate(raceEvent.race_date, runs ?? []).length > 0 ? (
                            <div className="mt-3 rounded-2xl border border-amber-300/60 bg-amber-50/70 px-3 py-3 dark:border-amber-300/20 dark:bg-amber-300/10">
                              <p className="app-text-primary text-sm font-medium">Похоже, это был забег — привязать?</p>
                              {getCandidateRunsForRaceDate(raceEvent.race_date, runs ?? []).length > 1 ? (
                                <select
                                  value={suggestedRunIdsByRaceEvent[raceEvent.id] ?? ''}
                                  onChange={(event) => setSuggestedRunIdsByRaceEvent((currentValue) => ({
                                    ...currentValue,
                                    [raceEvent.id]: event.target.value,
                                  }))}
                                  className="app-input mt-3 min-h-11 w-full rounded-lg border px-3 py-2"
                                >
                                  {getCandidateRunsForRaceDate(raceEvent.race_date, runs ?? []).map((run) => (
                                    <option key={run.id} value={run.id}>
                                      {getCandidateRunLabel(run)}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <p className="app-text-secondary mt-1 text-sm">
                                  {getCandidateRunLabel(getCandidateRunsForRaceDate(raceEvent.race_date, runs ?? [])[0])}
                                </p>
                              )}
                              <button
                                type="button"
                                onClick={() => void handleConfirmSuggestedLink(raceEvent)}
                                disabled={linkingRaceEventId === raceEvent.id}
                                className="app-button-secondary mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {linkingRaceEventId === raceEvent.id ? 'Привязываем...' : 'Привязать тренировку'}
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => handleStartEditingRaceEvent(raceEvent)}
                            className="app-button-secondary inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border px-3 py-2"
                            aria-label="Редактировать старт"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDeleteRaceEvent(raceEvent)}
                            disabled={deletingRaceEventId === raceEvent.id}
                            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-red-500/20 px-3 py-2 text-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label="Удалить старт"
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                          </button>
                        </div>
                      </div>
                    </div>
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
                    <div key={raceEvent.id} className="rounded-2xl border px-4 py-3">
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
                          {raceEvent.linked_run_id && getRaceEventLinkedRunLabel(raceEvent) ? (
                            <p className="app-text-secondary mt-1 text-xs">
                              {getRaceEventLinkedRunLabel(raceEvent)}
                            </p>
                          ) : null}
                          {!raceEvent.linked_run_id && getCandidateRunsForRaceDate(raceEvent.race_date, runs ?? []).length > 0 ? (
                            <div className="mt-3 rounded-2xl border border-amber-300/60 bg-amber-50/70 px-3 py-3 dark:border-amber-300/20 dark:bg-amber-300/10">
                              <p className="app-text-primary text-sm font-medium">Похоже, это был забег — привязать?</p>
                              {getCandidateRunsForRaceDate(raceEvent.race_date, runs ?? []).length > 1 ? (
                                <select
                                  value={suggestedRunIdsByRaceEvent[raceEvent.id] ?? ''}
                                  onChange={(event) => setSuggestedRunIdsByRaceEvent((currentValue) => ({
                                    ...currentValue,
                                    [raceEvent.id]: event.target.value,
                                  }))}
                                  className="app-input mt-3 min-h-11 w-full rounded-lg border px-3 py-2"
                                >
                                  {getCandidateRunsForRaceDate(raceEvent.race_date, runs ?? []).map((run) => (
                                    <option key={run.id} value={run.id}>
                                      {getCandidateRunLabel(run)}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <p className="app-text-secondary mt-1 text-sm">
                                  {getCandidateRunLabel(getCandidateRunsForRaceDate(raceEvent.race_date, runs ?? [])[0])}
                                </p>
                              )}
                              <button
                                type="button"
                                onClick={() => void handleConfirmSuggestedLink(raceEvent)}
                                disabled={linkingRaceEventId === raceEvent.id}
                                className="app-button-secondary mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {linkingRaceEventId === raceEvent.id ? 'Привязываем...' : 'Привязать тренировку'}
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => handleStartEditingRaceEvent(raceEvent)}
                            className="app-button-secondary inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border px-3 py-2"
                            aria-label="Редактировать старт"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDeleteRaceEvent(raceEvent)}
                            disabled={deletingRaceEventId === raceEvent.id}
                            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-red-500/20 px-3 py-2 text-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label="Удалить старт"
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                          </button>
                        </div>
                      </div>
                    </div>
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
