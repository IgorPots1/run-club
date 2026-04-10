'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { logoutCurrentUser } from '@/lib/auth/logoutClient'
import UnreadBadge from '@/components/chat/UnreadBadge'
import useRealtimeTotalUnreadCount, {
  initializeRealtimeTotalUnreadCount,
} from '@/components/chat/useRealtimeTotalUnreadCount'
import { prefetchMessagesListData } from '@/lib/chat/messagesListPrefetch'

type NavbarUser = {
  id: string
  email: string | null
}

export default function Navbar({ initialUser }: { initialUser: NavbarUser | null }) {
  const router = useRouter()
  const [user, setUser] = useState<NavbarUser | null>(initialUser)
  const [isUnreadTrackingEnabled, setIsUnreadTrackingEnabled] = useState(false)
  const { totalUnreadCount } = useRealtimeTotalUnreadCount({
    enabled: isUnreadTrackingEnabled,
  })

  useEffect(() => {
    setUser(initialUser)
  }, [initialUser])

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
    try {
      await logoutCurrentUser({
        router,
        redirectTo: '/login',
        onSignedOut: () => {
          setUser(null)
        },
      })
    } catch {
      // Keep navbar logout non-blocking and let auth listeners recover UI state.
    }
  }

  if (!user) return null

  return (
    <nav className="flex items-center justify-between border-b p-4">
      <div className="flex gap-4">
          <Link href="/dashboard" prefetch={false}>Главная</Link>
          <Link href="/activity" prefetch={false}>Активность</Link>
          <Link href="/runs" prefetch={false}>Тренировки</Link>
          <Link href="/leaderboard" prefetch={false}>Рейтинг</Link>
          <Link href="/challenges" prefetch={false}>Челленджи</Link>
          <Link
            href="/messages"
            prefetch={false}
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
          <Link href="/feed" prefetch={false}>Лента</Link>
          <Link href="/profile" prefetch={false}>Профиль</Link>
      </div>
      <button onClick={handleLogout}>Выйти</button>
    </nav>
  )
}
