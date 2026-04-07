import type { ShoeWearUiLabel, ShoeWearUiStatus } from './shoe-wear-ui'

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

export type ShoeCatalogVersion = {
  id: string
  version: string
  fullName: string
  imageUrl: string | null
  isCurrent: boolean
}

export type ShoeCatalogModel = {
  id: string
  slug: string
  name: string
  versions: ShoeCatalogVersion[]
}

export type ShoeCatalogBrand = {
  id: string
  slug: string
  name: string
  models: ShoeCatalogModel[]
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
  wearStatus: ShoeWearUiStatus
  wearStatusLabel: ShoeWearUiLabel
  photoUrl: string | null
  isActive: boolean
  shoeModelId: string | null
  shoeVersionId: string | null
  model: UserShoeModelInfo | null
  createdAt: string
}

export type CreateUserShoeInput = {
  shoeModelId?: string | null
  shoeVersionId?: string | null
  customName?: string | null
  nickname?: string | null
  currentDistanceMeters: number
  maxDistanceMeters?: number | null
  isActive?: boolean
}

export type UpdateUserShoeInput = {
  shoeModelId?: string | null
  shoeVersionId?: string | null
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

type LoadUserShoeSelectionOptions = {
  activeOnly?: boolean
  includeShoeId?: string | null
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

type ShoeCatalogResponse =
  | {
      ok: true
      catalog: ShoeCatalogBrand[]
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

export async function loadUserShoeSelectionData(
  options: LoadUserShoeSelectionOptions = {}
): Promise<UserShoeSelectionData> {
  const searchParams = new URLSearchParams()

  if (options.activeOnly) {
    searchParams.set('activeOnly', 'true')
  }

  if (typeof options.includeShoeId === 'string' && options.includeShoeId.trim().length > 0) {
    searchParams.set('includeShoeId', options.includeShoeId.trim())
  }

  const queryString = searchParams.toString()
  const response = await fetch(`/api/shoes${queryString ? `?${queryString}` : ''}`, {
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

export async function loadShoeCatalog(): Promise<ShoeCatalogBrand[]> {
  const response = await fetch('/api/shoes/models/catalog', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => null) as ShoeCatalogResponse | null

  if (!response.ok || !payload?.ok) {
    throw new Error(
      payload && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : 'Не удалось загрузить каталог кроссовок'
    )
  }

  return Array.isArray(payload.catalog) ? payload.catalog : []
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
