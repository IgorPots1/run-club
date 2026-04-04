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

function redirectToNewChallengeForm(error: string) {
  redirect(`/admin/challenges/new?error=${encodeURIComponent(error)}`)
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

  if (!title) {
    redirectToNewChallengeForm('Title is required.')
  }

  if (visibilityValue !== 'public' && visibilityValue !== 'restricted') {
    redirectToNewChallengeForm('Visibility must be public or restricted.')
  }

  if ((goalKm ?? 0) <= 0 && (goalRuns ?? 0) <= 0) {
    redirectToNewChallengeForm('At least one goal must be greater than 0.')
  }

  const xpRewardNumber = xpRewardValue ? Number(xpRewardValue) : 0

  if (!Number.isFinite(xpRewardNumber) || xpRewardNumber < 0) {
    redirectToNewChallengeForm('XP reward must be a non-negative number.')
  }

  const xpReward = Math.max(0, Math.round(xpRewardNumber))
  const normalizedGoalKm = goalKm != null && goalKm > 0 ? goalKm : null
  const normalizedGoalRuns = goalRuns != null && goalRuns > 0 ? Math.round(goalRuns) : null
  const description = descriptionValue.length > 0 ? descriptionValue : null
  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('challenges')
    .insert({
      title,
      description,
      visibility: visibilityValue,
      goal_km: normalizedGoalKm,
      goal_runs: normalizedGoalRuns,
      xp_reward: xpReward,
    })

  if (error) {
    throw error
  }

  redirect('/admin/challenges')
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
