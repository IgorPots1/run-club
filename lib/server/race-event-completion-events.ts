import { createAppEvent } from '@/lib/events/createAppEvent'
import {
  normalizeAppEventChannel,
  normalizeAppEventPriority,
  normalizeAppEventTargetPath,
} from '@/lib/events/appEventRouting'
import { buildRaceEventCompletedEvent } from '@/lib/events/returnTriggerEvents'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

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

type RaceEventCompletedAppEventOptions = {
  createIfMissing?: boolean
}

export function getRaceEventCompletionLinkedRun(raceEvent: Pick<RaceEventCompletionRow, 'linked_run'>) {
  if (Array.isArray(raceEvent.linked_run)) {
    return raceEvent.linked_run[0] ?? null
  }

  return raceEvent.linked_run ?? null
}

function buildRaceEventCompletedAppEventInput(raceEvent: RaceEventCompletionRow) {
  const linkedRun = getRaceEventCompletionLinkedRun(raceEvent)

  return buildRaceEventCompletedEvent({
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
}

function toRaceEventCompletedAppEventUpdate(
  input: ReturnType<typeof buildRaceEventCompletedAppEventInput>
) {
  const payloadTargetPath = normalizeAppEventTargetPath(
    typeof input.payload?.targetPath === 'string' ? input.payload.targetPath : null
  )

  return {
    actor_user_id: input.actorUserId ?? null,
    target_user_id: input.targetUserId ?? null,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    category: input.category?.trim() || null,
    channel: input.channel ? normalizeAppEventChannel(input.channel) : null,
    priority: input.priority ? normalizeAppEventPriority(input.priority) : null,
    target_path: normalizeAppEventTargetPath(input.targetPath) ?? payloadTargetPath,
    payload: input.payload ?? {},
  }
}

export async function createRaceEventCompletedAppEvent(
  raceEvent: RaceEventCompletionRow,
  options: RaceEventCompletedAppEventOptions = {}
) {
  const input = buildRaceEventCompletedAppEventInput(raceEvent)
  const dedupeKey = input.dedupeKey?.trim() || null

  if (!dedupeKey) {
    throw new Error('race_event_completed_dedupe_key_required')
  }

  const supabase = createSupabaseAdminClient()
  const { data: existingEvent, error: loadError } = await supabase
    .from('app_events')
    .select('id')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle()

  if (loadError) {
    throw loadError
  }

  if (!existingEvent) {
    if (options.createIfMissing === false) {
      return
    }

    await createAppEvent(input)
    return
  }

  const { error: updateError } = await supabase
    .from('app_events')
    .update(toRaceEventCompletedAppEventUpdate(input))
    .eq('id', existingEvent.id)

  if (updateError) {
    throw updateError
  }
}
