'use client'

import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import InnerPageHeader from '@/components/InnerPageHeader'
import { getBootstrapUser } from '@/lib/auth'

type ClubNavCardProps = {
  href: string
  title: string
  subtitle?: string
}

function ClubNavCard({ href, title, subtitle }: ClubNavCardProps) {
  return (
    <Link
      href={href}
      className="app-card flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:ring-white/10"
    >
      <div className="min-w-0">
        <p className="app-text-primary truncate text-base font-semibold">{title}</p>
        {subtitle ? (
          <p className="app-text-secondary mt-0.5 truncate text-sm">{subtitle}</p>
        ) : null}
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
        <ClubNavCard href="/race" title="Гонка недели" subtitle="Живой рейтинг по XP" />

        <ClubNavCard
          href="/challenges"
          title="Челленджи"
          subtitle="Активные цели клуба"
        />

        <ClubNavCard
          href="/club/leaderboard"
          title="Личные рекорды"
          subtitle="Рейтинг по дистанциям"
        />

        <ClubNavCard
          href="/club/statistics"
          title="Статистика клуба"
          subtitle="Неделя и месяц"
        />
      </div>
    </main>
  )
}
