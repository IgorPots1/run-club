'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { writeAdminAuditEntry } from '@/lib/admin/audit'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

function redirectToAdminUsersPage() {
  redirect('/admin/users')
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
