export type ShoeModel = {
  id: string
  brand: string
  model: string
  version: string | null
  fullName: string
  imageUrl: string | null
  category: string | null
  isPopular: boolean
}

export type UserShoeModelInfo = {
  id: string
  brand: string
  model: string
  version: string | null
  fullName: string
  imageUrl: string | null
  category: string | null
}

export type UserShoeRecord = {
  id: string
  displayName: string
  customName: string | null
  nickname: string | null
  currentDistanceMeters: number
  maxDistanceMeters: number
  usagePercent: number
  remainingDistanceMeters: number
  wearStatus: 'fresh' | 'ok' | 'warning' | 'replace'
  wearStatusLabel: 'Свежие' | 'Рабочие' | 'На исходе' | 'Под замену'
  photoUrl: string | null
  isActive: boolean
  shoeModelId: string | null
  model: UserShoeModelInfo | null
  createdAt: string
}

export type CreateUserShoeInput = {
  shoeModelId?: string | null
  customName?: string | null
  nickname?: string | null
  currentDistanceMeters: number
  maxDistanceMeters?: number | null
  isActive?: boolean
}

export type UpdateUserShoeInput = {
  shoeModelId?: string | null
  customName?: string | null
  nickname?: string | null
  currentDistanceMeters: number
  maxDistanceMeters?: number | null
  isActive?: boolean
}

export type UserShoeSelectionData = {
  shoes: UserShoeRecord[]
  mostRecentlyUsedShoeId: string | null
}

type ListUserShoesResponse =
  | {
      ok: true
      shoes: UserShoeRecord[]
      mostRecentlyUsedShoeId?: string | null
    }
  | {
      ok: false
      error?: string
    }

type SearchShoeModelsResponse =
  | {
      ok: true
      models: ShoeModel[]
    }
  | {
      ok: false
      error?: string
    }

type CreateUserShoeResponse =
  | {
      ok: true
      shoe: UserShoeRecord
    }
  | {
      ok: false
      error?: string
    }

type UpdateUserShoeResponse = CreateUserShoeResponse

export async function loadUserShoes(): Promise<UserShoeRecord[]> {
  const selectionData = await loadUserShoeSelectionData()
  return selectionData.shoes
}

export async function loadUserShoeSelectionData(): Promise<UserShoeSelectionData> {
  const response = await fetch('/api/shoes', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => null) as ListUserShoesResponse | null

  if (!response.ok || !payload?.ok) {
    throw new Error(
      payload && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : 'Не удалось загрузить кроссовки'
    )
  }

  return {
    shoes: Array.isArray(payload.shoes) ? payload.shoes : [],
    mostRecentlyUsedShoeId:
      typeof payload.mostRecentlyUsedShoeId === 'string' && payload.mostRecentlyUsedShoeId.trim().length > 0
        ? payload.mostRecentlyUsedShoeId
        : null,
  }
}

export async function searchShoeModels(query: string): Promise<ShoeModel[]> {
  const searchParams = new URLSearchParams()

  if (query.trim()) {
    searchParams.set('q', query)
  }

  const response = await fetch(`/api/shoes/models?${searchParams.toString()}`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => null) as SearchShoeModelsResponse | null

  if (!response.ok || !payload?.ok) {
    throw new Error(
      payload && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : 'Не удалось загрузить модели кроссовок'
    )
  }

  return Array.isArray(payload.models) ? payload.models : []
}

export async function createUserShoe(input: CreateUserShoeInput): Promise<UserShoeRecord> {
  const response = await fetch('/api/shoes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(input),
  })

  const payload = await response.json().catch(() => null) as CreateUserShoeResponse | null

  if (!response.ok || !payload?.ok || !payload.shoe) {
    throw new Error(
      payload && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : 'Не удалось сохранить кроссовки'
    )
  }

  return payload.shoe
}

export async function updateUserShoe(shoeId: string, input: UpdateUserShoeInput): Promise<UserShoeRecord> {
  const response = await fetch(`/api/shoes/${shoeId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(input),
  })

  const payload = await response.json().catch(() => null) as UpdateUserShoeResponse | null

  if (!response.ok || !payload?.ok || !payload.shoe) {
    throw new Error(
      payload && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : 'Не удалось обновить кроссовки'
    )
  }

  return payload.shoe
}
