import { createAppEvent } from '@/lib/events/createAppEvent'
import { buildRaceEventCompletedEvent } from '@/lib/events/returnTriggerEvents'

export type RaceEventCompletionRow = {
  id: string
  user_id: string
  name: string
  race_date: string
  distance_meters?: number | null
  result_time_seconds?: number | null
  target_time_seconds?: number | null
  linked_run?: {
    id: string
    name?: string | null
    title?: string | null
    distance_km?: number | null
    moving_time_seconds?: number | null
    created_at?: string | null
  } | Array<{
    id: string
    name?: string | null
    title?: string | null
    distance_km?: number | null
    moving_time_seconds?: number | null
    created_at?: string | null
  }> | null
}

export function getRaceEventCompletionLinkedRun(raceEvent: Pick<RaceEventCompletionRow, 'linked_run'>) {
  if (Array.isArray(raceEvent.linked_run)) {
    return raceEvent.linked_run[0] ?? null
  }

  return raceEvent.linked_run ?? null
}

export async function createRaceEventCompletedAppEvent(raceEvent: RaceEventCompletionRow) {
  const linkedRun = getRaceEventCompletionLinkedRun(raceEvent)

  await createAppEvent(
    buildRaceEventCompletedEvent({
      actorUserId: raceEvent.user_id,
      raceEventId: raceEvent.id,
      raceName: raceEvent.name,
      raceDate: raceEvent.race_date,
      distanceMeters: raceEvent.distance_meters,
      resultTimeSeconds: raceEvent.result_time_seconds,
      targetTimeSeconds: raceEvent.target_time_seconds,
      linkedRun: linkedRun ? {
        id: linkedRun.id,
        name: linkedRun.name,
        title: linkedRun.title,
        distanceKm: linkedRun.distance_km,
        movingTimeSeconds: linkedRun.moving_time_seconds,
        createdAt: linkedRun.created_at,
      } : null,
    })
  )
}
