'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

function redirectToAdminUsersPage() {
  redirect('/admin/users')
}

async function updateUserAppAccessStatus(userId: string, nextStatus: 'active' | 'blocked') {
  const { user } = await requireAdmin()

  if (!userId) {
    redirectToAdminUsersPage()
  }

  if (user.id === userId) {
    redirectToAdminUsersPage()
  }

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('profiles')
    .update({
      app_access_status: nextStatus,
    })
    .eq('id', userId)

  if (error) {
    throw error
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
