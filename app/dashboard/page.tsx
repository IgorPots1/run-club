import { redirect } from 'next/navigation'
import DashboardPageClient from './DashboardPageClient'
import { createSupabaseServerClient, getAuthenticatedUser } from '@/lib/supabase-server'

type ProfileSummaryRow = {
  name: string | null
  nickname: string | null
  email: string | null
}

export default async function DashboardPage() {
  const { user } = await getAuthenticatedUser()

  if (!user) {
    redirect('/login')
  }

  const supabase = await createSupabaseServerClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('name, nickname, email')
    .eq('id', user.id)
    .maybeSingle()

  const initialProfileSummary = (profile as ProfileSummaryRow | null) ?? {
    name: null,
    nickname: null,
    email: null,
  }

  return (
    <DashboardPageClient
      initialUser={{
        id: user.id,
        email: user.email ?? null,
      }}
      initialProfileSummary={{
        name: initialProfileSummary.name,
        nickname: initialProfileSummary.nickname,
        email: initialProfileSummary.email ?? user.email ?? null,
      }}
    />
  )
}
