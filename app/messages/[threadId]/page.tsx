'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ChatSection from '@/components/ChatSection'
import InnerPageHeader from '@/components/InnerPageHeader'
import { getBootstrapUser } from '@/lib/auth'
import { getTotalUnreadCount, markThreadAsRead } from '@/lib/chat/reads'
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

const CHAT_UNREAD_UPDATED_EVENT = 'chat-unread-updated'

export default function MessageThreadPage() {
  const params = useParams<{ threadId: string }>()
  const router = useRouter()
  const markReadTimeoutRef = useRef<number | null>(null)
  const isMarkingThreadReadRef = useRef(false)
  const pendingMarkThreadReadRef = useRef(false)
  const threadId = typeof params?.threadId === 'string' ? params.threadId : ''
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [threadTitle, setThreadTitle] = useState('Чат')
  const [error, setError] = useState('')

  useEffect(() => {
    return () => {
      if (markReadTimeoutRef.current !== null) {
        window.clearTimeout(markReadTimeoutRef.current)
      }
    }
  }, [])

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

    async function runMarkThreadAsRead() {
      if (isMarkingThreadReadRef.current) {
        pendingMarkThreadReadRef.current = true
        return
      }

      isMarkingThreadReadRef.current = true

      try {
        await markThreadAsRead(threadId)

        if (typeof window !== 'undefined') {
          const totalUnreadCount = await getTotalUnreadCount()
          window.dispatchEvent(
            new CustomEvent(CHAT_UNREAD_UPDATED_EVENT, {
              detail: {
                count: totalUnreadCount,
              },
            })
          )
        }
      } catch {
        // Keep read refresh non-blocking while the thread stays open.
      } finally {
        isMarkingThreadReadRef.current = false

        if (pendingMarkThreadReadRef.current) {
          pendingMarkThreadReadRef.current = false
          void runMarkThreadAsRead()
        }
      }
    }

    function scheduleMarkThreadAsRead(delayMs = 0) {
      if (markReadTimeoutRef.current !== null) {
        window.clearTimeout(markReadTimeoutRef.current)
      }

      markReadTimeoutRef.current = window.setTimeout(() => {
        markReadTimeoutRef.current = null
        void runMarkThreadAsRead()
      }, delayMs)
    }

    scheduleMarkThreadAsRead()

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        scheduleMarkThreadAsRead(150)
      }
    }

    const channel = supabase
      .channel(`thread-read-refresh:${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const nextMessageUserId = String((payload.new as { user_id?: string } | null)?.user_id ?? '')

          if (!nextMessageUserId || nextMessageUserId === currentUserId) {
            return
          }

          scheduleMarkThreadAsRead(250)
        }
      )
      .subscribe()

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (markReadTimeoutRef.current !== null) {
        window.clearTimeout(markReadTimeoutRef.current)
        markReadTimeoutRef.current = null
      }

      pendingMarkThreadReadRef.current = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      void supabase.removeChannel(channel)
    }
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
          <div className="min-h-0 flex-1 px-4 pb-4 pt-2 md:p-4">
            <div className="app-card h-full rounded-2xl border px-4 pb-4 pt-3 shadow-sm">
              <div className="space-y-4">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <div className="h-10 w-10 shrink-0 rounded-full skeleton-line" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex gap-2">
                        <div className="skeleton-line h-4 w-24" />
                        <div className="skeleton-line h-4 w-20" />
                      </div>
                      <div className="skeleton-line h-4 w-full" />
                      <div className="skeleton-line h-4 w-3/4" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
