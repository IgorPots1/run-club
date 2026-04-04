import type { ReactNode } from 'react'
import AdminNavLink from './AdminNavLink'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  await requireAdmin()

  return (
    <div className="app-shell min-h-screen lg:flex">
      <aside className="border-b p-4 lg:w-72 lg:border-b-0 lg:border-r lg:p-6">
        <div className="app-card rounded-2xl border p-4 shadow-sm">
          <div className="mb-4">
            <p className="app-text-primary text-lg font-semibold">Админка</p>
            <p className="app-text-secondary mt-1 text-sm">Управление Run Club</p>
          </div>
          <nav className="flex flex-col gap-2">
            <AdminNavLink href="/admin">Обзор</AdminNavLink>
            <AdminNavLink href="/admin/challenges">Челленджи</AdminNavLink>
            <AdminNavLink href="/admin/users">Пользователи</AdminNavLink>
            <AdminNavLink href="/admin/audit">Журнал действий</AdminNavLink>
          </nav>
        </div>
      </aside>
      <main className="flex-1 p-4 lg:p-6">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  )
}
