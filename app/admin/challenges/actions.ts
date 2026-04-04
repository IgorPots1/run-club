'use server'

import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

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
  await requireAdmin()

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

  if (data.visibility === 'restricted') {
    redirectToChallengeAccessPage(data.id)
  }

  redirect('/admin/challenges')
}

export async function updateChallengeAction(formData: FormData) {
  await requireAdmin()

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
    redirectToEditChallengeForm(challengeId, 'Title is required.')
  }

  if (visibilityValue !== 'public' && visibilityValue !== 'restricted') {
    redirectToEditChallengeForm(challengeId, 'Visibility must be public or restricted.')
  }

  if ((goalKm ?? 0) <= 0 && (goalRuns ?? 0) <= 0) {
    redirectToEditChallengeForm(challengeId, 'At least one goal must be greater than 0.')
  }

  const xpRewardNumber = xpRewardValue ? Number(xpRewardValue) : 0

  if (!Number.isFinite(xpRewardNumber) || xpRewardNumber < 0) {
    redirectToEditChallengeForm(challengeId, 'XP reward must be a non-negative number.')
  }

  const xpReward = Math.max(0, Math.round(xpRewardNumber))
  const normalizedGoalKm = goalKm != null && goalKm > 0 ? goalKm : null
  const normalizedGoalRuns = goalRuns != null && goalRuns > 0 ? Math.round(goalRuns) : null
  const description = descriptionValue.length > 0 ? descriptionValue : null
  const supabase = createSupabaseAdminClient()
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

  redirectToChallengeAccessPage(challengeId)
}

export async function grantChallengeAccessAction(formData: FormData) {
  await requireAdmin()

  const challengeIdValue = formData.get('challenge_id')
  const userIdValue = formData.get('user_id')
  const challengeId = typeof challengeIdValue === 'string' ? challengeIdValue.trim() : ''
  const userId = typeof userIdValue === 'string' ? userIdValue.trim() : ''

  if (!challengeId) {
    redirect('/admin/challenges')
  }

  if (!userId) {
    redirectToChallengeAccessPage(challengeId, 'User ID is required.')
  }

  const { profile } = await requireAdmin()
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

  redirectToChallengeAccessPage(challengeId)
}

export async function revokeChallengeAccessAction(formData: FormData) {
  await requireAdmin()

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

  redirectToChallengeAccessPage(challengeId)
}
