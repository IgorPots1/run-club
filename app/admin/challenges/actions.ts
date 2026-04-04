'use server'

import { redirect } from 'next/navigation'
import { writeAdminAuditEntry } from '@/lib/admin/audit'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type ChallengeAuditSnapshot = {
  title: string
  description: string | null
  visibility: string
  goal_km: number | null
  goal_runs: number | null
  xp_reward: number
}

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

function buildChallengeFormSearchParams(input: {
  error?: string
  title?: string
  description?: string
  visibility?: string
  goalKm?: string
  goalRuns?: string
  xpReward?: string
}) {
  const searchParams = new URLSearchParams()

  if (input.error) searchParams.set('error', input.error)
  if (input.title) searchParams.set('title', input.title)
  if (input.description) searchParams.set('description', input.description)
  if (input.visibility) searchParams.set('visibility', input.visibility)
  if (input.goalKm) searchParams.set('goal_km', input.goalKm)
  if (input.goalRuns) searchParams.set('goal_runs', input.goalRuns)
  if (input.xpReward) searchParams.set('xp_reward', input.xpReward)

  return searchParams.toString()
}

function redirectToNewChallengeForm(input: {
  error: string
  title?: string
  description?: string
  visibility?: string
  goalKm?: string
  goalRuns?: string
  xpReward?: string
}) {
  const query = buildChallengeFormSearchParams(input)
  redirect(`/admin/challenges/new${query ? `?${query}` : ''}`)
}

function redirectToEditChallengeForm(challengeId: string, error?: string) {
  const basePath = `/admin/challenges/${encodeURIComponent(challengeId)}/edit`
  redirect(error ? `${basePath}?error=${encodeURIComponent(error)}` : basePath)
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
  const goalKmValue = formData.get('goal_km')
  const goalRunsValue = formData.get('goal_runs')
  const xpRewardInput = formData.get('xp_reward')

  const title = typeof titleValue === 'string' ? titleValue.trim() : ''
  const descriptionValue = typeof descriptionInput === 'string'
    ? descriptionInput.trim()
    : ''
  const visibilityValue = typeof visibilityInput === 'string'
    ? visibilityInput.trim()
    : ''
  const goalKm = normalizeOptionalPositiveNumber(goalKmValue)
  const goalRuns = normalizeOptionalPositiveNumber(goalRunsValue)
  const xpRewardValue = typeof xpRewardInput === 'string'
    ? xpRewardInput.trim()
    : ''
  const formValues = {
    title,
    description: descriptionValue,
    visibility: visibilityValue || 'public',
    goalKm: typeof goalKmValue === 'string' ? goalKmValue.trim() : '',
    goalRuns: typeof goalRunsValue === 'string' ? goalRunsValue.trim() : '',
    xpReward: xpRewardValue,
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

  if ((goalKm ?? 0) <= 0 && (goalRuns ?? 0) <= 0) {
    redirectToNewChallengeForm({
      error: 'Укажите goal_km или goal_runs больше 0.',
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

  const xpReward = Math.max(0, Math.round(xpRewardNumber))
  const normalizedGoalKm = goalKm != null && goalKm > 0 ? goalKm : null
  const normalizedGoalRuns = goalRuns != null && goalRuns > 0 ? Math.round(goalRuns) : null
  const description = descriptionValue.length > 0 ? descriptionValue : null
  const auditSnapshot: ChallengeAuditSnapshot = {
    title,
    description,
    visibility: visibilityValue,
    goal_km: normalizedGoalKm,
    goal_runs: normalizedGoalRuns,
    xp_reward: xpReward,
  }
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('challenges')
    .insert({
      title,
      description,
      visibility: visibilityValue,
      goal_km: normalizedGoalKm,
      goal_runs: normalizedGoalRuns,
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
  const goalKmValue = formData.get('goal_km')
  const goalRunsValue = formData.get('goal_runs')
  const xpRewardInput = formData.get('xp_reward')

  const challengeId = typeof challengeIdValue === 'string' ? challengeIdValue.trim() : ''
  const title = typeof titleValue === 'string' ? titleValue.trim() : ''
  const descriptionValue = typeof descriptionInput === 'string'
    ? descriptionInput.trim()
    : ''
  const visibilityValue = typeof visibilityInput === 'string'
    ? visibilityInput.trim()
    : ''
  const goalKm = normalizeOptionalPositiveNumber(goalKmValue)
  const goalRuns = normalizeOptionalPositiveNumber(goalRunsValue)
  const xpRewardValue = typeof xpRewardInput === 'string'
    ? xpRewardInput.trim()
    : ''

  if (!challengeId) {
    redirect('/admin/challenges')
  }

  if (!title) {
    redirectToEditChallengeForm(challengeId, 'Укажите название челленджа.')
  }

  if (visibilityValue !== 'public' && visibilityValue !== 'restricted') {
    redirectToEditChallengeForm(challengeId, 'Выберите корректную видимость челленджа.')
  }

  if ((goalKm ?? 0) <= 0 && (goalRuns ?? 0) <= 0) {
    redirectToEditChallengeForm(challengeId, 'Укажите цель по километрам или тренировкам больше 0.')
  }

  const xpRewardNumber = xpRewardValue ? Number(xpRewardValue) : 0

  if (!Number.isFinite(xpRewardNumber) || xpRewardNumber < 0) {
    redirectToEditChallengeForm(challengeId, 'Награда XP должна быть неотрицательным числом.')
  }

  const xpReward = Math.max(0, Math.round(xpRewardNumber))
  const normalizedGoalKm = goalKm != null && goalKm > 0 ? goalKm : null
  const normalizedGoalRuns = goalRuns != null && goalRuns > 0 ? Math.round(goalRuns) : null
  const description = descriptionValue.length > 0 ? descriptionValue : null
  const supabase = createSupabaseAdminClient()
  const { data: existingChallenge, error: existingChallengeError } = await supabase
    .from('challenges')
    .select('title, description, visibility, goal_km, goal_runs, xp_reward')
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
    goal_km: normalizedGoalKm,
    goal_runs: normalizedGoalRuns,
    xp_reward: xpReward,
  }

  const { error } = await supabase
    .from('challenges')
    .update({
      title,
      description,
      visibility: visibilityValue,
      goal_km: normalizedGoalKm,
      goal_runs: normalizedGoalRuns,
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
