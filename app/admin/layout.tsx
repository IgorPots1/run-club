import type { ReactNode } from 'react'
import AdminNavLink from './AdminNavLink'
import AdminStravaRecoveryButton from './AdminStravaRecoveryButton'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  await requireAdmin()

  return (
    <div className="app-shell min-h-screen px-4 py-4 lg:px-6 lg:py-6">
      <div className="mx-auto w-full max-w-7xl lg:flex lg:items-start lg:gap-6">
        <aside className="mb-4 lg:sticky lg:top-6 lg:mb-0 lg:w-64 lg:shrink-0">
          <div className="app-card rounded-2xl border p-4 shadow-sm">
            <div className="mb-4">
              <p className="app-text-primary text-lg font-semibold">Админка</p>
              <p className="app-text-secondary mt-1 text-sm">Управление Run Club</p>
            </div>
            <nav className="flex flex-col gap-2">
              <AdminNavLink href="/admin/users">Пользователи</AdminNavLink>
              <AdminNavLink href="/admin/coach-lab">Coach Lab</AdminNavLink>
              <AdminNavLink href="/admin/challenges">Челленджи</AdminNavLink>
              <AdminNavLink href="/admin/challenge-templates">Шаблоны челленджей</AdminNavLink>
              <AdminNavLink href="/admin/audit">Журнал действий</AdminNavLink>
            </nav>
            <AdminStravaRecoveryButton />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  )
}
