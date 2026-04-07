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
  created_at: string
  linked_run?: RaceEventLinkedRunSummary | null
}

export function isRaceEventUpcoming(raceEvent: Pick<RaceEvent, 'race_date' | 'linked_run_id'>) {
  const today = new Date().toISOString().slice(0, 10)

  if (raceEvent.race_date > today) {
    return true
  }

  return !raceEvent.linked_run_id
}

export type RaceEventMutationInput = {
  name: string
  raceDate: string
  linkedRunId?: string | null
  distanceMeters?: number | null
  resultTimeSeconds?: number | null
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
