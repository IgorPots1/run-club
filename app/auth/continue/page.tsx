import { redirect } from 'next/navigation'
import { getPostAuthRedirectPath } from '@/lib/onboarding'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export default async function AuthContinuePage() {
  const { user } = await getAuthenticatedUser()

  if (!user) {
    redirect('/login')
  }

  redirect(await getPostAuthRedirectPath(user.id))
}
