import { redirect } from 'next/navigation'
import InnerPageHeader from '@/components/InnerPageHeader'
import ShoesPageClient from './ShoesPageClient'
import { listShoeCatalog, listUserShoes } from '@/lib/shoes'
import { getAuthenticatedUser } from '@/lib/supabase-server'

export default async function ActivityShoesPage() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    redirect('/login')
  }

  let initialShoes = [] as Awaited<ReturnType<typeof listUserShoes>>
  let initialCatalog = [] as Awaited<ReturnType<typeof listShoeCatalog>>
  let loadFailed = false

  try {
    ;[initialShoes, initialCatalog] = await Promise.all([
      listUserShoes(user.id),
      listShoeCatalog(),
    ])
  } catch {
    loadFailed = true
  }

  return (
    <main className="min-h-screen">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30">
        <div className="pointer-events-auto mx-auto max-w-xl px-4 md:px-4">
          <InnerPageHeader title="Кроссовки" fallbackHref="/activity" />
        </div>
      </div>
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <div aria-hidden="true" className="invisible">
          <InnerPageHeader title="Кроссовки" fallbackHref="/activity" />
        </div>
        <div className="mt-4">
          {loadFailed ? (
            <div className="app-card rounded-2xl border p-4 shadow-sm">
              <p className="text-sm text-red-600">Не удалось загрузить экран кроссовок</p>
            </div>
          ) : (
            <ShoesPageClient
              initialShoes={initialShoes}
              initialCatalog={initialCatalog}
            />
          )}
        </div>
      </div>
    </main>
  )
}
