import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFirstSessionState } from '@/lib/onboarding'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export default async function OnboardingPage() {
  const { user } = await getAuthenticatedUser()

  if (!user) {
    redirect('/login')
  }

  const { isFirstSession } = await getFirstSessionState(user.id)

  if (!isFirstSession) {
    redirect('/dashboard')
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10 sm:min-h-screen">
      <div className="app-card w-full max-w-sm space-y-4 rounded-2xl border p-5 text-center shadow-sm">
        <h1 className="app-text-primary text-2xl font-semibold">Начнем с первой пробежки</h1>
        <p className="app-text-secondary text-sm">Подключите Strava или добавьте первую тренировку вручную.</p>
        <a
          href="/api/strava/connect?next=/dashboard"
          className="app-button-primary inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 py-2 text-sm font-medium"
        >
          Connect Strava
        </a>
        <Link
          href="/runs?from=onboarding"
          className="app-button-secondary inline-flex min-h-11 w-full items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium"
        >
          Add first run manually
        </Link>
      </div>
    </main>
  )
}
