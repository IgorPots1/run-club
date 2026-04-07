'use client'

import { ArrowUpRight, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import ConfirmActionSheet from '@/components/ConfirmActionSheet'
import RaceEventFormSheet from '@/components/RaceEventFormSheet'
import { loadActivityRuns, type ActivityRunRow } from '@/lib/activity'
import { formatDistanceKm, formatRunTimestampLabel } from '@/lib/format'
import {
  createRaceEvent,
  deleteRaceEvent,
  formatClock,
  formatRaceDateLabel,
  getRaceEventDisplayDistanceLabel,
  getRaceEventDisplayTimeSeconds,
  getRaceEventLinkedRun,
  getPersonalRecordRaceEventIds,
  isRaceEventUpcoming,
  loadRaceEvents,
  maskClockInput,
  parseClockInput,
  updateRaceEvent,
  type RaceEvent,
} from '@/lib/race-events'

type RacesManagerProps = {
  userId: string
}

type RaceEventCardProps = {
  raceEvent: RaceEvent
  isPersonalRecord: boolean
  candidateRuns: ActivityRunRow[]
  selectedSuggestedRunId: string
  isMenuOpen: boolean
  isLinking: boolean
  isUnlinking: boolean
  onMenuToggle: (raceEventId: string) => void
  onOpen: (raceEvent: RaceEvent) => void
  onEdit: (raceEvent: RaceEvent) => void
  onDelete: (raceEvent: RaceEvent) => void
  onConfirmSuggestedLink: (raceEvent: RaceEvent) => void
  onSelectSuggestedRun: (raceEventId: string, runId: string) => void
  onUnlink: (raceEvent: RaceEvent) => void
}

const DEFAULT_WORKOUT_NAME = 'Бег'
const DEFAULT_RACE_EVENT_NAME = 'Новый старт'
const ONE_DAY_MS = 24 * 60 * 60 * 1000

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

function formatManualDistanceKm(distanceMeters: number | null | undefined) {
  if (!Number.isFinite(distanceMeters) || (distanceMeters ?? 0) <= 0) {
    return null
  }

  const distanceKm = Number(distanceMeters ?? 0) / 1000
  return `${distanceKm.toFixed(2).replace(/\.?0+$/, '')} km`
}

function parseDistanceKmInput(rawValue: string) {
  const normalizedValue = rawValue.trim().replace(',', '.')

  if (!normalizedValue) {
    return { value: null, isValid: true }
  }

  if (!/^\d+(\.\d{0,2})?$/.test(normalizedValue)) {
    return { value: null, isValid: false }
  }

  const parsedValue = Number(normalizedValue)

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return { value: null, isValid: false }
  }

  return {
    value: Math.round(parsedValue * 1000),
    isValid: true,
  }
}

function RaceEventCard({
  raceEvent,
  isPersonalRecord,
  candidateRuns,
  selectedSuggestedRunId,
  isMenuOpen,
  isLinking,
  isUnlinking,
  onMenuToggle,
  onOpen,
  onEdit,
  onDelete,
  onConfirmSuggestedLink,
  onSelectSuggestedRun,
  onUnlink,
}: RaceEventCardProps) {
  const linkedRunLabel = getRaceEventLinkedRunLabel(raceEvent)
  const displayDistance = getRaceEventDisplayDistanceLabel(raceEvent)
  const displayTime = getRaceEventDisplayTimeSeconds(raceEvent)
  const displayTimeLabel = formatClock(displayTime?.seconds)
  const targetTimeLabel = formatClock(raceEvent.target_time_seconds)
  const isUpcoming = isRaceEventUpcoming(raceEvent)
  const statusLabel = raceEvent.linked_run_id ? 'Тренировка привязана' : 'Без привязанной тренировки'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(event) => {
        const target = event.target as HTMLElement | null

        if (target?.closest('button, a, input, select, textarea, option')) {
          return
        }

        onOpen(raceEvent)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return
        }

        event.preventDefault()
        onOpen(raceEvent)
      }}
      className="app-card cursor-pointer rounded-2xl border p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="app-text-primary break-words text-base font-semibold">{raceEvent.name}</p>
            {isPersonalRecord ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-black">
                PR
              </span>
            ) : null}
          </div>
          <p className="app-text-secondary mt-1 break-words text-sm">
            {formatRaceDateLabel(raceEvent.race_date)}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {isUpcoming ? (
              <>
                <span className="app-text-secondary break-words">{statusLabel}</span>
                {displayDistance ? <span className="app-text-secondary">•</span> : null}
                {displayDistance ? (
                  <span className="app-text-primary break-words">
                    {displayDistance.label}
                    {displayDistance.source === 'linked_run' ? ' • из тренировки' : ''}
                  </span>
                ) : null}
                {(displayDistance || targetTimeLabel) ? <span className="app-text-secondary">•</span> : null}
                <span className={`${targetTimeLabel ? 'app-text-primary font-medium' : 'app-text-secondary'} break-words`}>
                  {targetTimeLabel ? `Цель: ${targetTimeLabel}` : 'Цель не задана'}
                </span>
              </>
            ) : (
              <>
                <span className="app-text-primary break-words font-semibold">
                  {displayTimeLabel ? `Результат: ${displayTimeLabel}` : 'Результат не указан'}
                </span>
                {displayDistance ? <span className="app-text-secondary">•</span> : null}
                {displayDistance ? (
                  <span className="app-text-secondary break-words">
                    {displayDistance.label}
                    {displayDistance.source === 'linked_run' ? ' • из тренировки' : ''}
                  </span>
                ) : null}
              </>
            )}
          </div>
          {raceEvent.linked_run_id && linkedRunLabel ? (
            <div className="mt-2">
              <p className="app-text-secondary break-words text-xs">
                {linkedRunLabel}
              </p>
              <Link
                href={`/runs/${raceEvent.linked_run_id}`}
                className="app-text-secondary mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg px-1 py-2 text-sm font-medium hover:text-[var(--text-primary)] sm:w-auto sm:justify-start"
              >
                <span>Открыть тренировку</span>
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
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
                className="app-button-secondary mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
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
  const router = useRouter()
  const [pendingDeleteRaceEvent, setPendingDeleteRaceEvent] = useState<RaceEvent | null>(null)
  const [submittingRaceEvent, setSubmittingRaceEvent] = useState(false)
  const [deletingRaceEventId, setDeletingRaceEventId] = useState<string | null>(null)
  const [editingRaceEventId, setEditingRaceEventId] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [openRaceEventMenuId, setOpenRaceEventMenuId] = useState<string | null>(null)
  const [raceEventName, setRaceEventName] = useState('')
  const [raceEventDate, setRaceEventDate] = useState('')
  const [distanceInput, setDistanceInput] = useState('')
  const [resultTimeInput, setResultTimeInput] = useState('')
  const [targetTimeInput, setTargetTimeInput] = useState('')
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
  const personalRecordRaceEventIds = useMemo(
    () => getPersonalRecordRaceEventIds(raceEvents ?? []),
    [raceEvents]
  )
  const deletingActiveRaceEvent = pendingDeleteRaceEvent ? deletingRaceEventId === pendingDeleteRaceEvent.id : false
  const totalRaceEventsCount = (raceEvents ?? []).length

  const handleDistanceInputChange = useCallback((nextValue: string) => {
    const normalizedValue = nextValue.replace(',', '.')

    if (!/^\d*([.]\d{0,2})?$/.test(normalizedValue)) {
      return
    }

    setDistanceInput(normalizedValue)
  }, [])

  const handleResultTimeInputChange = useCallback((nextValue: string) => {
    setResultTimeInput(maskClockInput(nextValue))
  }, [])

  const handleTargetTimeInputChange = useCallback((nextValue: string) => {
    setTargetTimeInput(maskClockInput(nextValue))
  }, [])

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
    setIsFormOpen(false)
    setOpenRaceEventMenuId(null)
    setRaceEventName('')
    setRaceEventDate('')
    setDistanceInput('')
    setResultTimeInput('')
    setTargetTimeInput('')
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
    const normalizedDistance = parseDistanceKmInput(distanceInput)
    const normalizedResultTime = parseClockInput(resultTimeInput)
    const normalizedTargetTime = parseClockInput(targetTimeInput)
    const normalizedLinkedRunId = selectedLinkedRunId.trim() || null

    if (!normalizedRaceDate) {
      setRaceEventsError('Укажите дату старта')
      return
    }

    if (!normalizedDistance.isValid) {
      setRaceEventsError('Укажите дистанцию в километрах, например 5, 10, 21.1')
      return
    }

    if (!normalizedResultTime.isValid) {
      setRaceEventsError('Укажите время в формате чч:мм:сс')
      return
    }

    if (!normalizedTargetTime.isValid) {
      setRaceEventsError('Укажите целевое время в формате чч:мм:сс')
      return
    }

    setSubmittingRaceEvent(true)
    setRaceEventsError('')

    try {
      const mutation = editingRaceEventId
        ? await updateRaceEvent(editingRaceEventId, {
          name: normalizedName,
          raceDate: normalizedRaceDate,
          distanceMeters: normalizedDistance.value,
          resultTimeSeconds: normalizedResultTime.value,
          targetTimeSeconds: normalizedTargetTime.value,
          linkedRunId: normalizedLinkedRunId,
        })
        : await createRaceEvent({
          name: normalizedName,
          raceDate: normalizedRaceDate,
          distanceMeters: normalizedDistance.value,
          resultTimeSeconds: normalizedResultTime.value,
          targetTimeSeconds: normalizedTargetTime.value,
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
  }, [distanceInput, editingRaceEventId, raceEventDate, raceEventName, resetRaceEventForm, resultTimeInput, selectedLinkedRunId, submittingRaceEvent, targetTimeInput, upsertRaceEvent])

  const handleStartEditingRaceEvent = useCallback((raceEvent: RaceEvent) => {
    setOpenRaceEventMenuId(null)
    setIsFormOpen(true)
    setEditingRaceEventId(raceEvent.id)
    setRaceEventName(raceEvent.name)
    setRaceEventDate(raceEvent.race_date)
    setDistanceInput(formatManualDistanceKm(raceEvent.distance_meters)?.replace(' km', '') ?? '')
    setResultTimeInput(formatClock(raceEvent.result_time_seconds) ?? '')
    setTargetTimeInput(formatClock(raceEvent.target_time_seconds) ?? '')
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
      <section className="space-y-5">
        <div className="app-surface-muted rounded-2xl border px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="app-text-primary text-sm font-medium">Мои старты</p>
              <p className="app-text-secondary mt-1 text-xs">
                {totalRaceEventsCount} всего • {upcomingRaceEvents.length} предстоящих • {pastRaceEvents.length} прошедших
              </p>
            </div>
            <p className="app-text-secondary min-w-0 break-words text-sm">{totalRaceEventsCount} стартов</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="app-text-primary text-lg font-semibold">Старты</h2>
            <p className="app-text-secondary mt-1 text-sm">
              Календарь будущих стартов, результаты и связь с тренировками.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              resetRaceEventForm()
              setIsFormOpen(true)
            }}
            className="app-button-primary inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium sm:w-auto sm:shrink-0"
          >
            <Plus className="h-4 w-4" />
            Добавить старт
          </button>
        </div>

        {raceEventsError ? <p className="text-sm text-red-600">{raceEventsError}</p> : null}

        <section ref={menuContainerRef} className="rounded-2xl">
          {isRaceEventsLoading && !raceEvents ? (
            <div className="app-card rounded-2xl border px-4 py-5 shadow-sm">
              <p className="app-text-secondary text-sm">Загружаем старты...</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="app-text-primary text-base font-semibold">Предстоящие</h3>
                  <p className="app-text-secondary text-sm">{upcomingRaceEvents.length}</p>
                </div>
                {upcomingRaceEvents.length === 0 ? (
                  <div className="app-card rounded-2xl border border-dashed p-4 shadow-sm">
                    <p className="app-text-secondary text-sm">Нет предстоящих стартов.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {upcomingRaceEvents.map((raceEvent) => (
                      <RaceEventCard
                        key={raceEvent.id}
                        raceEvent={raceEvent}
                        isPersonalRecord={personalRecordRaceEventIds.has(raceEvent.id)}
                        candidateRuns={getCandidateRunsForRaceDate(raceEvent.race_date, runs ?? [])}
                        selectedSuggestedRunId={suggestedRunIdsByRaceEvent[raceEvent.id] ?? ''}
                        isMenuOpen={openRaceEventMenuId === raceEvent.id}
                        isLinking={linkingRaceEventId === raceEvent.id}
                        isUnlinking={unlinkingRaceEventId === raceEvent.id}
                        onOpen={(nextRaceEvent) => {
                          router.push(`/races/${nextRaceEvent.id}`)
                        }}
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

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="app-text-primary text-base font-semibold">Прошедшие</h3>
                  <p className="app-text-secondary text-sm">{pastRaceEvents.length}</p>
                </div>
                {pastRaceEvents.length === 0 ? (
                  <div className="app-card rounded-2xl border border-dashed p-4 shadow-sm">
                    <p className="app-text-secondary text-sm">Нет прошедших стартов.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pastRaceEvents.map((raceEvent) => (
                      <RaceEventCard
                        key={raceEvent.id}
                        raceEvent={raceEvent}
                        isPersonalRecord={personalRecordRaceEventIds.has(raceEvent.id)}
                        candidateRuns={getCandidateRunsForRaceDate(raceEvent.race_date, runs ?? [])}
                        selectedSuggestedRunId={suggestedRunIdsByRaceEvent[raceEvent.id] ?? ''}
                        isMenuOpen={openRaceEventMenuId === raceEvent.id}
                        isLinking={linkingRaceEventId === raceEvent.id}
                        isUnlinking={unlinkingRaceEventId === raceEvent.id}
                        onOpen={(nextRaceEvent) => {
                          router.push(`/races/${nextRaceEvent.id}`)
                        }}
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
      </section>

      <RaceEventFormSheet
        open={isFormOpen}
        editing={Boolean(editingRaceEventId)}
        submitting={submittingRaceEvent}
        raceEventName={raceEventName}
        raceEventDate={raceEventDate}
        distanceInput={distanceInput}
        resultTimeInput={resultTimeInput}
        targetTimeInput={targetTimeInput}
        selectedLinkedRunId={selectedLinkedRunId}
        workoutOptions={workoutOptions}
        formCandidateRuns={formCandidateRuns}
        formSuggestedRunId={formSuggestedRunId}
        formError={raceEventsError}
        getCandidateRunLabel={getCandidateRunLabel}
        onClose={resetRaceEventForm}
        onSubmit={handleSubmitRaceEvent}
        onRaceEventNameChange={setRaceEventName}
        onRaceEventDateChange={setRaceEventDate}
        onDistanceInputChange={handleDistanceInputChange}
        onResultTimeInputChange={handleResultTimeInputChange}
        onTargetTimeInputChange={handleTargetTimeInputChange}
        onSelectedLinkedRunIdChange={setSelectedLinkedRunId}
        onFormSuggestedRunIdChange={setFormSuggestedRunId}
      />

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
