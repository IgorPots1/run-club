'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import UnreadBadge from '@/components/chat/UnreadBadge'
import useRealtimeTotalUnreadCount from '@/components/chat/useRealtimeTotalUnreadCount'
import { getBootstrapUser } from '@/lib/auth'
import { prefetchMessagesListData } from '@/lib/chat/messagesListPrefetch'
import { stopVoiceStream } from '@/lib/voice/voiceStream'
import { supabase } from '../lib/supabase'

export default function Navbar() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const { totalUnreadCount } = useRealtimeTotalUnreadCount()

  useEffect(() => {
    void getBootstrapUser().then((nextUser) => {
      setUser(nextUser)
    })
  }, [])

  async function handleLogout() {
    stopVoiceStream()
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
          <Link
            href="/messages"
            onPointerDown={() => {
              void prefetchMessagesListData()
            }}
            className="inline-flex items-center gap-2"
          >
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
