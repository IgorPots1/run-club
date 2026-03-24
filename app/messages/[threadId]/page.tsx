'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ChatSection from '@/components/ChatSection'
import InnerPageHeader from '@/components/InnerPageHeader'
import { getBootstrapUser } from '@/lib/auth'
import { markThreadAsRead } from '@/lib/chat/reads'
import { getChatThreadById } from '@/lib/chat/threads'
import { COACH_USER_ID } from '@/lib/constants'
import { ensureProfileExists, getProfileDisplayName } from '@/lib/profiles'
import { supabase } from '@/lib/supabase'

type ProfileRow = {
  id: string
  name: string | null
  nickname: string | null
  email: string | null
}

export default function MessageThreadPage() {
  const params = useParams<{ threadId: string }>()
  const router = useRouter()
  const lastMarkedThreadIdRef = useRef<string | null>(null)
  const threadId = typeof params?.threadId === 'string' ? params.threadId : ''
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [threadTitle, setThreadTitle] = useState('Чат')
  const [error, setError] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadThreadPage() {
      try {
        const user = await getBootstrapUser()

        if (!isMounted) {
          return
        }

        if (!user) {
          router.replace('/login')
          return
        }

        setCurrentUserId(user.id)
        void ensureProfileExists(user)

        const thread = await getChatThreadById(threadId)

        if (!isMounted) {
          return
        }

        if (thread.type === 'club') {
          setThreadTitle('Общий чат')
          setError('')
          return
        }

        if (user.id !== COACH_USER_ID) {
          setThreadTitle('Связь с тренером')
          setError('')
          return
        }

        if (!thread.owner_user_id) {
          setThreadTitle('Личный чат')
          setError('')
          return
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, name, nickname, email')
          .eq('id', thread.owner_user_id)
          .maybeSingle()

        if (profileError) {
          throw profileError
        }

        if (!isMounted) {
          return
        }

        setThreadTitle(getProfileDisplayName((profile as ProfileRow | null) ?? null, 'Ученик'))
        setError('')
      } catch {
        if (isMounted) {
          setError('Не удалось открыть чат')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    if (!threadId) {
      setLoading(false)
      setError('Некорректный чат')
      return
    }

    void loadThreadPage()

    return () => {
      isMounted = false
    }
  }, [router, threadId])

  useEffect(() => {
    if (loading || error || !currentUserId || !threadId) {
      return
    }

    if (lastMarkedThreadIdRef.current === threadId) {
      return
    }

    lastMarkedThreadIdRef.current = threadId

    void markThreadAsRead(threadId).catch(() => {
      if (lastMarkedThreadIdRef.current === threadId) {
        lastMarkedThreadIdRef.current = null
      }
    })
  }, [currentUserId, error, loading, threadId])

  if (loading) {
    return (
      <main
        data-chat-isolated-route="true"
        className="flex flex-col overflow-hidden"
        style={{
          height: 'var(--chat-app-height, 100dvh)',
          minHeight: 'var(--chat-app-height, 100dvh)',
        }}
      >
        <div className="mx-auto flex h-full min-h-0 w-full max-w-xl flex-col">
          <InnerPageHeader title="Загрузка..." fallbackHref="/messages" />
          <div className="min-h-0 flex-1">
            <ChatSection
              showTitle={false}
              threadId={threadId}
              enableReadState={false}
            />
          </div>
        </div>
      </main>
    )
  }

  if (error || !currentUserId || !threadId) {
    return (
      <main className="min-h-screen p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        <div className="mx-auto max-w-xl">
          <InnerPageHeader title="Чат" fallbackHref="/messages" />
          <section className="app-card rounded-2xl border p-4 shadow-sm">
            <p className="text-sm text-red-600">{error || 'Не удалось открыть чат'}</p>
          </section>
        </div>
      </main>
    )
  }

  return (
    <main
      data-chat-isolated-route="true"
      className="flex flex-col overflow-hidden"
      style={{
        height: 'var(--chat-app-height, 100dvh)',
        minHeight: 'var(--chat-app-height, 100dvh)',
      }}
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-xl flex-col">
        <InnerPageHeader title={threadTitle} fallbackHref="/messages" />
        <div className="min-h-0 flex-1">
          <ChatSection
            showTitle={false}
            threadId={threadId}
            enableReadState={false}
          />
        </div>
      </div>
    </main>
  )
}
