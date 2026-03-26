'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import UnreadBadge from '@/components/chat/UnreadBadge'
import useRealtimeTotalUnreadCount, {
  initializeRealtimeTotalUnreadCount,
} from '@/components/chat/useRealtimeTotalUnreadCount'
import { getBootstrapUser } from '@/lib/auth'
import { prefetchMessagesListData } from '@/lib/chat/messagesListPrefetch'
import { stopVoiceStream } from '@/lib/voice/voiceStream'
import { supabase } from '../lib/supabase'

export default function Navbar() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [isUnreadTrackingEnabled, setIsUnreadTrackingEnabled] = useState(false)
  const { totalUnreadCount } = useRealtimeTotalUnreadCount({
    enabled: isUnreadTrackingEnabled,
  })

  useEffect(() => {
    void getBootstrapUser().then((nextUser) => {
      setUser(nextUser)
    })
  }, [])

  useEffect(() => {
    let timeoutId: number | null = null
    const idleCallbackId =
      typeof window !== 'undefined' && 'requestIdleCallback' in window
        ? window.requestIdleCallback(() => {
            setIsUnreadTrackingEnabled(true)
          }, { timeout: 1200 })
        : null

    if (idleCallbackId === null) {
      timeoutId = window.setTimeout(() => {
        setIsUnreadTrackingEnabled(true)
      }, 350)
    }

    return () => {
      if (idleCallbackId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleCallbackId)
      }

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
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
              setIsUnreadTrackingEnabled(true)
              void initializeRealtimeTotalUnreadCount()
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
