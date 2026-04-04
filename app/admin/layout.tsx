import type { ReactNode } from 'react'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  await requireAdmin()

  return <div>{children}</div>
}
