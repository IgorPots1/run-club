import type { ReactNode } from 'react'
import Link from 'next/link'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  await requireAdmin()

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r border-gray-200 p-6">
        <nav className="flex flex-col gap-3">
          <Link href="/admin">Dashboard</Link>
          <Link href="/admin/challenges">Challenges</Link>
          <Link href="/admin/users">Users</Link>
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
