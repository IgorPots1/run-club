import type { XpBreakdownItem } from './xp'

export type CreateRunInput = {
  name: string
  title: string
  distanceKm: number
  distanceMeters: number
  durationMinutes: number
  durationSeconds: number
  movingTimeSeconds: number
  elapsedTimeSeconds: number
  averagePaceSeconds: number
  createdAt: string
  shoeId?: string | null
  type?: 'training' | 'race'
  raceName?: string | null
  raceDate?: string | null
}

export type UpdateRunInput = {
  name?: string | null
  description?: string | null
  nameManuallyEdited?: boolean
  descriptionManuallyEdited?: boolean
  shoeId?: string | null
  type?: 'training' | 'race'
  raceName?: string | null
  raceDate?: string | null
}

type RunMutationResponse =
  | {
      ok: true
      run?: Record<string, unknown> | null
      shoeWearMessage?: string | null
      xpGained?: number
      breakdown?: XpBreakdownItem[]
      levelUp?: boolean
      newLevel?: number | null
    }
  | {
      ok: false
      error?: string
    }

export async function createRun(input: CreateRunInput) {
  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(input),
  })

  const payload = await response.json().catch(() => null) as RunMutationResponse | null

  if (!response.ok || !payload?.ok) {
    return {
      error: new Error(
        payload && 'error' in payload && typeof payload.error === 'string'
          ? payload.error
          : 'run_create_failed'
      ),
      xpGained: 0,
      breakdown: [],
    }
  }

  return {
    error: null,
    data: payload.run ?? null,
    shoeWearMessage: payload.shoeWearMessage ?? null,
    xpGained: typeof payload.xpGained === 'number' ? payload.xpGained : 0,
    breakdown: Array.isArray(payload.breakdown) ? payload.breakdown : [],
    levelUp: payload.levelUp === true,
    newLevel: typeof payload.newLevel === 'number' ? payload.newLevel : null,
  }
}

export async function updateRun(runId: string, input: UpdateRunInput) {
  const response = await fetch(`/api/runs/${runId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(input),
  })

  const payload = await response.json().catch(() => null) as RunMutationResponse | null

  if (!response.ok || !payload?.ok) {
    return {
      error: new Error(
        payload && 'error' in payload && typeof payload.error === 'string'
          ? payload.error
          : 'run_update_failed'
      ),
    }
  }

  return {
    error: null,
    data: payload.run ?? null,
    shoeWearMessage: payload.shoeWearMessage ?? null,
  }
}

export async function deleteRun(runId: string) {
  const response = await fetch(`/api/runs/${runId}`, {
    method: 'DELETE',
    credentials: 'include',
  })

  const payload = await response.json().catch(() => null) as RunMutationResponse | null

  if (!response.ok || !payload?.ok) {
    return {
      error: new Error(
        payload && 'error' in payload && typeof payload.error === 'string'
          ? payload.error
          : 'run_delete_failed'
      ),
    }
  }

  return {
    error: null,
  }
}
