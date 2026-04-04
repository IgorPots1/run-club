'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type AdminNavLinkProps = {
  href: string
  children: string
}

export default function AdminNavLink({ href, children }: AdminNavLinkProps) {
  const pathname = usePathname()
  const isActive = pathname === href || (href !== '/admin' && pathname.startsWith(`${href}/`))

  return (
    <Link
      href={href}
      className={[
        'rounded-2xl px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'app-button-primary shadow-sm'
          : 'app-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
      ].join(' ')}
      aria-current={isActive ? 'page' : undefined}
    >
      {children}
    </Link>
  )
}
