'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBootstrapUser } from '@/lib/auth'
import {
  CHAT_MESSAGE_MAX_LENGTH,
  createChatMessage,
  loadChatMessageItem,
  loadRecentChatMessages,
  softDeleteChatMessage,
  type ChatMessageItem,
} from '@/lib/chat'
import { ensureProfileExists } from '@/lib/profiles'
import { supabase } from '@/lib/supabase'

type ChatSectionProps = {
  showTitle?: boolean
  showBackLink?: boolean
}

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

function insertMessageChronologically(messages: ChatMessageItem[], nextMessage: ChatMessageItem) {
  if (messages.some((message) => message.id === nextMessage.id)) {
    return messages
  }

  return [...messages, nextMessage].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime()
    const rightTime = new Date(right.createdAt).getTime()

    if (leftTime === rightTime) {
      return left.id.localeCompare(right.id)
    }

    return leftTime - rightTime
  })
}

function upsertMessageById(messages: ChatMessageItem[], nextMessage: ChatMessageItem) {
  const existingIndex = messages.findIndex((message) => message.id === nextMessage.id)

  if (existingIndex === -1) {
    return insertMessageChronologically(messages, nextMessage)
  }

  const nextMessages = [...messages]
  nextMessages[existingIndex] = nextMessage

  return nextMessages.sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime()
    const rightTime = new Date(right.createdAt).getTime()

    if (leftTime === rightTime) {
      return left.id.localeCompare(right.id)
    }

    return leftTime - rightTime
  })
}

export default function ChatSection({ showTitle = true, showBackLink = false }: ChatSectionProps) {
  const router = useRouter()
  const messagesRef = useRef<ChatMessageItem[]>([])
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const [error, setError] = useState('')
  const [draftMessage, setDraftMessage] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)

  const trimmedDraftMessage = draftMessage.trim()
  const isMessageTooLong = trimmedDraftMessage.length > CHAT_MESSAGE_MAX_LENGTH

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

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
          setCurrentUserId(null)
          router.replace('/login')
          return
        }

        setIsAuthenticated(true)
        setCurrentUserId(user.id)
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

  useEffect(() => {
    if (loading || !isAuthenticated) {
      return
    }

    const channel = supabase
      .channel('chat-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
        },
        async (payload) => {
          const nextMessageId = String((payload.new as { id?: string } | null)?.id ?? '')

          if (!nextMessageId) {
            return
          }

          if (messagesRef.current.some((message) => message.id === nextMessageId)) {
            return
          }

          try {
            const nextMessage = await loadChatMessageItem(nextMessageId)

            if (!nextMessage) {
              return
            }

            setMessages((currentMessages) => insertMessageChronologically(currentMessages, nextMessage))
          } catch {
            // Keep realtime additive and non-blocking if enrichment fails.
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_messages',
        },
        async (payload) => {
          const nextMessageId = String((payload.new as { id?: string } | null)?.id ?? '')

          if (!nextMessageId) {
            return
          }

          try {
            const nextMessage = await loadChatMessageItem(nextMessageId)

            if (!nextMessage) {
              return
            }

            setMessages((currentMessages) => upsertMessageById(currentMessages, nextMessage))
          } catch {
            // Keep realtime additive and non-blocking if enrichment fails.
          }
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loading, isAuthenticated])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!currentUserId || submitting) {
      return
    }

    if (!trimmedDraftMessage) {
      setSubmitError('Введите сообщение')
      return
    }

    if (isMessageTooLong) {
      setSubmitError(`Сообщение должно быть не длиннее ${CHAT_MESSAGE_MAX_LENGTH} символов`)
      return
    }

    setSubmitting(true)
    setSubmitError('')

    try {
      const { error: insertError } = await createChatMessage(currentUserId, trimmedDraftMessage)

      if (insertError) {
        throw insertError
      }

      const recentMessages = await loadRecentChatMessages(50)
      setMessages(recentMessages)
      setDraftMessage('')
    } catch {
      setSubmitError('Не удалось отправить сообщение')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteMessage(message: ChatMessageItem) {
    if (!currentUserId || deletingMessageId || message.userId !== currentUserId || message.isDeleted) {
      return
    }

    const shouldDelete = typeof window === 'undefined'
      ? true
      : window.confirm('Удалить это сообщение?')

    if (!shouldDelete) {
      return
    }

    setDeletingMessageId(message.id)

    try {
      const { error: deleteError } = await softDeleteChatMessage(message.id, currentUserId)

      if (deleteError) {
        throw deleteError
      }

      setMessages((currentMessages) =>
        upsertMessageById(currentMessages, {
          ...message,
          text: 'Сообщение удалено',
          isDeleted: true,
        })
      )
    } catch {
      setError('Не удалось удалить сообщение')
    } finally {
      setDeletingMessageId(null)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:max-w-none md:p-4">
        {showTitle ? (
          <div className="mb-4 space-y-1">
            <h1 className="app-text-primary text-2xl font-bold">Чат клуба</h1>
            <p className="app-text-secondary text-sm">Последние 50 сообщений клуба в хронологическом порядке.</p>
          </div>
        ) : null}
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
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto flex min-h-[240px] max-w-xl items-center justify-center p-4 md:max-w-none">
        <Link href="/login" className="text-sm underline">
          Открыть вход
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:max-w-none md:p-4">
      {showTitle ? (
        <div className="mb-4 space-y-1">
          <h1 className="app-text-primary text-2xl font-bold">Чат клуба</h1>
          <p className="app-text-secondary text-sm">Последние 50 сообщений клуба в хронологическом порядке.</p>
        </div>
      ) : null}

      <section className="app-card mb-4 rounded-2xl border p-4 shadow-sm">
        <form onSubmit={handleSubmit}>
          <label htmlFor="chat-message" className="sr-only">
            Сообщение
          </label>
          <textarea
            id="chat-message"
            value={draftMessage}
            onChange={(event) => {
              setDraftMessage(event.target.value)
              setSubmitError('')
            }}
            placeholder="Напиши сообщение клубу"
            disabled={submitting}
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            className="app-input min-h-24 w-full rounded-lg border px-3 py-2"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="app-text-secondary text-xs">
              {trimmedDraftMessage.length}/{CHAT_MESSAGE_MAX_LENGTH}
            </p>
            <button
              type="submit"
              disabled={submitting || !trimmedDraftMessage || isMessageTooLong}
              className="app-button-secondary min-h-11 rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Отправляем...' : 'Отправить'}
            </button>
          </div>
          {submitError ? <p className="mt-2 text-sm text-red-600">{submitError}</p> : null}
        </form>
      </section>

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
                    {currentUserId === message.userId && !message.isDeleted ? (
                      <button
                        type="button"
                        onClick={() => {
                          void handleDeleteMessage(message)
                        }}
                        disabled={deletingMessageId === message.id}
                        className="app-text-secondary text-xs underline disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingMessageId === message.id ? 'Удаляем...' : 'Удалить'}
                      </button>
                    ) : null}
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

      {showBackLink ? (
        <div className="mt-4">
          <Link href="/dashboard" className="app-text-secondary text-sm underline">
            Назад на главную
          </Link>
        </div>
      ) : null}
    </div>
  )
}
