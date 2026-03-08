'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export default function MobileTabBar() {
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
    })
  }, [])

  if (!user) return null

  function getLinkClass(href: string) {
    const isClubRoute = href === '/club' && (pathname === '/club' || pathname === '/challenges' || pathname === '/leaderboard')
    const isActive = isClubRoute || pathname === href

    return `flex min-h-16 items-center justify-center px-2 py-3 text-sm font-medium ${
      isActive ? 'text-black' : 'text-gray-500'
    }`
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 md:hidden">
      <nav className="mx-auto grid max-w-xl grid-cols-4 border-t bg-white text-center">
        <Link href="/dashboard" className={getLinkClass('/dashboard')}>Главная</Link>
        <Link href="/runs" className={getLinkClass('/runs')}>Тренировки</Link>
        <Link href="/club" className={getLinkClass('/club')}>Клуб</Link>
        <Link href="/profile" className={getLinkClass('/profile')}>Профиль</Link>
      </nav>
    </div>
  )
}
