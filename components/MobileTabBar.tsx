'use client'

import { Activity, Footprints, Home, MessageCircle, User, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type MouseEvent } from 'react'

const CHAT_KEYBOARD_VISIBILITY_EVENT = 'run-club:chat-keyboard-visibility'

type TabItem = {
  href: string
  label: string
  isActive: boolean
  icon: React.ReactNode
}

function TabIcon({ children }: { children: React.ReactNode }) {
  return <span className="flex h-5 w-5 items-center justify-center">{children}</span>
}

function scrollPageToTop() {
  if (typeof window === 'undefined') return

  const scrollingElement = document.scrollingElement

  if (scrollingElement) {
    scrollingElement.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }

  window.scrollTo({ top: 0, behavior: 'smooth' })
}

export default function MobileTabBar() {
  const pathname = usePathname()
  const [isChatKeyboardOpen, setIsChatKeyboardOpen] = useState(false)
  const hiddenRoutes = ['/', '/login', '/register']
  const shouldHide =
    hiddenRoutes.includes(pathname) || pathname.startsWith('/auth')

  useEffect(() => {
    function handleChatKeyboardVisibility(event: Event) {
      const keyboardOpen =
        event instanceof CustomEvent &&
        typeof event.detail?.keyboardOpen === 'boolean'
          ? event.detail.keyboardOpen
          : false

      setIsChatKeyboardOpen(keyboardOpen)
    }

    window.addEventListener(CHAT_KEYBOARD_VISIBILITY_EVENT, handleChatKeyboardVisibility)

    return () => {
      window.removeEventListener(CHAT_KEYBOARD_VISIBILITY_EVENT, handleChatKeyboardVisibility)
    }
  }, [])

  if (shouldHide || pathname === '/chat' || pathname.startsWith('/messages/') || isChatKeyboardOpen) return null

  const isClubRoute = pathname === '/club' || pathname === '/challenges' || pathname === '/leaderboard'
  const isMessagesRoute = pathname === '/messages' || pathname.startsWith('/messages/')
  const tabs: TabItem[] = [
    {
      href: '/dashboard',
      label: 'Главная',
      isActive: pathname === '/dashboard',
      icon: <TabIcon><Home className="h-5 w-5" strokeWidth={1.9} /></TabIcon>,
    },
    {
      href: '/activity',
      label: 'Актив',
      isActive: pathname === '/activity',
      icon: <TabIcon><Activity className="h-5 w-5" strokeWidth={1.9} /></TabIcon>,
    },
    {
      href: '/runs',
      label: 'Трен.',
      isActive: pathname === '/runs',
      icon: <TabIcon><Footprints className="h-5 w-5" strokeWidth={1.9} /></TabIcon>,
    },
    {
      href: '/club',
      label: 'Клуб',
      isActive: isClubRoute,
      icon: <TabIcon><Users className="h-5 w-5" strokeWidth={1.9} /></TabIcon>,
    },
    {
      href: '/messages',
      label: 'Сообщения',
      isActive: isMessagesRoute,
      icon: <TabIcon><MessageCircle className="h-5 w-5" strokeWidth={1.9} /></TabIcon>,
    },
    {
      href: '/profile',
      label: 'Профиль',
      isActive: pathname === '/profile',
      icon: <TabIcon><User className="h-5 w-5" strokeWidth={1.9} /></TabIcon>,
    },
  ]

  function handleTabClick(event: MouseEvent<HTMLAnchorElement>, isActive: boolean) {
    if (!isActive) return

    event.preventDefault()
    scrollPageToTop()
  }

  return (
    <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-40 md:hidden">
      <nav
        className="app-bottom-nav pointer-events-auto mx-auto grid max-w-xl grid-cols-6 border-t px-2 pb-[calc(0.35rem+env(safe-area-inset-bottom))] pt-1.5 text-center shadow-[0_-6px_18px_rgba(0,0,0,0.06)] backdrop-blur"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            onClick={(event) => handleTabClick(event, tab.isActive)}
            className={`mx-0.5 flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-[11px] font-medium transition-colors ${
              tab.isActive ? 'app-bottom-nav-active' : 'app-bottom-nav-inactive'
            }`}
          >
            {tab.icon}
            <span className={`truncate ${tab.isActive ? 'app-bottom-nav-active' : 'app-bottom-nav-inactive'}`}>{tab.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
