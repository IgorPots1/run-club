import { redirect } from 'next/navigation'
import InnerPageHeader from '@/components/InnerPageHeader'
import ShoesPageClient from './ShoesPageClient'
import { listPopularShoeModels, listUserShoes } from '@/lib/shoes'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export default async function ActivityShoesPage() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    redirect('/login')
  }

  let initialShoes = [] as Awaited<ReturnType<typeof listUserShoes>>
  let initialPopularModels = [] as Awaited<ReturnType<typeof listPopularShoeModels>>
  let loadFailed = false

  try {
    ;[initialShoes, initialPopularModels] = await Promise.all([
      listUserShoes(user.id),
      listPopularShoeModels(),
    ])
  } catch {
    loadFailed = true
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <InnerPageHeader title="Кроссовки" fallbackHref="/activity" />
        <div className="mt-4">
          {loadFailed ? (
            <div className="app-card rounded-2xl border p-4 shadow-sm">
              <p className="text-sm text-red-600">Не удалось загрузить экран кроссовок</p>
            </div>
          ) : (
            <ShoesPageClient
              initialShoes={initialShoes}
              initialPopularModels={initialPopularModels}
            />
          )}
        </div>
      </div>
    </main>
  )
}
