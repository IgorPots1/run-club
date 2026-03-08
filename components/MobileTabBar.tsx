'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export default function MobileTabBar() {
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
    })
  }, [])

  if (!user) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 md:hidden">
      <nav className="mx-auto grid max-w-xl grid-cols-5 border-t bg-white py-2 text-center text-xs">
        <Link href="/dashboard" className="px-1 py-2">Главная</Link>
        <Link href="/runs" className="px-1 py-2">Тренировки</Link>
        <Link href="/leaderboard" className="px-1 py-2">Рейтинг</Link>
        <Link href="/challenges" className="px-1 py-2">Челленджи</Link>
        <Link href="/profile" className="px-1 py-2">Профиль</Link>
      </nav>
    </div>
  )
}
