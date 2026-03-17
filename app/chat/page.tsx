'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBootstrapUser } from '@/lib/auth'
import { loadRecentChatMessages, type ChatMessageItem } from '@/lib/chat'
import { ensureProfileExists } from '@/lib/profiles'

function AvatarFallback() {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 20a6 6 0 0 0-12 0" />
        <circle cx="12" cy="8" r="4" />
      </svg>
    </span>
  )
}

export default function ChatPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(true)
  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadPage() {
      try {
        const user = await getBootstrapUser()

        if (!isMounted) {
          return
        }

        if (!user) {
          setIsAuthenticated(false)
          router.replace('/login')
          return
        }

        setIsAuthenticated(true)
        void ensureProfileExists(user)

        const recentMessages = await loadRecentChatMessages(50)

        if (!isMounted) {
          return
        }

        setMessages(recentMessages)
        setError('')
      } catch {
        if (isMounted) {
          setError('Не удалось загрузить чат')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    void loadPage()

    return () => {
      isMounted = false
    }
  }, [router])

  if (loading) {
    return (
      <main className="min-h-screen pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
        <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
          <div className="mb-4 space-y-2">
            <div className="skeleton-line h-8 w-32" />
            <div className="skeleton-line h-4 w-48" />
          </div>
          <div className="app-card rounded-2xl border p-4 shadow-sm">
            <div className="space-y-4">
              {[0, 1, 2].map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <div className="h-10 w-10 shrink-0 rounded-full skeleton-line" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex gap-2">
                      <div className="skeleton-line h-4 w-24" />
                      <div className="skeleton-line h-4 w-28" />
                    </div>
                    <div className="skeleton-line h-4 w-full" />
                    <div className="skeleton-line h-4 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    )
  }

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        <Link href="/login" className="text-sm underline">
          Открыть вход
        </Link>
      </main>
    )
  }

  return (
    <main className="min-h-screen pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <div className="mb-4 space-y-1">
          <h1 className="app-text-primary text-2xl font-bold">Чат клуба</h1>
          <p className="app-text-secondary text-sm">Последние 50 сообщений клуба в хронологическом порядке.</p>
        </div>

        {error ? (
          <section className="app-card rounded-2xl border p-4 shadow-sm">
            <p className="text-sm text-red-600">{error}</p>
          </section>
        ) : messages.length === 0 ? (
          <section className="app-card rounded-2xl border p-4 shadow-sm">
            <p className="app-text-secondary text-sm">Пока нет сообщений.</p>
            <p className="app-text-secondary mt-2 text-sm">
              Когда в базе появятся сообщения, они отобразятся здесь.
            </p>
          </section>
        ) : (
          <section className="app-card rounded-2xl border p-4 shadow-sm">
            <div className="space-y-4">
              {messages.map((message) => (
                <article key={message.id} className="flex items-start gap-3">
                  {message.avatarUrl ? (
                    <Image
                      src={message.avatarUrl}
                      alt=""
                      width={40}
                      height={40}
                      className="h-10 w-10 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <AvatarFallback />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <p className="app-text-primary truncate font-semibold">{message.displayName}</p>
                      <p className="app-text-secondary text-xs">{message.createdAtLabel}</p>
                    </div>
                    <p
                      className={[
                        'mt-1 break-words whitespace-pre-wrap text-sm leading-6',
                        message.isDeleted ? 'app-text-secondary italic' : 'app-text-primary',
                      ].join(' ')}
                    >
                      {message.text}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <div className="mt-4">
          <Link href="/dashboard" className="app-text-secondary text-sm underline">
            Назад на главную
          </Link>
        </div>
      </div>
    </main>
  )
}
