'use server'

import { redirect } from 'next/navigation'
import { writeAdminAuditEntry } from '@/lib/admin/audit'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type ChallengeAuditSnapshot = {
  title: string
  description: string | null
  visibility: string
  period_type: 'lifetime' | 'challenge' | 'weekly' | 'monthly'
  goal_unit: 'distance_km' | 'run_count'
  goal_target: number
  starts_at: string | null
  end_at: string | null
  badge_url: string | null
  badge_storage_path: string | null
  goal_km: number | null
  goal_runs: number | null
  xp_reward: number
}

type ChallengePeriodType = 'lifetime' | 'challenge' | 'weekly' | 'monthly'
type ChallengeGoalUnit = 'distance_km' | 'run_count'

function normalizeOptionalPositiveNumber(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  const numericValue = Number(trimmed)

  if (!Number.isFinite(numericValue)) {
    return null
  }

  return numericValue
}

function normalizeOptionalIsoDateTime(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  const parsed = new Date(trimmed)

  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toISOString()
}

function normalizePeriodType(value: FormDataEntryValue | null): ChallengePeriodType | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (
    trimmed === 'lifetime' ||
    trimmed === 'challenge' ||
    trimmed === 'weekly' ||
    trimmed === 'monthly'
  ) {
    return trimmed
  }

  return null
}

function normalizeGoalUnit(value: FormDataEntryValue | null): ChallengeGoalUnit | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (trimmed === 'distance_km' || trimmed === 'run_count') {
    return trimmed
  }

  return null
}

function buildLegacyGoalFields(input: {
  goalUnit: ChallengeGoalUnit
  goalTarget: number
}) {
  if (input.goalUnit === 'distance_km') {
    return {
      goal_km: input.goalTarget,
      goal_runs: null,
    }
  }

  return {
    goal_km: null,
    goal_runs: Math.round(input.goalTarget),
  }
}

function buildChallengeFormSearchParams(input: {
  error?: string
  title?: string
  description?: string
  visibility?: string
  periodType?: string
  goalUnit?: string
  goalTarget?: string
  xpReward?: string
  startsAt?: string
  endAt?: string
  badgeUrl?: string
  badgeStoragePath?: string
}) {
  const searchParams = new URLSearchParams()

  if (input.error) searchParams.set('error', input.error)
  if (input.title) searchParams.set('title', input.title)
  if (input.description) searchParams.set('description', input.description)
  if (input.visibility) searchParams.set('visibility', input.visibility)
  if (input.periodType) searchParams.set('period_type', input.periodType)
  if (input.goalUnit) searchParams.set('goal_unit', input.goalUnit)
  if (input.goalTarget) searchParams.set('goal_target', input.goalTarget)
  if (input.xpReward) searchParams.set('xp_reward', input.xpReward)
  if (input.startsAt) searchParams.set('starts_at', input.startsAt)
  if (input.endAt) searchParams.set('end_at', input.endAt)
  if (input.badgeUrl) searchParams.set('badge_url', input.badgeUrl)
  if (input.badgeStoragePath) searchParams.set('badge_storage_path', input.badgeStoragePath)

  return searchParams.toString()
}

function redirectToNewChallengeForm(input: {
  error: string
  title?: string
  description?: string
  visibility?: string
  periodType?: string
  goalUnit?: string
  goalTarget?: string
  xpReward?: string
  startsAt?: string
  endAt?: string
  badgeUrl?: string
  badgeStoragePath?: string
}) {
  const query = buildChallengeFormSearchParams(input)
  redirect(`/admin/challenges/new${query ? `?${query}` : ''}`)
}

function redirectToEditChallengeForm(
  challengeId: string,
  input?: {
    error?: string
    title?: string
    description?: string
    visibility?: string
    periodType?: string
    goalUnit?: string
    goalTarget?: string
    xpReward?: string
    startsAt?: string
    endAt?: string
    badgeUrl?: string
    badgeStoragePath?: string
  }
) {
  const basePath = `/admin/challenges/${encodeURIComponent(challengeId)}/edit`
  const query = buildChallengeFormSearchParams({
    error: input?.error,
    title: input?.title,
    description: input?.description,
    visibility: input?.visibility,
    periodType: input?.periodType,
    goalUnit: input?.goalUnit,
    goalTarget: input?.goalTarget,
    xpReward: input?.xpReward,
    startsAt: input?.startsAt,
    endAt: input?.endAt,
    badgeUrl: input?.badgeUrl,
    badgeStoragePath: input?.badgeStoragePath,
  })
  redirect(query ? `${basePath}?${query}` : basePath)
}

function redirectToChallengeAccessPage(challengeId: string, error?: string) {
  const basePath = `/admin/challenges/${encodeURIComponent(challengeId)}`
  redirect(error ? `${basePath}?error=${encodeURIComponent(error)}` : basePath)
}

export async function createChallengeAction(formData: FormData) {
  const { profile } = await requireAdmin()

  const titleValue = formData.get('title')
  const descriptionInput = formData.get('description')
  const visibilityInput = formData.get('visibility')
  const periodTypeInput = formData.get('period_type')
  const goalUnitInput = formData.get('goal_unit')
  const goalTargetInput = formData.get('goal_target')
  const xpRewardInput = formData.get('xp_reward')
  const startsAtInput = formData.get('starts_at')
  const endAtInput = formData.get('end_at')
  const badgeUrlInput = formData.get('badge_url')
  const badgeStoragePathInput = formData.get('badge_storage_path')

  const title = typeof titleValue === 'string' ? titleValue.trim() : ''
  const descriptionValue = typeof descriptionInput === 'string'
    ? descriptionInput.trim()
    : ''
  const visibilityValue = typeof visibilityInput === 'string'
    ? visibilityInput.trim()
    : ''
  const periodType = normalizePeriodType(periodTypeInput)
  const goalUnit = normalizeGoalUnit(goalUnitInput)
  const goalTarget = normalizeOptionalPositiveNumber(goalTargetInput)
  const xpRewardValue = typeof xpRewardInput === 'string'
    ? xpRewardInput.trim()
    : ''
  const startsAtValue = typeof startsAtInput === 'string' ? startsAtInput.trim() : ''
  const endAtValue = typeof endAtInput === 'string' ? endAtInput.trim() : ''
  const badgeUrl = typeof badgeUrlInput === 'string' ? badgeUrlInput.trim() : ''
  const badgeStoragePath = typeof badgeStoragePathInput === 'string' ? badgeStoragePathInput.trim() : ''
  const formValues = {
    title,
    description: descriptionValue,
    visibility: visibilityValue || 'public',
    periodType: typeof periodTypeInput === 'string' ? periodTypeInput.trim() : '',
    goalUnit: typeof goalUnitInput === 'string' ? goalUnitInput.trim() : '',
    goalTarget: typeof goalTargetInput === 'string' ? goalTargetInput.trim() : '',
    xpReward: xpRewardValue,
    startsAt: startsAtValue,
    endAt: endAtValue,
    badgeUrl,
    badgeStoragePath,
  }

  if (!title) {
    redirectToNewChallengeForm({
      error: 'Укажите название челленджа.',
      ...formValues,
    })
  }

  if (visibilityValue !== 'public' && visibilityValue !== 'restricted') {
    redirectToNewChallengeForm({
      error: 'Выберите корректную видимость челленджа.',
      ...formValues,
    })
  }

  if (!periodType) {
    redirectToNewChallengeForm({
      error: 'Выберите тип челленджа.',
      ...formValues,
    })
  }

  if (!goalUnit) {
    redirectToNewChallengeForm({
      error: 'Выберите тип цели.',
      ...formValues,
    })
  }

  if ((goalTarget ?? 0) <= 0) {
    redirectToNewChallengeForm({
      error: 'Укажите цель больше 0.',
      ...formValues,
    })
  }

  const xpRewardNumber = xpRewardValue ? Number(xpRewardValue) : 0

  if (!Number.isFinite(xpRewardNumber) || xpRewardNumber < 0) {
    redirectToNewChallengeForm({
      error: 'XP reward должен быть неотрицательным числом.',
      ...formValues,
    })
  }

  const normalizedStartsAt = normalizeOptionalIsoDateTime(startsAtInput)
  const normalizedEndAt = normalizeOptionalIsoDateTime(endAtInput)

  if (periodType === 'challenge') {
    if (!normalizedStartsAt || !normalizedEndAt) {
      redirectToNewChallengeForm({
        error: 'Для челленджа с расписанием укажите дату начала и окончания.',
        ...formValues,
      })
    }

    if (new Date(normalizedStartsAt).getTime() >= new Date(normalizedEndAt).getTime()) {
      redirectToNewChallengeForm({
        error: 'Дата начала должна быть раньше даты окончания.',
        ...formValues,
      })
    }
  }

  if (!badgeUrl || !badgeStoragePath) {
    redirectToNewChallengeForm({
      error: 'Загрузите бейдж челленджа перед сохранением.',
      ...formValues,
    })
  }

  const xpReward = Math.max(0, Math.round(xpRewardNumber))
  const normalizedGoalTarget = goalUnit === 'run_count'
    ? Math.round(goalTarget ?? 0)
    : Number(goalTarget ?? 0)
  const legacyGoalFields = buildLegacyGoalFields({
    goalUnit,
    goalTarget: normalizedGoalTarget,
  })
  const description = descriptionValue.length > 0 ? descriptionValue : null
  const auditSnapshot: ChallengeAuditSnapshot = {
    title,
    description,
    visibility: visibilityValue,
    period_type: periodType,
    goal_unit: goalUnit,
    goal_target: normalizedGoalTarget,
    starts_at: periodType === 'challenge' ? normalizedStartsAt : null,
    end_at: periodType === 'challenge' ? normalizedEndAt : null,
    badge_url: badgeUrl,
    badge_storage_path: badgeStoragePath,
    goal_km: legacyGoalFields.goal_km,
    goal_runs: legacyGoalFields.goal_runs,
    xp_reward: xpReward,
  }
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('challenges')
    .insert({
      title,
      description,
      visibility: visibilityValue,
      period_type: periodType,
      goal_unit: goalUnit,
      goal_target: normalizedGoalTarget,
      starts_at: periodType === 'challenge' ? normalizedStartsAt : null,
      end_at: periodType === 'challenge' ? normalizedEndAt : null,
      badge_url: badgeUrl,
      badge_storage_path: badgeStoragePath,
      goal_km: legacyGoalFields.goal_km,
      goal_runs: legacyGoalFields.goal_runs,
      xp_reward: xpReward,
    })
    .select('id, visibility')
    .single()

  if (error) {
    throw error
  }

  await writeAdminAuditEntry({
    actorUserId: profile.id,
    action: 'challenge.create',
    entityType: 'challenge',
    entityId: data.id,
    payloadBefore: {},
    payloadAfter: auditSnapshot,
  })

  if (data.visibility === 'restricted') {
    redirectToChallengeAccessPage(data.id)
  }

  redirect('/admin/challenges')
}

export async function updateChallengeAction(formData: FormData) {
  const { profile } = await requireAdmin()

  const challengeIdValue = formData.get('challenge_id')
  const titleValue = formData.get('title')
  const descriptionInput = formData.get('description')
  const visibilityInput = formData.get('visibility')
  const periodTypeInput = formData.get('period_type')
  const goalUnitInput = formData.get('goal_unit')
  const goalTargetInput = formData.get('goal_target')
  const xpRewardInput = formData.get('xp_reward')
  const startsAtInput = formData.get('starts_at')
  const endAtInput = formData.get('end_at')
  const badgeUrlInput = formData.get('badge_url')
  const badgeStoragePathInput = formData.get('badge_storage_path')

  const challengeId = typeof challengeIdValue === 'string' ? challengeIdValue.trim() : ''
  const title = typeof titleValue === 'string' ? titleValue.trim() : ''
  const descriptionValue = typeof descriptionInput === 'string'
    ? descriptionInput.trim()
    : ''
  const visibilityValue = typeof visibilityInput === 'string'
    ? visibilityInput.trim()
    : ''
  const periodType = normalizePeriodType(periodTypeInput)
  const goalUnit = normalizeGoalUnit(goalUnitInput)
  const goalTarget = normalizeOptionalPositiveNumber(goalTargetInput)
  const xpRewardValue = typeof xpRewardInput === 'string'
    ? xpRewardInput.trim()
    : ''
  const startsAtValue = typeof startsAtInput === 'string' ? startsAtInput.trim() : ''
  const endAtValue = typeof endAtInput === 'string' ? endAtInput.trim() : ''
  const badgeUrl = typeof badgeUrlInput === 'string' ? badgeUrlInput.trim() : ''
  const badgeStoragePath = typeof badgeStoragePathInput === 'string' ? badgeStoragePathInput.trim() : ''
  const formValues = {
    title,
    description: descriptionValue,
    visibility: visibilityValue || 'public',
    periodType: typeof periodTypeInput === 'string' ? periodTypeInput.trim() : '',
    goalUnit: typeof goalUnitInput === 'string' ? goalUnitInput.trim() : '',
    goalTarget: typeof goalTargetInput === 'string' ? goalTargetInput.trim() : '',
    xpReward: xpRewardValue,
    startsAt: startsAtValue,
    endAt: endAtValue,
    badgeUrl,
    badgeStoragePath,
  }

  if (!challengeId) {
    redirect('/admin/challenges')
  }

  if (!title) {
    redirectToEditChallengeForm(challengeId, {
      error: 'Укажите название челленджа.',
      ...formValues,
    })
  }

  if (visibilityValue !== 'public' && visibilityValue !== 'restricted') {
    redirectToEditChallengeForm(challengeId, {
      error: 'Выберите корректную видимость челленджа.',
      ...formValues,
    })
  }

  if (!periodType) {
    redirectToEditChallengeForm(challengeId, {
      error: 'Выберите тип челленджа.',
      ...formValues,
    })
  }

  if (!goalUnit) {
    redirectToEditChallengeForm(challengeId, {
      error: 'Выберите тип цели.',
      ...formValues,
    })
  }

  if ((goalTarget ?? 0) <= 0) {
    redirectToEditChallengeForm(challengeId, {
      error: 'Укажите цель больше 0.',
      ...formValues,
    })
  }

  const xpRewardNumber = xpRewardValue ? Number(xpRewardValue) : 0

  if (!Number.isFinite(xpRewardNumber) || xpRewardNumber < 0) {
    redirectToEditChallengeForm(challengeId, {
      error: 'Награда XP должна быть неотрицательным числом.',
      ...formValues,
    })
  }

  const normalizedStartsAt = normalizeOptionalIsoDateTime(startsAtInput)
  const normalizedEndAt = normalizeOptionalIsoDateTime(endAtInput)

  if (periodType === 'challenge') {
    if (!normalizedStartsAt || !normalizedEndAt) {
      redirectToEditChallengeForm(challengeId, {
        error: 'Для челленджа с расписанием укажите дату начала и окончания.',
        ...formValues,
      })
    }

    if (new Date(normalizedStartsAt).getTime() >= new Date(normalizedEndAt).getTime()) {
      redirectToEditChallengeForm(challengeId, {
        error: 'Дата начала должна быть раньше даты окончания.',
        ...formValues,
      })
    }
  }

  if (!badgeUrl || !badgeStoragePath) {
    redirectToEditChallengeForm(challengeId, {
      error: 'Загрузите бейдж челленджа перед сохранением.',
      ...formValues,
    })
  }

  const xpReward = Math.max(0, Math.round(xpRewardNumber))
  const normalizedGoalTarget = goalUnit === 'run_count'
    ? Math.round(goalTarget ?? 0)
    : Number(goalTarget ?? 0)
  const legacyGoalFields = buildLegacyGoalFields({
    goalUnit,
    goalTarget: normalizedGoalTarget,
  })
  const description = descriptionValue.length > 0 ? descriptionValue : null
  const supabase = createSupabaseAdminClient()
  const { data: existingChallenge, error: existingChallengeError } = await supabase
    .from('challenges')
    .select('title, description, visibility, period_type, goal_unit, goal_target, starts_at, end_at, badge_url, badge_storage_path, goal_km, goal_runs, xp_reward')
    .eq('id', challengeId)
    .maybeSingle()

  if (existingChallengeError) {
    console.error('[admin-challenges] failed to load previous challenge state', {
      actorUserId: profile.id,
      challengeId,
      code: existingChallengeError.code ?? null,
      message: existingChallengeError.message,
      details: existingChallengeError.details ?? null,
    })
  }

  const nextChallengeSnapshot: ChallengeAuditSnapshot = {
    title,
    description,
    visibility: visibilityValue,
    period_type: periodType,
    goal_unit: goalUnit,
    goal_target: normalizedGoalTarget,
    starts_at: periodType === 'challenge' ? normalizedStartsAt : null,
    end_at: periodType === 'challenge' ? normalizedEndAt : null,
    badge_url: badgeUrl,
    badge_storage_path: badgeStoragePath,
    goal_km: legacyGoalFields.goal_km,
    goal_runs: legacyGoalFields.goal_runs,
    xp_reward: xpReward,
  }

  const { error } = await supabase
    .from('challenges')
    .update({
      title,
      description,
      visibility: visibilityValue,
      period_type: periodType,
      goal_unit: goalUnit,
      goal_target: normalizedGoalTarget,
      starts_at: periodType === 'challenge' ? normalizedStartsAt : null,
      end_at: periodType === 'challenge' ? normalizedEndAt : null,
      badge_url: badgeUrl,
      badge_storage_path: badgeStoragePath,
      goal_km: legacyGoalFields.goal_km,
      goal_runs: legacyGoalFields.goal_runs,
      xp_reward: xpReward,
    })
    .eq('id', challengeId)

  if (error) {
    throw error
  }

  await writeAdminAuditEntry({
    actorUserId: profile.id,
    action: 'challenge.update',
    entityType: 'challenge',
    entityId: challengeId,
    payloadBefore: existingChallenge
      ? {
          title: existingChallenge.title,
          description: existingChallenge.description,
          visibility: existingChallenge.visibility,
          period_type: existingChallenge.period_type,
          goal_unit: existingChallenge.goal_unit,
          goal_target: existingChallenge.goal_target,
          starts_at: existingChallenge.starts_at,
          end_at: existingChallenge.end_at,
          badge_url: existingChallenge.badge_url,
          badge_storage_path: existingChallenge.badge_storage_path,
          goal_km: existingChallenge.goal_km,
          goal_runs: existingChallenge.goal_runs,
          xp_reward: existingChallenge.xp_reward,
        }
      : {},
    payloadAfter: nextChallengeSnapshot,
  })

  redirectToChallengeAccessPage(challengeId)
}

export async function grantChallengeAccessAction(formData: FormData) {
  const { profile } = await requireAdmin()

  const challengeIdValue = formData.get('challenge_id')
  const userIdValue = formData.get('user_id')
  const challengeId = typeof challengeIdValue === 'string' ? challengeIdValue.trim() : ''
  const userId = typeof userIdValue === 'string' ? userIdValue.trim() : ''

  if (!challengeId) {
    redirect('/admin/challenges')
  }

  if (!userId) {
    redirectToChallengeAccessPage(challengeId, 'Укажите ID пользователя.')
  }

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('challenge_access_users')
    .upsert(
      {
        challenge_id: challengeId,
        user_id: userId,
        granted_by: profile.id,
      },
      {
        onConflict: 'challenge_id,user_id',
        ignoreDuplicates: true,
      }
    )

  if (error) {
    throw error
  }

  await writeAdminAuditEntry({
    actorUserId: profile.id,
    action: 'challenge_access.grant',
    entityType: 'challenge_access',
    entityId: challengeId,
    payloadBefore: {
      challenge_id: challengeId,
      user_id: userId,
      has_access: false,
    },
    payloadAfter: {
      challenge_id: challengeId,
      user_id: userId,
      has_access: true,
    },
  })

  redirectToChallengeAccessPage(challengeId)
}

export async function revokeChallengeAccessAction(formData: FormData) {
  const { profile } = await requireAdmin()

  const challengeIdValue = formData.get('challenge_id')
  const userIdValue = formData.get('user_id')
  const challengeId = typeof challengeIdValue === 'string' ? challengeIdValue.trim() : ''
  const userId = typeof userIdValue === 'string' ? userIdValue.trim() : ''

  if (!challengeId) {
    redirect('/admin/challenges')
  }

  if (!userId) {
    redirectToChallengeAccessPage(challengeId)
  }

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('challenge_access_users')
    .delete()
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)

  if (error) {
    throw error
  }

  await writeAdminAuditEntry({
    actorUserId: profile.id,
    action: 'challenge_access.revoke',
    entityType: 'challenge_access',
    entityId: challengeId,
    payloadBefore: {
      challenge_id: challengeId,
      user_id: userId,
      has_access: true,
    },
    payloadAfter: {
      challenge_id: challengeId,
      user_id: userId,
      has_access: false,
    },
  })

  redirectToChallengeAccessPage(challengeId)
}
