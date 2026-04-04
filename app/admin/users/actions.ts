'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { writeAdminAuditEntry } from '@/lib/admin/audit'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

function redirectToAdminUsersPage() {
  redirect('/admin/users')
}

function redirectToAdminUserPage(userId: string, error?: string) {
  const basePath = `/admin/users/${encodeURIComponent(userId)}`
  redirect(error ? `${basePath}?error=${encodeURIComponent(error)}` : basePath)
}

function parseIntegerFormValue(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (!trimmed || !/^-?\d+$/.test(trimmed)) {
    return null
  }

  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) ? parsed : null
}

async function updateUserAppAccessStatus(userId: string, nextStatus: 'active' | 'blocked') {
  const { user, profile } = await requireAdmin()

  if (!userId) {
    redirectToAdminUsersPage()
  }

  if (user.id === userId) {
    redirectToAdminUsersPage()
  }

  const supabase = createSupabaseAdminClient()
  const { data: existingProfile, error: existingProfileError } = await supabase
    .from('profiles')
    .select('app_access_status')
    .eq('id', userId)
    .maybeSingle()

  if (existingProfileError) {
    console.error('[admin-users] failed to load previous app access status', {
      actorUserId: profile.id,
      targetUserId: userId,
      code: existingProfileError.code ?? null,
      message: existingProfileError.message,
      details: existingProfileError.details ?? null,
    })
  }

  const { data: updatedProfile, error } = await supabase
    .from('profiles')
    .update({
      app_access_status: nextStatus,
    })
    .select('id, app_access_status')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (updatedProfile) {
    await writeAdminAuditEntry({
      actorUserId: profile.id,
      action: nextStatus === 'blocked' ? 'app_access.block' : 'app_access.unblock',
      entityType: 'profile',
      entityId: updatedProfile.id,
      payloadBefore: {
        app_access_status: existingProfile?.app_access_status ?? null,
      },
      payloadAfter: {
        app_access_status: updatedProfile.app_access_status,
      },
    })
  }

  revalidatePath('/admin/users')
  redirectToAdminUsersPage()
}

export async function blockUserAppAccess(formData: FormData) {
  const userIdValue = formData.get('user_id')
  const userId = typeof userIdValue === 'string' ? userIdValue.trim() : ''

  await updateUserAppAccessStatus(userId, 'blocked')
}

export async function unblockUserAppAccess(formData: FormData) {
  const userIdValue = formData.get('user_id')
  const userId = typeof userIdValue === 'string' ? userIdValue.trim() : ''

  await updateUserAppAccessStatus(userId, 'active')
}

export async function adjustUserXpAction(formData: FormData) {
  const { user, profile } = await requireAdmin()
  const userIdValue = formData.get('user_id')
  const deltaXpValue = formData.get('delta_xp')
  const reasonValue = formData.get('reason')
  const userId = typeof userIdValue === 'string' ? userIdValue.trim() : ''
  const deltaXp = parseIntegerFormValue(deltaXpValue)
  const reason = typeof reasonValue === 'string' ? reasonValue.trim() : ''

  if (!userId) {
    redirectToAdminUsersPage()
  }

  if (user.id === userId) {
    redirectToAdminUserPage(userId, 'Нельзя менять свой собственный XP.')
  }

  if (deltaXp == null) {
    redirectToAdminUserPage(userId, 'Изменение XP должно быть целым числом.')
    return
  }

  if (deltaXp === 0) {
    redirectToAdminUserPage(userId, 'Изменение XP не может быть равно 0.')
  }

  if (!reason) {
    redirectToAdminUserPage(userId, 'Укажите причину изменения XP.')
  }

  const supabase = createSupabaseAdminClient()
  const { data: existingProfile, error: existingProfileError } = await supabase
    .from('profiles')
    .select('id, total_xp')
    .eq('id', userId)
    .maybeSingle()

  if (existingProfileError) {
    throw existingProfileError
  }

  if (!existingProfile) {
    redirectToAdminUsersPage()
    return
  }

  const delta = deltaXp
  const currentTotalXp = Number(existingProfile.total_xp ?? 0)
  const nextTotalXp = Math.max(0, currentTotalXp + delta)
  const { data: updatedProfile, error: updateError } = await supabase
    .from('profiles')
    .update({
      total_xp: nextTotalXp,
    })
    .select('id, total_xp')
    .eq('id', userId)
    .maybeSingle()

  if (updateError) {
    throw updateError
  }

  if (updatedProfile) {
    await writeAdminAuditEntry({
      actorUserId: profile.id,
      action: 'xp.adjust',
      entityType: 'profile',
      entityId: updatedProfile.id,
      payloadBefore: {
        total_xp: currentTotalXp,
      },
      payloadAfter: {
        total_xp: Number(updatedProfile.total_xp ?? nextTotalXp),
        delta_xp: delta,
        reason,
      },
    })
  }

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
  redirectToAdminUserPage(userId)
}
