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

export async function createChallengeAction(formData: FormData) {
  await requireAdmin()

  const title = typeof formData.get('title') === 'string' ? formData.get('title')!.trim() : ''
  const descriptionValue = typeof formData.get('description') === 'string'
    ? formData.get('description')!.trim()
    : ''
  const visibilityValue = typeof formData.get('visibility') === 'string'
    ? formData.get('visibility')!.trim()
    : ''
  const goalKm = normalizeOptionalPositiveNumber(formData.get('goal_km'))
  const goalRuns = normalizeOptionalPositiveNumber(formData.get('goal_runs'))
  const xpRewardValue = typeof formData.get('xp_reward') === 'string'
    ? formData.get('xp_reward')!.trim()
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
