'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { getBootstrapUser } from '@/lib/auth'
import { supabase } from '../lib/supabase'

export default function Navbar() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    void getBootstrapUser().then((nextUser) => {
      setUser(nextUser)
    })
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    setUser(null)
    router.replace('/login')
  }

  if (!user) return null

  return (
    <nav className="flex items-center justify-between border-b p-4">
      <div className="flex gap-4">
          <Link href="/dashboard">Главная</Link>
          <Link href="/activity">Активность</Link>
          <Link href="/runs">Тренировки</Link>
          <Link href="/leaderboard">Рейтинг</Link>
          <Link href="/challenges">Челленджи</Link>
          <Link href="/chat">Чат</Link>
          <Link href="/feed">Лента</Link>
          <Link href="/profile">Профиль</Link>
      </div>
      <button onClick={handleLogout}>Выйти</button>
    </nav>
  )
}
