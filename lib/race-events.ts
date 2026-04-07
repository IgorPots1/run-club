export type RaceEventLinkedRunSummary = {
  id: string
  name: string | null
  title?: string | null
  distance_km?: number | null
  moving_time_seconds?: number | null
  created_at: string
}

export type RaceEvent = {
  id: string
  user_id: string
  name: string
  race_date: string
  linked_run_id: string | null
  distance_meters?: number | null
  result_time_seconds?: number | null
  target_time_seconds?: number | null
  created_at: string
  linked_run?: RaceEventLinkedRunSummary | null
}

const PERSONAL_RECORD_DISTANCE_TOLERANCE = 0.02

export function formatRaceDateLabel(dateValue: string) {
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

export function formatClock(totalSeconds: number | null | undefined) {
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

export function parseClockInput(value: string) {
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

export function maskClockInput(value: string) {
  const digitsOnly = value.replace(/\D/g, '').slice(0, 6)

  if (!digitsOnly) {
    return ''
  }

  if (digitsOnly.length <= 2) {
    return digitsOnly
  }

  if (digitsOnly.length <= 4) {
    return `${digitsOnly.slice(0, 2)}:${digitsOnly.slice(2)}`
  }

  return `${digitsOnly.slice(0, 2)}:${digitsOnly.slice(2, 4)}:${digitsOnly.slice(4)}`
}

export function getRaceEventLinkedRun(raceEvent: Pick<RaceEvent, 'linked_run'>) {
  const linkedRun = raceEvent.linked_run

  if (Array.isArray(linkedRun)) {
    return (linkedRun[0] ?? null) as RaceEventLinkedRunSummary | null
  }

  return (linkedRun ?? null) as RaceEventLinkedRunSummary | null
}

export function getRaceEventDisplayTimeSeconds(raceEvent: Pick<RaceEvent, 'linked_run' | 'result_time_seconds'>) {
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

export function getRaceEventDisplayDistanceLabel(raceEvent: Pick<RaceEvent, 'linked_run' | 'distance_meters'>) {
  const linkedRun = getRaceEventLinkedRun(raceEvent)

  if (Number.isFinite(linkedRun?.distance_km) && (linkedRun?.distance_km ?? 0) > 0) {
    return {
      label: `${Number(linkedRun?.distance_km ?? 0).toFixed(2).replace(/\.?0+$/, '')} км`,
      source: 'linked_run' as const,
    }
  }

  if (Number.isFinite(raceEvent.distance_meters) && (raceEvent.distance_meters ?? 0) > 0) {
    const distanceKm = Number(raceEvent.distance_meters ?? 0) / 1000
    return {
      label: `${distanceKm.toFixed(2).replace(/\.?0+$/, '')} км`,
      source: 'manual' as const,
    }
  }

  return null
}

export function isRaceEventUpcoming(raceEvent: Pick<RaceEvent, 'race_date' | 'linked_run_id'>) {
  const today = new Date().toISOString().slice(0, 10)

  if (raceEvent.race_date > today) {
    return true
  }

  return !raceEvent.linked_run_id
}

function isRaceEventEligibleForPersonalRecord(raceEvent: Pick<RaceEvent, 'distance_meters' | 'result_time_seconds'>) {
  return (
    Number.isFinite(raceEvent.distance_meters) &&
    (raceEvent.distance_meters ?? 0) > 0 &&
    Number.isFinite(raceEvent.result_time_seconds) &&
    (raceEvent.result_time_seconds ?? 0) >= 0
  )
}

function isWithinDistanceTolerance(distanceMeters: number, referenceDistanceMeters: number) {
  if (distanceMeters <= 0 || referenceDistanceMeters <= 0) {
    return false
  }

  return Math.abs(distanceMeters - referenceDistanceMeters) <= (referenceDistanceMeters * PERSONAL_RECORD_DISTANCE_TOLERANCE)
}

export function getPersonalRecordRaceEventIds(raceEvents: RaceEvent[]) {
  const eligibleRaceEvents = raceEvents
    .filter(isRaceEventEligibleForPersonalRecord)
    .sort((left, right) => {
      const distanceDiff = Number(left.distance_meters ?? 0) - Number(right.distance_meters ?? 0)

      if (distanceDiff !== 0) {
        return distanceDiff
      }

      const dateDiff = left.race_date.localeCompare(right.race_date)

      if (dateDiff !== 0) {
        return dateDiff
      }

      return left.created_at.localeCompare(right.created_at)
    })

  const groupedRaceEvents: Array<{
    raceEvents: RaceEvent[]
    totalDistanceMeters: number
  }> = []

  for (const raceEvent of eligibleRaceEvents) {
    const distanceMeters = Number(raceEvent.distance_meters ?? 0)
    const lastGroup = groupedRaceEvents[groupedRaceEvents.length - 1]
    const groupReferenceDistanceMeters = lastGroup
      ? lastGroup.totalDistanceMeters / lastGroup.raceEvents.length
      : null

    if (
      lastGroup &&
      groupReferenceDistanceMeters != null &&
      isWithinDistanceTolerance(distanceMeters, groupReferenceDistanceMeters)
    ) {
      lastGroup.raceEvents.push(raceEvent)
      lastGroup.totalDistanceMeters += distanceMeters
      continue
    }

    groupedRaceEvents.push({
      raceEvents: [raceEvent],
      totalDistanceMeters: distanceMeters,
    })
  }

  const personalRecordRaceEventIds = new Set<string>()

  for (const group of groupedRaceEvents) {
    const bestTimeSeconds = Math.min(...group.raceEvents.map((raceEvent) => Number(raceEvent.result_time_seconds ?? 0)))

    for (const raceEvent of group.raceEvents) {
      if (Number(raceEvent.result_time_seconds ?? 0) === bestTimeSeconds) {
        personalRecordRaceEventIds.add(raceEvent.id)
      }
    }
  }

  return personalRecordRaceEventIds
}

export type RaceEventMutationInput = {
  name: string
  raceDate: string
  linkedRunId?: string | null
  distanceMeters?: number | null
  resultTimeSeconds?: number | null
  targetTimeSeconds?: number | null
}

type RaceEventsResponse =
  | {
      ok: true
      raceEvents: RaceEvent[]
    }

type RaceEventResponse =
  | {
      ok: true
      raceEvent: RaceEvent
    }
  | {
      ok: false
      error?: string
    }
  | {
      ok: false
      error?: string
    }

type RaceEventMutationResponse =
  | {
      ok: true
      raceEvent: RaceEvent
    }
  | {
      ok: false
      error?: string
    }

export async function loadRaceEvents() {
  const response = await fetch('/api/race-events', {
    method: 'GET',
    cache: 'no-store',
    credentials: 'include',
  })

  const payload = await response.json().catch(() => null) as RaceEventsResponse | null

  if (!response.ok || !payload?.ok) {
    throw new Error(
      payload && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : 'race_events_load_failed'
    )
  }

  return Array.isArray(payload.raceEvents) ? payload.raceEvents : []
}

export async function loadRaceEvent(raceEventId: string) {
  const response = await fetch(`/api/race-events/${raceEventId}`, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'include',
  })

  const payload = await response.json().catch(() => null) as RaceEventResponse | null

  if (!response.ok || !payload?.ok || !payload.raceEvent) {
    throw new Error(
      payload && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : 'race_event_load_failed'
    )
  }

  return payload.raceEvent
}

async function submitRaceEvent(
  path: string,
  method: 'POST' | 'PATCH',
  input: RaceEventMutationInput
) {
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(input),
  })

  const payload = await response.json().catch(() => null) as RaceEventMutationResponse | null

  if (!response.ok || !payload?.ok) {
    return {
      error: new Error(
        payload && 'error' in payload && typeof payload.error === 'string'
          ? payload.error
          : 'race_event_mutation_failed'
      ),
      data: null,
    }
  }

  return {
    error: null,
    data: payload.raceEvent,
  }
}

export function createRaceEvent(input: RaceEventMutationInput) {
  return submitRaceEvent('/api/race-events', 'POST', input)
}

export function updateRaceEvent(raceEventId: string, input: RaceEventMutationInput) {
  return submitRaceEvent(`/api/race-events/${raceEventId}`, 'PATCH', input)
}

export async function deleteRaceEvent(raceEventId: string) {
  const response = await fetch(`/api/race-events/${raceEventId}`, {
    method: 'DELETE',
    credentials: 'include',
  })

  const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null

  if (!response.ok || !payload?.ok) {
    return {
      error: new Error(
        payload && typeof payload.error === 'string'
          ? payload.error
          : 'race_event_delete_failed'
      ),
    }
  }

  return {
    error: null,
  }
}
