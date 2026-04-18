'use client'

import Link from 'next/link'
import { useEffect, useState, type ComponentType } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { ChevronRight, Flame, Target, Trophy, BarChart3 } from 'lucide-react'
import InnerPageHeader from '@/components/InnerPageHeader'
import { getBootstrapUser } from '@/lib/auth'

type ClubNavCardProps = {
  href: string
  title: string
  description: string
  hint: string
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
}

function ClubNavCard({ href, title, description, hint, icon: Icon }: ClubNavCardProps) {
  return (
    <Link
      href={href}
      className="app-card flex items-start justify-between gap-3 rounded-2xl p-4 shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:ring-white/10"
    >
      <div className="min-w-0">
        <p className="app-text-secondary flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
          <Icon className="h-4 w-4 shrink-0" strokeWidth={1.9} />
          <span>Клуб</span>
        </p>
        <p className="app-text-primary mt-2 text-base font-semibold">{title}</p>
        <p className="app-text-secondary mt-1 text-sm">{description}</p>
        <p className="app-text-secondary mt-2 text-xs font-medium">{hint}</p>
      </div>
      <ChevronRight className="app-text-muted mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
    </Link>
  )
}

export default function ClubPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function loadUser() {
      try {
        const nextUser = await getBootstrapUser()

        if (!isMounted) return

        setUser(nextUser)

        if (!nextUser) {
          router.replace('/login')
        }
      } finally {
        if (isMounted) {
          setAuthLoading(false)
        }
      }
    }

    void loadUser()

    return () => {
      isMounted = false
    }
  }, [router])

  if (!authLoading && !user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

  return (
    <main className="min-h-screen">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30">
        <div className="pointer-events-auto mx-auto max-w-xl px-4 md:px-4">
          <InnerPageHeader title="Клуб" fallbackHref="/" />
        </div>
      </div>

      <div className="mx-auto max-w-xl px-4 pb-4 pt-3 md:p-4">
        <div aria-hidden="true" className="invisible">
          <InnerPageHeader title="Клуб" fallbackHref="/" />
        </div>
      </div>

      <div className="mx-auto max-w-xl space-y-3 px-4 pb-4 md:px-4">
        <Link
          href="/race"
          className="app-card block overflow-hidden rounded-2xl border p-5 shadow-sm ring-1 ring-black/5 transition-[transform,box-shadow] hover:shadow-[0_6px_16px_rgba(0,0,0,0.1)] active:scale-[0.995] dark:ring-white/10"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="app-text-secondary flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
                <Flame className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span>Главное</span>
              </p>
              <p className="app-text-primary mt-2 text-xl font-semibold">Weekly Race</p>
              <p className="app-text-secondary mt-1 text-sm">
                Еженедельная гонка клуба: позиции, XP и итоговые места недели.
              </p>
              <p className="app-text-secondary mt-3 text-xs font-medium">Открыть гонку недели</p>
            </div>
            <ChevronRight className="app-text-muted mt-0.5 h-5 w-5 shrink-0" strokeWidth={2} aria-hidden="true" />
          </div>
        </Link>

        <ClubNavCard
          href="/challenges"
          title="Челленджи"
          description="Все активные цели клуба, прогресс и завершенные вызовы."
          hint="Открыть челленджи"
          icon={Target}
        />

        <ClubNavCard
          href="/club/leaderboard"
          title="Рейтинг и рекорды"
          description="Личные рекорды участников клуба по дистанциям в отдельном разделе."
          hint="Открыть рейтинг рекордов"
          icon={Trophy}
        />

        <ClubNavCard
          href="/club/statistics"
          title="Статистика клуба"
          description="Подробная статистика недели и месяца в отдельном экране."
          hint="Открыть статистику клуба"
          icon={BarChart3}
        />
      </div>
    </main>
  )
}
