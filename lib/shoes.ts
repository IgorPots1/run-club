import 'server-only'

import { createSupabaseServerClient } from './supabase-server'

type ShoeModelDbRow = {
  id: string
  brand: string | null
  model: string | null
  version: string | null
  full_name: string | null
  image_url: string | null
  category: string | null
  is_popular: boolean | null
}

type UserShoeDbRow = {
  id: string
  user_id: string
  shoe_model_id: string | null
  custom_name: string | null
  nickname: string | null
  current_distance_meters: number | string | null
  max_distance_meters: number | string | null
  photo_url: string | null
  is_active: boolean | null
  created_at: string
}

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

export type UserShoeInput = {
  shoeModelId?: string | null
  customName?: string | null
  nickname?: string | null
  currentDistanceMeters: number
  maxDistanceMeters?: number | null
  photoUrl?: string | null
  isActive: boolean
}

type NormalizedUserShoeInput = {
  shoeModelId: string | null
  customName: string | null
  nickname: string | null
  currentDistanceMeters: number
  maxDistanceMeters: number
  photoUrl: string | null
  isActive: boolean
}

const SHOE_MODEL_SELECT =
  'id, brand, model, version, full_name, image_url, category, is_popular'
export const DEFAULT_MAX_DISTANCE_METERS = 800000

function toNullableTrimmedText(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

function toSafeNonNegativeInteger(value: number | string | null | undefined) {
  const numericValue = typeof value === 'string' ? Number(value) : value

  if (!Number.isFinite(numericValue)) {
    return 0
  }

  return Math.max(0, Math.trunc(Number(numericValue)))
}

export function normalizeMaxDistanceMeters(value: number | string | null | undefined) {
  const numericValue = typeof value === 'string' ? Number(value) : value

  if (!Number.isFinite(numericValue) || Number(numericValue) <= 0) {
    return DEFAULT_MAX_DISTANCE_METERS
  }

  return Math.trunc(Number(numericValue))
}

function normalizeSearchQuery(query: string) {
  return query.trim().replace(/\s+/g, ' ')
}

function buildSearchPattern(query: string) {
  return `%${query}%`
}

function getWearStatus(usagePercent: number) {
  if (usagePercent < 50) {
    return {
      wearStatus: 'fresh' as const,
      wearStatusLabel: 'Свежие' as const,
    }
  }

  if (usagePercent < 80) {
    return {
      wearStatus: 'ok' as const,
      wearStatusLabel: 'Рабочие' as const,
    }
  }

  if (usagePercent < 100) {
    return {
      wearStatus: 'warning' as const,
      wearStatusLabel: 'На исходе' as const,
    }
  }

  return {
    wearStatus: 'replace' as const,
    wearStatusLabel: 'Под замену' as const,
  }
}

export function getUserShoeUsageMetrics(input: {
  currentDistanceMeters: number
  maxDistanceMeters: number
}) {
  const safeMaxDistanceMeters = Math.max(1, toSafeNonNegativeInteger(input.maxDistanceMeters))
  const safeCurrentDistanceMeters = toSafeNonNegativeInteger(input.currentDistanceMeters)
  const usagePercent = (safeCurrentDistanceMeters / safeMaxDistanceMeters) * 100
  const remainingDistanceMeters = safeMaxDistanceMeters - safeCurrentDistanceMeters
  const wearStatus = getWearStatus(usagePercent)

  return {
    maxDistanceMeters: safeMaxDistanceMeters,
    usagePercent,
    remainingDistanceMeters,
    wearStatus: wearStatus.wearStatus,
    wearStatusLabel: wearStatus.wearStatusLabel,
  }
}

export function getWearThresholdCrossing(params: {
  previousUsagePercent: number
  nextUsagePercent: number
}) {
  const { previousUsagePercent, nextUsagePercent } = params

  if (previousUsagePercent < 100 && nextUsagePercent >= 100) {
    return {
      threshold: 'replace' as const,
      message: 'Эта пара уже под замену',
    }
  }

  if (previousUsagePercent < 80 && nextUsagePercent >= 80) {
    return {
      threshold: 'warning' as const,
      message: 'Эта пара уже на исходе',
    }
  }

  return null
}

function mapShoeModel(row: ShoeModelDbRow): ShoeModel {
  return {
    id: row.id,
    brand: row.brand?.trim() || '',
    model: row.model?.trim() || '',
    version: toNullableTrimmedText(row.version),
    fullName: row.full_name?.trim() || '',
    imageUrl: toNullableTrimmedText(row.image_url),
    category: toNullableTrimmedText(row.category),
    isPopular: Boolean(row.is_popular),
  }
}

function toUserShoeModelInfo(model: ShoeModel): UserShoeModelInfo {
  return {
    id: model.id,
    brand: model.brand,
    model: model.model,
    version: model.version,
    fullName: model.fullName,
    imageUrl: model.imageUrl,
    category: model.category,
  }
}

function getShoeModelSearchScore(model: ShoeModel, query: string) {
  const normalizedQuery = query.toLocaleLowerCase()
  const fullName = model.fullName.toLocaleLowerCase()
  const brand = model.brand.toLocaleLowerCase()
  const modelName = model.model.toLocaleLowerCase()
  let score = model.isPopular ? 10 : 0

  if (fullName === normalizedQuery) {
    score += 1000
  } else if (fullName.startsWith(normalizedQuery)) {
    score += 750
  } else if (fullName.includes(normalizedQuery)) {
    score += 500
  }

  if (brand === normalizedQuery) {
    score += 300
  } else if (brand.startsWith(normalizedQuery)) {
    score += 225
  } else if (brand.includes(normalizedQuery)) {
    score += 150
  }

  if (modelName === normalizedQuery) {
    score += 300
  } else if (modelName.startsWith(normalizedQuery)) {
    score += 225
  } else if (modelName.includes(normalizedQuery)) {
    score += 150
  }

  return score
}

function compareShoeModelsForSearch(left: ShoeModel, right: ShoeModel, query: string) {
  const scoreDiff = getShoeModelSearchScore(right, query) - getShoeModelSearchScore(left, query)

  if (scoreDiff !== 0) {
    return scoreDiff
  }

  if (left.isPopular !== right.isPopular) {
    return Number(right.isPopular) - Number(left.isPopular)
  }

  return left.fullName.localeCompare(right.fullName)
}

function mapUserShoe(row: UserShoeDbRow, shoeModelById: Record<string, ShoeModel>): UserShoeRecord {
  const model = row.shoe_model_id ? shoeModelById[row.shoe_model_id] ?? null : null
  const customName = toNullableTrimmedText(row.custom_name)
  const currentDistanceMeters = toSafeNonNegativeInteger(row.current_distance_meters)
  const maxDistanceMeters = normalizeMaxDistanceMeters(row.max_distance_meters)
  const usageMetrics = getUserShoeUsageMetrics({
    currentDistanceMeters,
    maxDistanceMeters,
  })

  return {
    id: row.id,
    displayName: model?.fullName ?? customName ?? 'Кроссовки',
    customName,
    nickname: toNullableTrimmedText(row.nickname),
    currentDistanceMeters,
    maxDistanceMeters: usageMetrics.maxDistanceMeters,
    usagePercent: usageMetrics.usagePercent,
    remainingDistanceMeters: usageMetrics.remainingDistanceMeters,
    wearStatus: usageMetrics.wearStatus,
    wearStatusLabel: usageMetrics.wearStatusLabel,
    photoUrl: toNullableTrimmedText(row.photo_url),
    isActive: Boolean(row.is_active),
    shoeModelId: row.shoe_model_id,
    model: model ? toUserShoeModelInfo(model) : null,
    createdAt: row.created_at,
  }
}

function normalizeUserShoeInput(input: UserShoeInput): NormalizedUserShoeInput {
  const shoeModelId = toNullableTrimmedText(input.shoeModelId)
  const customName = toNullableTrimmedText(input.customName)
  const nickname = toNullableTrimmedText(input.nickname)
  const photoUrl = toNullableTrimmedText(input.photoUrl)
  const currentDistanceMeters = Number(input.currentDistanceMeters)
  const maxDistanceMeters =
    input.maxDistanceMeters == null
      ? DEFAULT_MAX_DISTANCE_METERS
      : Number(input.maxDistanceMeters)

  if (!shoeModelId && !customName) {
    throw new Error('shoe_model_id_or_custom_name_required')
  }

  if (!Number.isFinite(currentDistanceMeters) || currentDistanceMeters < 0) {
    throw new Error('current_distance_meters_must_be_non_negative')
  }

  if (!Number.isFinite(maxDistanceMeters) || maxDistanceMeters <= 0) {
    throw new Error('max_distance_meters_must_be_positive')
  }

  if (typeof input.isActive !== 'boolean') {
    throw new Error('is_active_must_be_boolean')
  }

  return {
    shoeModelId,
    customName,
    nickname,
    currentDistanceMeters: Math.trunc(currentDistanceMeters),
    maxDistanceMeters: Math.trunc(maxDistanceMeters),
    photoUrl,
    isActive: input.isActive,
  }
}

async function loadShoeModelsByIds(shoeModelIds: string[]) {
  if (shoeModelIds.length === 0) {
    return {} as Record<string, ShoeModel>
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('shoe_models')
    .select(SHOE_MODEL_SELECT)
    .in('id', Array.from(new Set(shoeModelIds)))

  if (error) {
    throw new Error('Не удалось загрузить модели кроссовок')
  }

  return Object.fromEntries(
    ((data as ShoeModelDbRow[] | null) ?? []).map((row) => {
      const model = mapShoeModel(row)
      return [model.id, model] as const
    })
  ) as Record<string, ShoeModel>
}

export async function listPopularShoeModels(): Promise<ShoeModel[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('shoe_models')
    .select(SHOE_MODEL_SELECT)
    .eq('is_popular', true)
    .order('full_name', { ascending: true })

  if (error) {
    throw new Error('Не удалось загрузить популярные модели кроссовок')
  }

  return ((data as ShoeModelDbRow[] | null) ?? []).map(mapShoeModel)
}

export async function searchShoeModels(query: string): Promise<ShoeModel[]> {
  const normalizedQuery = normalizeSearchQuery(query)

  if (!normalizedQuery) {
    return listPopularShoeModels()
  }

  const supabase = await createSupabaseServerClient()
  const searchPattern = buildSearchPattern(normalizedQuery)
  const [fullNameResult, brandResult, modelResult] = await Promise.all([
    supabase
      .from('shoe_models')
      .select(SHOE_MODEL_SELECT)
      .ilike('full_name', searchPattern)
      .order('is_popular', { ascending: false })
      .order('full_name', { ascending: true })
      .limit(20),
    supabase
      .from('shoe_models')
      .select(SHOE_MODEL_SELECT)
      .ilike('brand', searchPattern)
      .order('is_popular', { ascending: false })
      .order('full_name', { ascending: true })
      .limit(20),
    supabase
      .from('shoe_models')
      .select(SHOE_MODEL_SELECT)
      .ilike('model', searchPattern)
      .order('is_popular', { ascending: false })
      .order('full_name', { ascending: true })
      .limit(20),
  ])

  if (fullNameResult.error || brandResult.error || modelResult.error) {
    throw new Error('Не удалось выполнить поиск моделей кроссовок')
  }

  const modelsById = new Map<string, ShoeModel>()

  for (const row of [
    ...((fullNameResult.data as ShoeModelDbRow[] | null) ?? []),
    ...((brandResult.data as ShoeModelDbRow[] | null) ?? []),
    ...((modelResult.data as ShoeModelDbRow[] | null) ?? []),
  ]) {
    if (!modelsById.has(row.id)) {
      modelsById.set(row.id, mapShoeModel(row))
    }
  }

  return Array.from(modelsById.values())
    .sort((left, right) => compareShoeModelsForSearch(left, right, normalizedQuery))
    .slice(0, 20)
}

export async function listUserShoes(userId: string): Promise<UserShoeRecord[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('user_shoes')
    .select(
      'id, user_id, shoe_model_id, custom_name, nickname, current_distance_meters, max_distance_meters, photo_url, is_active, created_at'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error('Не удалось загрузить кроссовки пользователя')
  }

  const rows = (data as UserShoeDbRow[] | null) ?? []
  const shoeModelById = await loadShoeModelsByIds(
    rows
      .map((row) => row.shoe_model_id)
      .filter((shoeModelId): shoeModelId is string => typeof shoeModelId === 'string' && shoeModelId.length > 0)
  )

  return rows.map((row) => mapUserShoe(row, shoeModelById))
}

export async function getUserShoeById(userId: string, shoeId: string): Promise<UserShoeRecord | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('user_shoes')
    .select(
      'id, user_id, shoe_model_id, custom_name, nickname, current_distance_meters, max_distance_meters, photo_url, is_active, created_at'
    )
    .eq('user_id', userId)
    .eq('id', shoeId)
    .maybeSingle()

  if (error) {
    throw new Error('Не удалось загрузить кроссовки пользователя')
  }

  const row = (data as UserShoeDbRow | null) ?? null

  if (!row) {
    return null
  }

  const shoeModelById = await loadShoeModelsByIds(
    row.shoe_model_id ? [row.shoe_model_id] : []
  )

  return mapUserShoe(row, shoeModelById)
}

export async function createUserShoe(userId: string, input: UserShoeInput): Promise<UserShoeRecord> {
  const normalizedInput = normalizeUserShoeInput(input)
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('user_shoes')
    .insert({
      user_id: userId,
      shoe_model_id: normalizedInput.shoeModelId,
      custom_name: normalizedInput.customName,
      nickname: normalizedInput.nickname,
      current_distance_meters: normalizedInput.currentDistanceMeters,
      max_distance_meters: normalizedInput.maxDistanceMeters,
      photo_url: normalizedInput.photoUrl,
      is_active: normalizedInput.isActive,
    })
    .select('id')
    .single()

  if (error) {
    throw new Error('Не удалось создать кроссовки пользователя')
  }

  const createdShoe = await getUserShoeById(userId, (data as { id: string }).id)

  if (!createdShoe) {
    throw new Error('Не удалось загрузить созданные кроссовки пользователя')
  }

  return createdShoe
}

export async function updateUserShoe(
  userId: string,
  shoeId: string,
  input: UserShoeInput
): Promise<UserShoeRecord | null> {
  const normalizedInput = normalizeUserShoeInput(input)
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('user_shoes')
    .update({
      shoe_model_id: normalizedInput.shoeModelId,
      custom_name: normalizedInput.customName,
      nickname: normalizedInput.nickname,
      current_distance_meters: normalizedInput.currentDistanceMeters,
      max_distance_meters: normalizedInput.maxDistanceMeters,
      photo_url: normalizedInput.photoUrl,
      is_active: normalizedInput.isActive,
    })
    .eq('user_id', userId)
    .eq('id', shoeId)
    .select('id')
    .maybeSingle()

  if (error) {
    throw new Error('Не удалось обновить кроссовки пользователя')
  }

  const updatedRow = (data as { id: string } | null) ?? null

  if (!updatedRow) {
    return null
  }

  return getUserShoeById(userId, updatedRow.id)
}

export async function deleteUserShoe(userId: string, shoeId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('user_shoes')
    .delete()
    .eq('user_id', userId)
    .eq('id', shoeId)
    .select('id')
    .maybeSingle()

  if (error) {
    throw new Error('Не удалось удалить кроссовки пользователя')
  }

  return Boolean(data)
}
