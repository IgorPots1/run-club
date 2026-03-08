'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type TabItem = {
  href: string
  label: string
  isActive: boolean
  icon: React.ReactNode
}

function TabIcon({ children }: { children: React.ReactNode }) {
  return <span className="flex h-5 w-5 items-center justify-center">{children}</span>
}

export default function MobileTabBar() {
  const pathname = usePathname()
  const hiddenRoutes = ['/', '/login', '/register']
  const shouldHide =
    hiddenRoutes.includes(pathname) || pathname.startsWith('/auth')

  if (shouldHide) return null

  const isClubRoute = pathname === '/club' || pathname === '/challenges' || pathname === '/leaderboard'
  const tabs: TabItem[] = [
    {
      href: '/dashboard',
      label: 'Главная',
      isActive: pathname === '/dashboard',
      icon: (
        <TabIcon>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 10.5 12 4l9 6.5" />
            <path d="M5 9.5V20h14V9.5" />
          </svg>
        </TabIcon>
      ),
    },
    {
      href: '/activity',
      label: 'Актив.',
      isActive: pathname === '/activity',
      icon: (
        <TabIcon>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 14h3l2.5-5 4 10 2.5-5H20" />
          </svg>
        </TabIcon>
      ),
    },
    {
      href: '/runs',
      label: 'Трен.',
      isActive: pathname === '/runs',
      icon: (
        <TabIcon>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M13 5.5 9.5 9l2 2 2.5-2.5L17 11l-2 2" />
            <path d="M11 11 7 15M15 9l4 4" />
          </svg>
        </TabIcon>
      ),
    },
    {
      href: '/club',
      label: 'Клуб',
      isActive: isClubRoute,
      icon: (
        <TabIcon>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="9" cy="9" r="3" />
            <circle cx="17" cy="10" r="2.5" />
            <path d="M4.5 19a4.5 4.5 0 0 1 9 0" />
            <path d="M14 18a3.5 3.5 0 0 1 6 0" />
          </svg>
        </TabIcon>
      ),
    },
    {
      href: '/profile',
      label: 'Профиль',
      isActive: pathname === '/profile',
      icon: (
        <TabIcon>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 19a7 7 0 0 1 14 0" />
          </svg>
        </TabIcon>
      ),
    },
  ]

  return (
    <div className="fixed bottom-0 left-0 right-0 md:hidden">
      <nav
        className="mx-auto grid max-w-xl grid-cols-5 border-t border-gray-200 bg-white/95 px-2 pt-2 text-center shadow-[0_-6px_18px_rgba(0,0,0,0.06)] backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`mx-0.5 flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium transition-colors ${
              tab.isActive ? 'bg-gray-100 text-black' : 'text-gray-500'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
