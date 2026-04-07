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

export default function RacesManager({ userId }: RacesManagerProps) {
  const [pendingDeleteRaceEvent, setPendingDeleteRaceEvent] = useState<RaceEvent | null>(null)
  const [submittingRaceEvent, setSubmittingRaceEvent] = useState(false)
  const [deletingRaceEventId, setDeletingRaceEventId] = useState<string | null>(null)
  const [editingRaceEventId, setEditingRaceEventId] = useState<string | null>(null)
  const [raceEventName, setRaceEventName] = useState('')
  const [raceEventDate, setRaceEventDate] = useState('')
  const [selectedLinkedRunId, setSelectedLinkedRunId] = useState('')
  const [raceEventsError, setRaceEventsError] = useState('')
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
      label: `${formatRunTimestampLabel(run.created_at, run.external_source)} • ${getRunDisplayName(run)} • ${formatDistanceKmLabel(run)} км`,
    }))
  ), [runs])
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

  const resetRaceEventForm = useCallback(() => {
    setEditingRaceEventId(null)
    setRaceEventName('')
    setRaceEventDate('')
    setSelectedLinkedRunId('')
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
    setRaceEventsError('')
  }, [])

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
