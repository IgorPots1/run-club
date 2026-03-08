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
      <nav className="max-w-xl mx-auto bg-white border-t flex justify-around py-3">
        <Link href="/dashboard">Главная</Link>
        <Link href="/runs">Тренировки</Link>
        <Link href="/leaderboard">Рейтинг</Link>
        <Link href="/profile">Профиль</Link>
      </nav>
    </div>
  )
}
