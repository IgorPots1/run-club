import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode
}) {
  const { user } = await getAuthenticatedUser()

  if (!user) {
    redirect('/login')
  }

  return children
}
