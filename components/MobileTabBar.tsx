'use client'

import { Activity, Dumbbell, Home, User, Users } from 'lucide-react'
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
      icon: <TabIcon><Dumbbell className="h-5 w-5" strokeWidth={1.9} /></TabIcon>,
    },
    {
      href: '/club',
      label: 'Клуб',
      isActive: isClubRoute,
      icon: <TabIcon><Users className="h-5 w-5" strokeWidth={1.9} /></TabIcon>,
    },
    {
      href: '/profile',
      label: 'Профиль',
      isActive: pathname === '/profile',
      icon: <TabIcon><User className="h-5 w-5" strokeWidth={1.9} /></TabIcon>,
    },
  ]

  return (
    <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-40 md:hidden">
      <nav
        className="app-bottom-nav pointer-events-auto mx-auto grid max-w-xl grid-cols-5 border-t px-2 pb-[calc(0.35rem+env(safe-area-inset-bottom))] pt-1.5 text-center shadow-[0_-6px_18px_rgba(0,0,0,0.06)] backdrop-blur"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
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
