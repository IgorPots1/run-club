'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import UnreadBadge from '@/components/chat/UnreadBadge'
import { getBootstrapUser } from '@/lib/auth'
import { getTotalUnreadCount } from '@/lib/chat/reads'
import { supabase } from '../lib/supabase'

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [totalUnreadCount, setTotalUnreadCount] = useState(0)

  useEffect(() => {
    void getBootstrapUser().then((nextUser) => {
      setUser(nextUser)
    })
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadUnreadCount() {
      try {
        const nextTotalUnreadCount = await getTotalUnreadCount()

        if (isMounted) {
          setTotalUnreadCount(nextTotalUnreadCount)
        }
      } catch {
        if (isMounted) {
          setTotalUnreadCount(0)
        }
      }
    }

    void loadUnreadCount()

    return () => {
      isMounted = false
    }
  }, [pathname])

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
          <Link href="/messages" className="inline-flex items-center gap-2">
            <span>Сообщения</span>
            <UnreadBadge count={totalUnreadCount} />
          </Link>
          <Link href="/feed">Лента</Link>
          <Link href="/profile">Профиль</Link>
      </div>
      <button onClick={handleLogout}>Выйти</button>
    </nav>
  )
}
