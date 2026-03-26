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
  const unreadRefreshTimeoutRef = useRef<number | null>(null)
  const isMarkingThreadReadRef = useRef(false)
  const pendingMarkThreadReadRef = useRef(false)
  const threadId = typeof params?.threadId === 'string' ? params.threadId : ''
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [threadTitle, setThreadTitle] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    return () => {
      if (markReadTimeoutRef.current !== null) {
        window.clearTimeout(markReadTimeoutRef.current)
      }
      if (unreadRefreshTimeoutRef.current !== null) {
        window.clearTimeout(unreadRefreshTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadThreadPage() {
      try {
        console.log('[thread-open-debug] loadThreadPage:start', {
          threadId,
        })

        const user = await getBootstrapUser()
        console.log('[thread-open-debug] getBootstrapUser:result', {
          threadId,
          userId: user?.id ?? null,
        })

        if (!isMounted) {
          return
        }

        if (!user) {
          router.replace('/login')
          return
        }

        setCurrentUserId(user.id)
        void ensureProfileExists(user)

        console.log('[thread-open-debug] getChatThreadById:before', {
          threadId,
          userId: user.id,
        })
        const thread = await getChatThreadById(threadId)
        console.log('[thread-open-debug] getChatThreadById:result', {
          threadId,
          userId: user.id,
          thread,
        })

        if (!isMounted) {
          return
        }

        if (!thread) {
          setError('Чат недоступен')
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
      } catch (error) {
        console.error('[thread-open-debug] loadThreadPage:error', {
          threadId,
          error,
        })
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

    function scheduleUnreadCountRefresh(delayMs = 500) {
      if (typeof window === 'undefined') {
        return
      }

      if (unreadRefreshTimeoutRef.current !== null) {
        window.clearTimeout(unreadRefreshTimeoutRef.current)
      }

      unreadRefreshTimeoutRef.current = window.setTimeout(() => {
        unreadRefreshTimeoutRef.current = null

        void getTotalUnreadCount()
          .then((totalUnreadCount) => {
            window.dispatchEvent(
              new CustomEvent(CHAT_UNREAD_UPDATED_EVENT, {
                detail: {
                  count: totalUnreadCount,
                },
              })
            )
          })
          .catch(() => {
            // Keep unread badge refresh non-blocking around thread open.
          })
      }, delayMs)
    }

    async function runMarkThreadAsRead() {
      if (isMarkingThreadReadRef.current) {
        pendingMarkThreadReadRef.current = true
        return
      }

      isMarkingThreadReadRef.current = true

      try {
        await markThreadAsRead(threadId)
        scheduleUnreadCountRefresh()
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
      if (unreadRefreshTimeoutRef.current !== null) {
        window.clearTimeout(unreadRefreshTimeoutRef.current)
        unreadRefreshTimeoutRef.current = null
      }

      pendingMarkThreadReadRef.current = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      void supabase.removeChannel(channel)
    }
  }, [currentUserId, error, loading, threadId])

  if (!loading && (error || !currentUserId || !threadId)) {
    return (
      <main className="min-h-screen px-4 pb-4 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-3xl">
          <InnerPageHeader title="Чат" fallbackHref="/messages" minimal />
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
      <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
        <InnerPageHeader title={threadTitle || ' '} fallbackHref="/messages" minimal />
        <div className="min-h-0 flex-1">
          <ChatSection
            showTitle={false}
            threadId={threadId}
            currentUserId={currentUserId}
            enableReadState={false}
          />
        </div>
      </div>
    </main>
  )
}
