'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import UnreadBadge from '@/components/chat/UnreadBadge'
import InnerPageHeader from '@/components/InnerPageHeader'
import { getBootstrapUser } from '@/lib/auth'
import { getUnreadCountsByThread, type UnreadCountsByThread } from '@/lib/chat/reads'
import { COACH_USER_ID } from '@/lib/constants'
import { formatChatThreadActivityLabel } from '@/lib/format'
import {
  type ChatThreadLastMessage,
  type ClubThread,
  getClubThread,
  type DirectCoachThreadItem,
  getCoachDirectThreads,
  getDirectCoachThread,
  loadChatThreadLastMessage,
  getOrCreateCoachDirectThreadForStudent,
  getOrCreateDirectCoachThread,
  getStudents,
  type CoachDirectThreadItem,
  type StudentProfile,
} from '@/lib/chat/threads'
import { prefetchRecentChatMessages } from '@/lib/chat'
import { ensureProfileExists, getProfileDisplayName } from '@/lib/profiles'
import { supabase } from '@/lib/supabase'

const CHAT_UNREAD_UPDATED_EVENT = 'chat-unread-updated'

function AvatarFallback() {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700">
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

function StudentAvatar({
  student,
}: {
  student: Pick<StudentProfile, 'avatar_url'>
}) {
  if (student.avatar_url) {
    return (
      <Image
        src={student.avatar_url}
        alt=""
        width={44}
        height={44}
        className="h-11 w-11 shrink-0 rounded-full object-cover"
      />
    )
  }

  return <AvatarFallback />
}

function ThreadAvatar({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-base font-semibold dark:bg-white/[0.08]">
      {children}
    </div>
  )
}

type MessageThreadListItem = {
  id: string
  href: string
  title: string
  preview: string
  timeLabel: string
  unreadCount: number
  lastActivityAt: number
  avatar: ReactNode
}

function getLastMessagePreview(
  lastMessage: ChatThreadLastMessage | null,
  fallbackText: string,
  {
    currentUserId = null,
    prefixSender = false,
  }: {
    currentUserId?: string | null
    prefixSender?: boolean
  } = {}
) {
  if (!lastMessage) {
    return fallbackText
  }

  const previewText = lastMessage.previewText || 'Новое сообщение'

  if (!prefixSender) {
    return previewText
  }

  const senderLabel =
    currentUserId && lastMessage.userId === currentUserId
      ? 'Вы'
      : lastMessage.senderDisplayName

  return `${senderLabel}: ${previewText}`
}

function ThreadListRow({
  item,
  onPrefetch,
}: {
  item: MessageThreadListItem
  onPrefetch: (threadId: string) => void
}) {
  return (
    <Link
      href={item.href}
      onPointerDown={() => onPrefetch(item.id)}
      onClick={() => onPrefetch(item.id)}
      className="app-card flex items-center gap-3 rounded-2xl border p-4 shadow-sm"
    >
      {item.avatar}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="app-text-primary truncate text-sm font-medium">{item.title}</p>
            <p
              className={`truncate text-xs ${
                item.unreadCount > 0 ? 'app-text-primary font-medium' : 'app-text-secondary'
              }`}
            >
              {item.preview}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {item.timeLabel ? (
              <span className="app-text-secondary text-[11px]">{item.timeLabel}</span>
            ) : null}
            <UnreadBadge count={item.unreadCount} />
          </div>
        </div>
      </div>
    </Link>
  )
}

export default function MessagesPage() {
  const router = useRouter()
  const processedInsertedMessageIdsRef = useRef<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [clubThread, setClubThread] = useState<ClubThread | null>(null)
  const [coachThread, setCoachThread] = useState<DirectCoachThreadItem | null>(null)
  const [directThreads, setDirectThreads] = useState<CoachDirectThreadItem[]>([])
  const [students, setStudents] = useState<StudentProfile[]>([])
  const [unreadCountsByThread, setUnreadCountsByThread] = useState<UnreadCountsByThread>({})
  const [error, setError] = useState('')
  const [openingCoachThread, setOpeningCoachThread] = useState(false)
  const [openingStudentId, setOpeningStudentId] = useState<string | null>(null)

  const isCoach = currentUserId === COACH_USER_ID

  function handlePrefetchThreadMessages(threadId: string) {
    void prefetchRecentChatMessages(10, threadId)
  }

  const directThreadByStudentId = useMemo(
    () =>
      Object.fromEntries(
        directThreads
          .filter((thread) => Boolean(thread.owner_user_id))
          .map((thread) => [thread.owner_user_id as string, thread])
      ) as Record<string, CoachDirectThreadItem>,
    [directThreads]
  )

  const threadListItems = useMemo(() => {
    const items: MessageThreadListItem[] = []

    if (clubThread) {
      items.push({
        id: clubThread.id,
        href: `/messages/${clubThread.id}`,
        title: 'Общий чат',
        preview: getLastMessagePreview(
          clubThread.lastMessage,
          'Пока нет сообщений',
          {
            currentUserId,
            prefixSender: true,
          }
        ),
        timeLabel: clubThread.lastMessage?.createdAt
          ? formatChatThreadActivityLabel(clubThread.lastMessage.createdAt)
          : '',
        unreadCount: unreadCountsByThread[clubThread.id] ?? 0,
        lastActivityAt: new Date(clubThread.lastMessage?.createdAt ?? clubThread.created_at).getTime(),
        avatar: <ThreadAvatar>#</ThreadAvatar>,
      })
    }

    if (!isCoach && coachThread) {
      items.push({
        id: coachThread.id,
        href: `/messages/${coachThread.id}`,
        title: 'Связь с тренером',
        preview: getLastMessagePreview(coachThread.lastMessage, 'Личный чат со своим тренером'),
        timeLabel: coachThread.lastMessage?.createdAt
          ? formatChatThreadActivityLabel(coachThread.lastMessage.createdAt)
          : '',
        unreadCount: unreadCountsByThread[coachThread.id] ?? 0,
        lastActivityAt: new Date(coachThread.lastMessage?.createdAt ?? coachThread.created_at).getTime(),
        avatar: <ThreadAvatar>C</ThreadAvatar>,
      })
    }

    if (isCoach) {
      directThreads.forEach((thread) => {
        items.push({
          id: thread.id,
          href: `/messages/${thread.id}`,
          title: getProfileDisplayName(thread.student, 'Ученик'),
          preview: getLastMessagePreview(thread.lastMessage, 'Личный чат'),
          timeLabel: thread.lastMessage?.createdAt
            ? formatChatThreadActivityLabel(thread.lastMessage.createdAt)
            : '',
          unreadCount: unreadCountsByThread[thread.id] ?? 0,
          lastActivityAt: new Date(thread.lastMessage?.createdAt ?? thread.created_at).getTime(),
          avatar: (
            <StudentAvatar
              student={{
                avatar_url: thread.student?.avatar_url ?? null,
              }}
            />
          ),
        })
      })
    }

    return items.sort((left, right) => right.lastActivityAt - left.lastActivityAt)
  }, [clubThread, coachThread, currentUserId, directThreads, isCoach, unreadCountsByThread])

  const knownThreadIdsSignature = useMemo(
    () =>
      [
        ...(clubThread ? [clubThread.id] : []),
        ...(coachThread ? [coachThread.id] : []),
        ...directThreads.map((thread) => thread.id),
      ].join(','),
    [clubThread?.id, coachThread?.id, directThreads]
  )

  useEffect(() => {
    let isMounted = true

    async function loadPage() {
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

        const [clubThread, unreadCounts] = await Promise.all([
          getClubThread(),
          getUnreadCountsByThread(),
        ])

        if (!isMounted) {
          return
        }

        setClubThread(clubThread)
        setUnreadCountsByThread(unreadCounts)

        if (user.id === COACH_USER_ID) {
          const [coachThreads, registeredStudents] = await Promise.all([
            getCoachDirectThreads(),
            getStudents(),
          ])

          if (!isMounted) {
            return
          }

          setDirectThreads(coachThreads)
          setStudents(registeredStudents)
        } else {
          const directCoachThread = await getDirectCoachThread(user.id)

          if (!isMounted) {
            return
          }

          setCoachThread(directCoachThread)
        }

        setError('')
      } catch {
        if (isMounted) {
          setError('Не удалось загрузить сообщения')
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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const totalUnreadCount = Object.values(unreadCountsByThread).reduce((total, count) => total + count, 0)
    window.dispatchEvent(
      new CustomEvent(CHAT_UNREAD_UPDATED_EVENT, {
        detail: {
          count: totalUnreadCount,
        },
      })
    )
  }, [unreadCountsByThread])

  useEffect(() => {
    if (loading || !currentUserId) {
      return
    }

    const knownThreadIds = new Set(
      knownThreadIdsSignature
        .split(',')
        .map((threadId) => threadId.trim())
        .filter(Boolean)
    )

    const channel = supabase
      .channel('messages-list:chat-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
        },
        async (payload) => {
          const nextMessageId = String((payload.new as { id?: string } | null)?.id ?? '')

          if (!nextMessageId || processedInsertedMessageIdsRef.current.has(nextMessageId)) {
            return
          }

          processedInsertedMessageIdsRef.current.add(nextMessageId)

          if (processedInsertedMessageIdsRef.current.size > 200) {
            const recentIds = Array.from(processedInsertedMessageIdsRef.current).slice(-100)
            processedInsertedMessageIdsRef.current = new Set(recentIds)
          }

          try {
            const nextMessage = await loadChatThreadLastMessage(nextMessageId)

            if (!nextMessage) {
              return
            }

            const isKnownThread = knownThreadIds.has(nextMessage.threadId)

            setClubThread((currentThread) =>
              currentThread?.id === nextMessage.threadId
                ? {
                    ...currentThread,
                    lastMessage: nextMessage,
                  }
                : currentThread
            )

            setCoachThread((currentThread) =>
              currentThread?.id === nextMessage.threadId
                ? {
                    ...currentThread,
                    lastMessage: nextMessage,
                  }
                : currentThread
            )

            setDirectThreads((currentThreads) =>
              currentThreads.map((thread) =>
                thread.id === nextMessage.threadId
                  ? {
                      ...thread,
                      lastMessage: nextMessage,
                    }
                  : thread
              )
            )

            if (isKnownThread && nextMessage.userId !== currentUserId) {
              setUnreadCountsByThread((currentCounts) => ({
                ...currentCounts,
                [nextMessage.threadId]: (currentCounts[nextMessage.threadId] ?? 0) + 1,
              }))
            }
          } catch {
            processedInsertedMessageIdsRef.current.delete(nextMessageId)
          }
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [currentUserId, knownThreadIdsSignature, loading])

  async function handleOpenCoachChat() {
    if (!currentUserId || openingCoachThread) {
      return
    }

    if (coachThread) {
      router.push(`/messages/${coachThread.id}`)
      return
    }

    setOpeningCoachThread(true)
    setError('')

    try {
      const thread = await getOrCreateDirectCoachThread(currentUserId)
      router.push(`/messages/${thread.id}`)
    } catch {
      setError('Не удалось открыть чат с тренером')
    } finally {
      setOpeningCoachThread(false)
    }
  }

  async function handleOpenStudentThread(studentId: string) {
    if (openingStudentId) {
      return
    }

    const existingThread = directThreadByStudentId[studentId]

    if (existingThread) {
      router.push(`/messages/${existingThread.id}`)
      return
    }

    setOpeningStudentId(studentId)
    setError('')

    try {
      const thread = await getOrCreateCoachDirectThreadForStudent(studentId)

      setDirectThreads((currentThreads) => {
        if (currentThreads.some((currentThread) => currentThread.id === thread.id)) {
          return currentThreads
        }

        const student = students.find((currentStudent) => currentStudent.id === studentId) ?? null

        return [
          {
            ...thread,
            lastMessage: null,
            student,
          },
          ...currentThreads,
        ]
      })

      router.push(`/messages/${thread.id}`)
    } catch {
      setError('Не удалось открыть личный чат')
    } finally {
      setOpeningStudentId(null)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen pb-[calc(96px+env(safe-area-inset-bottom))] md:pb-0">
        <div className="mx-auto max-w-xl px-4 pb-4 pt-4">
          <InnerPageHeader title="Сообщения" />
          <div className="space-y-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="app-card rounded-2xl border p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-full skeleton-line" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="skeleton-line h-4 w-28" />
                    <div className="skeleton-line h-4 w-20" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen pb-[calc(96px+env(safe-area-inset-bottom))] md:pb-0">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4">
        <InnerPageHeader title="Сообщения" />

        {error ? (
          <section className="app-card mb-4 rounded-2xl border p-4 shadow-sm">
            <p className="text-sm text-red-600">{error}</p>
          </section>
        ) : null}

        <div className="space-y-3">
          {threadListItems.map((item) => (
            <ThreadListRow
              key={item.id}
              item={item}
              onPrefetch={handlePrefetchThreadMessages}
            />
          ))}

          {!isCoach && !coachThread ? (
            <button
              type="button"
              onClick={() => {
                void handleOpenCoachChat()
              }}
              disabled={openingCoachThread}
              className="app-card flex w-full items-center gap-3 rounded-2xl border p-4 text-left shadow-sm disabled:opacity-60"
            >
              <ThreadAvatar>C</ThreadAvatar>
              <div className="min-w-0 flex-1">
                <p className="app-text-primary text-sm font-medium">Связь с тренером</p>
                <p className="app-text-secondary text-xs">
                  {openingCoachThread ? 'Открываем чат...' : 'Личный чат со своим тренером'}
                </p>
              </div>
            </button>
          ) : null}

          {isCoach ? (
            <section className="app-card rounded-2xl border p-4 shadow-sm">
              <div className="mb-3">
                <h2 className="app-text-primary text-base font-semibold">Ученики</h2>
                <p className="app-text-secondary mt-1 text-xs">Зарегистрированные участники клуба.</p>
              </div>

              {students.length === 0 ? (
                <p className="app-text-secondary text-sm">Пока нет зарегистрированных учеников.</p>
              ) : (
                <div className="space-y-2">
                  {students.map((student) => {
                    const existingThread = directThreadByStudentId[student.id]
                    const isOpeningThisStudent = openingStudentId === student.id

                    return (
                      <div
                        key={student.id}
                        className="flex items-center gap-3 rounded-2xl border border-black/[0.05] px-3 py-3 dark:border-white/[0.08]"
                      >
                        <StudentAvatar student={student} />
                        <div className="min-w-0 flex-1">
                          <p className="app-text-primary truncate text-sm font-medium">
                            {getProfileDisplayName(student, 'Ученик')}
                          </p>
                          <p className="app-text-secondary truncate text-xs">
                            {student.nickname?.trim() || 'Профиль участника'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void handleOpenStudentThread(student.id)
                          }}
                          disabled={isOpeningThisStudent}
                          className="app-button-secondary min-h-10 rounded-full border px-3 py-2 text-xs font-medium disabled:opacity-60"
                        >
                          {isOpeningThisStudent ? '...' : existingThread ? 'Открыть' : 'Начать'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          ) : null}
        </div>
        <p className="app-text-secondary mt-4 text-center text-[11px] opacity-70">
          chat build: stable-chat
        </p>
      </div>
    </main>
  )
}
