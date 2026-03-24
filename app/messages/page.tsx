'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import InnerPageHeader from '@/components/InnerPageHeader'
import { getBootstrapUser } from '@/lib/auth'
import { COACH_USER_ID } from '@/lib/constants'
import {
  getClubThread,
  getCoachDirectThreads,
  getOrCreateCoachDirectThreadForStudent,
  getOrCreateDirectCoachThread,
  getStudents,
  type CoachDirectThreadItem,
  type StudentProfile,
} from '@/lib/chat/threads'
import { ensureProfileExists, getProfileDisplayName } from '@/lib/profiles'

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

function DirectThreadSummary({
  thread,
}: {
  thread: CoachDirectThreadItem
}) {
  const displayName = getProfileDisplayName(thread.student, 'Ученик')
  const secondaryText =
    thread.student?.nickname?.trim() && thread.student.nickname.trim() !== displayName
      ? thread.student.nickname.trim()
      : 'Личный чат'

  return (
    <div className="min-w-0">
      <p className="app-text-primary truncate text-sm font-medium">{displayName}</p>
      <p className="app-text-secondary truncate text-xs">{secondaryText}</p>
    </div>
  )
}

export default function MessagesPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [clubThreadId, setClubThreadId] = useState<string | null>(null)
  const [directThreads, setDirectThreads] = useState<CoachDirectThreadItem[]>([])
  const [students, setStudents] = useState<StudentProfile[]>([])
  const [error, setError] = useState('')
  const [openingCoachThread, setOpeningCoachThread] = useState(false)
  const [openingStudentId, setOpeningStudentId] = useState<string | null>(null)

  const isCoach = currentUserId === COACH_USER_ID

  const directThreadByStudentId = useMemo(
    () =>
      Object.fromEntries(
        directThreads
          .filter((thread) => Boolean(thread.owner_user_id))
          .map((thread) => [thread.owner_user_id as string, thread])
      ) as Record<string, CoachDirectThreadItem>,
    [directThreads]
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

        const clubThread = await getClubThread()

        if (!isMounted) {
          return
        }

        setClubThreadId(clubThread.id)

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

  async function handleOpenCoachChat() {
    if (!currentUserId || openingCoachThread) {
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
          {clubThreadId ? (
            <Link
              href={`/messages/${clubThreadId}`}
              className="app-card flex items-center gap-3 rounded-2xl border p-4 shadow-sm"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-base font-semibold dark:bg-white/[0.08]">
                #
              </div>
              <div className="min-w-0">
                <p className="app-text-primary text-sm font-medium">Общий чат</p>
                <p className="app-text-secondary text-xs">Общение для всех участников клуба</p>
              </div>
            </Link>
          ) : null}

          {!isCoach ? (
            <button
              type="button"
              onClick={() => {
                void handleOpenCoachChat()
              }}
              disabled={openingCoachThread}
              className="app-card flex w-full items-center gap-3 rounded-2xl border p-4 text-left shadow-sm disabled:opacity-60"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-base font-semibold dark:bg-white/[0.08]">
                C
              </div>
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
                <h2 className="app-text-primary text-base font-semibold">Личные чаты</h2>
                <p className="app-text-secondary mt-1 text-xs">Все диалоги тренера с учениками.</p>
              </div>

              {directThreads.length === 0 ? (
                <p className="app-text-secondary text-sm">Пока нет личных чатов.</p>
              ) : (
                <div className="space-y-2">
                  {directThreads.map((thread) => (
                    <Link
                      key={thread.id}
                      href={`/messages/${thread.id}`}
                      className="flex items-center gap-3 rounded-2xl border border-black/[0.05] px-3 py-3 dark:border-white/[0.08]"
                    >
                      <StudentAvatar
                        student={{
                          avatar_url: thread.student?.avatar_url ?? null,
                        }}
                      />
                      <DirectThreadSummary thread={thread} />
                    </Link>
                  ))}
                </div>
              )}
            </section>
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
      </div>
    </main>
  )
}
