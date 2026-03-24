'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ChatMessageActions from '@/components/chat/ChatMessageActions'
import { getBootstrapUser } from '@/lib/auth'
import {
  CHAT_MESSAGE_MAX_LENGTH,
  createChatMessage,
  loadChatReadState,
  loadChatMessageItem,
  loadOlderChatMessages,
  loadRecentChatMessages,
  softDeleteChatMessage,
  type ChatMessageItem,
  upsertChatReadState,
} from '@/lib/chat'
import { ensureProfileExists } from '@/lib/profiles'
import { supabase } from '@/lib/supabase'

type ChatSectionProps = {
  showTitle?: boolean
}

const LONG_PRESS_MS = 450
const INITIAL_CHAT_MESSAGE_LIMIT = 10
const OLDER_CHAT_BATCH_LIMIT = 10
const MAX_RENDERED_CHAT_MESSAGES = 60
const CHAT_APP_HEIGHT_CSS_VAR = '--chat-app-height'

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

function removeMessageById(messages: ChatMessageItem[], messageId: string) {
  return messages.filter((message) => message.id !== messageId)
}

function ChatMessageBody({
  message,
  isOwnMessage = false,
  showSenderName = true,
}: {
  message: ChatMessageItem
  isOwnMessage?: boolean
  showSenderName?: boolean
}) {
  return (
    <>
      {showSenderName ? (
        <p
          className={`truncate text-[11px] font-medium ${
            isOwnMessage ? 'app-text-secondary text-right' : 'app-text-primary'
          }`}
        >
          {message.displayName}
        </p>
      ) : null}
      {message.replyTo ? (
        <div
          className={`mt-1 rounded-[14px] px-2.5 py-1.5 ${
            isOwnMessage
              ? 'bg-black/[0.04] dark:bg-white/[0.07]'
              : 'bg-black/[0.03] dark:bg-white/[0.05]'
          }`}
        >
          <p className="app-text-primary truncate text-xs font-medium">{message.replyTo.displayName}</p>
          <p className="app-text-secondary truncate text-xs">{message.replyTo.text}</p>
        </div>
      ) : null}
      <p
        className={`app-text-primary break-words whitespace-pre-wrap text-sm leading-6 ${
          message.replyTo ? 'mt-1' : showSenderName ? 'mt-0.5' : ''
        } ${
          isOwnMessage ? 'text-right' : ''
        }`}
      >
        {message.text}
      </p>
      <p className={`app-text-secondary mt-1 text-xs ${isOwnMessage ? 'text-right' : ''}`}>
        {message.createdAtLabel}
      </p>
    </>
  )
}

export default function ChatSection({
  showTitle = true,
}: ChatSectionProps) {
  const router = useRouter()
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const messageRefs = useRef<Record<string, HTMLElement | null>>({})
  const messagesRef = useRef<ChatMessageItem[]>([])
  const pendingDeletedMessageIdsRef = useRef<Set<string>>(new Set())
  const longPressTimeoutRef = useRef<number | null>(null)
  const isMarkingReadRef = useRef(false)
  const pendingAutoScrollToBottomRef = useRef(false)
  const prependScrollRestoreRef = useRef<{ scrollHeight: number; scrollTop: number | null } | null>(null)
  const isLoadingOlderMessagesRef = useRef(false)
  const focusedGestureStartScrollTopRef = useRef<number | null>(null)
  const focusedGestureStartClientYRef = useRef<number | null>(null)
  const focusedGestureBlurredRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const [lastReadAt, setLastReadAt] = useState<string | null>(null)
  const [hasLoadedReadState, setHasLoadedReadState] = useState(false)
  const [pendingInitialScroll, setPendingInitialScroll] = useState(false)
  const [pendingNewMessagesCount, setPendingNewMessagesCount] = useState(0)
  const [hasMoreOlderMessages, setHasMoreOlderMessages] = useState(true)
  const [error, setError] = useState('')
  const [draftMessage, setDraftMessage] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)
  const [selectedMessage, setSelectedMessage] = useState<ChatMessageItem | null>(null)
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false)
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessageItem | null>(null)
  const [isComposerFocused, setIsComposerFocused] = useState(false)

  const trimmedDraftMessage = draftMessage.trim()
  const isMessageTooLong = trimmedDraftMessage.length > CHAT_MESSAGE_MAX_LENGTH
  const latestLoadedMessageCreatedAt = messages.length > 0 ? messages[messages.length - 1]?.createdAt ?? null : null
  const oldestLoadedMessageCreatedAt = messages.length > 0 ? messages[0]?.createdAt ?? null : null
  const firstUnreadMessageId = (() => {
    if (messages.length === 0) {
      return null
    }

    if (!lastReadAt) {
      return null
    }

    const lastReadAtMs = new Date(lastReadAt).getTime()
    return messages.find((message) => new Date(message.createdAt).getTime() > lastReadAtMs)?.id ?? null
  })()

  const keepLatestRenderedMessages = useCallback((nextMessages: ChatMessageItem[]) => {
    const filteredMessages = filterPendingDeletedMessages(nextMessages)

    if (filteredMessages.length <= MAX_RENDERED_CHAT_MESSAGES) {
      return filteredMessages
    }

    return filteredMessages.slice(-MAX_RENDERED_CHAT_MESSAGES)
  }, [])

  const refreshMessages = useCallback(async () => {
    try {
      const recentMessages = await loadRecentChatMessages(50)
      setMessages(keepLatestRenderedMessages(recentMessages))
      setError('')
      return recentMessages
    } catch {
      setError('Не удалось загрузить чат')
      return null
    }
  }, [keepLatestRenderedMessages])

  const setMessageRef = useCallback((messageId: string, node: HTMLElement | null) => {
    if (node) {
      messageRefs.current[messageId] = node
      return
    }

    delete messageRefs.current[messageId]
  }, [])

  const isNearBottom = useCallback(() => {
    if (typeof window === 'undefined') {
      return false
    }

    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer) {
      return true
    }

    const distanceFromBottom =
      scrollContainer.scrollHeight - (scrollContainer.scrollTop + scrollContainer.clientHeight)

    return distanceFromBottom <= 100
  }, [])

  const scrollPageToBottom = useCallback(() => {
    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer) {
      return
    }

    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior: 'auto',
    })
  }, [])

  function getNewMessagesLabel(count: number) {
    return count === 1 ? '1 new message' : `${count} new messages`
  }

  function filterPendingDeletedMessages(nextMessages: ChatMessageItem[]) {
    if (pendingDeletedMessageIdsRef.current.size === 0) {
      return nextMessages
    }

    return nextMessages.filter((message) => !pendingDeletedMessageIdsRef.current.has(message.id))
  }

  const prependMessages = useCallback((
    currentMessages: ChatMessageItem[],
    olderMessages: ChatMessageItem[],
  ) => {
    const seenMessageIds = new Set(currentMessages.map((message) => message.id))
    const uniqueOlderMessages = filterPendingDeletedMessages(olderMessages).filter(
      (message) => !seenMessageIds.has(message.id)
    )

    const nextMessages = [...uniqueOlderMessages, ...currentMessages]

    if (nextMessages.length <= MAX_RENDERED_CHAT_MESSAGES) {
      return nextMessages
    }

    return nextMessages.slice(0, MAX_RENDERED_CHAT_MESSAGES)
  }, [])

  const markMessagesRead = useCallback(async (nextLastReadAt: string) => {
    if (!currentUserId || document.visibilityState !== 'visible') {
      return
    }

    const nextLastReadAtMs = new Date(nextLastReadAt).getTime()
    const currentLastReadAtMs = lastReadAt ? new Date(lastReadAt).getTime() : null

    if ((currentLastReadAtMs ?? 0) >= nextLastReadAtMs || isMarkingReadRef.current) {
      return
    }

    isMarkingReadRef.current = true

    try {
      const { error: upsertError } = await upsertChatReadState(currentUserId, nextLastReadAt)

      if (upsertError) {
        throw upsertError
      }

      setLastReadAt((currentLastReadValue) => {
        if (!currentLastReadValue || new Date(currentLastReadValue).getTime() < nextLastReadAtMs) {
          return nextLastReadAt
        }

        return currentLastReadValue
      })
    } catch {
      // Keep read tracking non-blocking for the chat experience.
    } finally {
      isMarkingReadRef.current = false
    }
  }, [currentUserId, lastReadAt])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    document.documentElement.dataset.chatIsolatedRoute = 'true'
    document.body.dataset.chatIsolatedRoute = 'true'

    return () => {
      delete document.documentElement.dataset.chatIsolatedRoute
      delete document.body.dataset.chatIsolatedRoute
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }

    const rootStyle = document.documentElement.style

    function updateChatAppHeight() {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight
      rootStyle.setProperty(CHAT_APP_HEIGHT_CSS_VAR, `${Math.round(viewportHeight)}px`)
    }

    updateChatAppHeight()

    window.visualViewport?.addEventListener('resize', updateChatAppHeight)
    window.addEventListener('resize', updateChatAppHeight)

    return () => {
      window.visualViewport?.removeEventListener('resize', updateChatAppHeight)
      window.removeEventListener('resize', updateChatAppHeight)
      rootStyle.removeProperty(CHAT_APP_HEIGHT_CSS_VAR)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (longPressTimeoutRef.current !== null) {
        window.clearTimeout(longPressTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!selectedMessage) {
      return
    }

    if (!messages.some((message) => message.id === selectedMessage.id)) {
      setSelectedMessage(null)
      setIsActionSheetOpen(false)
    }
  }, [messages, selectedMessage])

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

        if (!isMounted) {
          return
        }

        const initialMessages = await loadRecentChatMessages(INITIAL_CHAT_MESSAGE_LIMIT)
        let nextLastReadAt: string | null = null

        try {
          nextLastReadAt = await loadChatReadState(user.id)
        } catch (readStateError) {
          console.error('Failed to load chat read state', readStateError)
          nextLastReadAt = null
        }

        if (!isMounted) {
          return
        }

        setMessages(keepLatestRenderedMessages(initialMessages))
        setError('')
        setLastReadAt(nextLastReadAt)
        setHasLoadedReadState(true)
        setHasMoreOlderMessages(initialMessages.length === INITIAL_CHAT_MESSAGE_LIMIT)
        setPendingInitialScroll(true)
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
  }, [keepLatestRenderedMessages, router])

  useLayoutEffect(() => {
    if (loading || !hasLoadedReadState || !pendingInitialScroll) {
      return
    }

    if (messages.length === 0) {
      return
    }

    scrollPageToBottom()
    setPendingInitialScroll(false)
  }, [hasLoadedReadState, loading, messages.length, pendingInitialScroll, scrollPageToBottom])

  useEffect(() => {
    if (loading || !isAuthenticated) {
      return
    }

    function handleWindowFocus() {
      void refreshMessages()
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void refreshMessages()
      }
    }

    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loading, isAuthenticated, refreshMessages])

  useEffect(() => {
    if (
      loading ||
      !isAuthenticated ||
      !hasLoadedReadState ||
      !currentUserId ||
      !latestLoadedMessageCreatedAt ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return
    }

    const bottomSentinel = bottomSentinelRef.current

    if (!bottomSentinel) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return
        }

        void markMessagesRead(latestLoadedMessageCreatedAt)
      },
      {
        root: scrollContainerRef.current,
        threshold: 0.1,
      }
    )

    observer.observe(bottomSentinel)

    return () => {
      observer.disconnect()
    }
  }, [
    currentUserId,
    hasLoadedReadState,
    isAuthenticated,
    latestLoadedMessageCreatedAt,
    loading,
    markMessagesRead,
  ])

  useEffect(() => {
    if (!pendingAutoScrollToBottomRef.current || messages.length === 0) {
      return
    }

    let nestedAnimationFrameId: number | null = null
    const animationFrameId = window.requestAnimationFrame(() => {
      nestedAnimationFrameId = window.requestAnimationFrame(() => {
        scrollPageToBottom()
        pendingAutoScrollToBottomRef.current = false
      })
    })

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      if (nestedAnimationFrameId !== null) {
        window.cancelAnimationFrame(nestedAnimationFrameId)
      }
    }
  }, [messages, scrollPageToBottom])

  useEffect(() => {
    const pendingRestore = prependScrollRestoreRef.current

    if (!pendingRestore) {
      return
    }

    let nestedAnimationFrameId: number | null = null
    const animationFrameId = window.requestAnimationFrame(() => {
      nestedAnimationFrameId = window.requestAnimationFrame(() => {
        const scrollContainer = scrollContainerRef.current

        if (!scrollContainer || pendingRestore.scrollTop === null) {
          prependScrollRestoreRef.current = null
          return
        }

        const scrollHeightDelta = scrollContainer.scrollHeight - pendingRestore.scrollHeight
        scrollContainer.scrollTop = Math.max(0, pendingRestore.scrollTop + scrollHeightDelta)
        prependScrollRestoreRef.current = null
      })
    })

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      if (nestedAnimationFrameId !== null) {
        window.cancelAnimationFrame(nestedAnimationFrameId)
      }
    }
  }, [messages])

  useEffect(() => {
    if (pendingNewMessagesCount === 0) {
      return
    }

    function handleScroll() {
      if (isNearBottom()) {
        setPendingNewMessagesCount(0)
      }
    }

    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer) {
      return
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll)

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [isNearBottom, pendingNewMessagesCount])

  useEffect(() => {
    if (
      loading ||
      !isAuthenticated ||
      !oldestLoadedMessageCreatedAt ||
      !hasMoreOlderMessages
    ) {
      return
    }

    async function loadOlderMessages() {
      const oldestCreatedAt = oldestLoadedMessageCreatedAt

      if (!oldestCreatedAt) {
        prependScrollRestoreRef.current = null
        return
      }

      const scrollContainer = scrollContainerRef.current

      if (!scrollContainer || scrollContainer.scrollTop > 80 || isLoadingOlderMessagesRef.current) {
        return
      }

      isLoadingOlderMessagesRef.current = true
      prependScrollRestoreRef.current = {
        scrollHeight: scrollContainer.scrollHeight,
        scrollTop: scrollContainer.scrollTop,
      }

      try {
        const olderMessages = await loadOlderChatMessages(oldestCreatedAt, OLDER_CHAT_BATCH_LIMIT)

        if (olderMessages.length === 0) {
          prependScrollRestoreRef.current = null
          setHasMoreOlderMessages(false)
          return
        }

        setHasMoreOlderMessages(olderMessages.length === OLDER_CHAT_BATCH_LIMIT)
        setMessages((currentMessages) => prependMessages(currentMessages, olderMessages))
      } catch {
        prependScrollRestoreRef.current = null
      } finally {
        isLoadingOlderMessagesRef.current = false
      }
    }

    function handleScroll() {
      void loadOlderMessages()
    }

    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer) {
      return
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [hasMoreOlderMessages, isAuthenticated, loading, oldestLoadedMessageCreatedAt, prependMessages])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const scrollContainer = scrollContainerRef.current

    if (!scrollContainer) {
      return
    }

    function resetFocusedGestureTracking() {
      focusedGestureStartScrollTopRef.current = null
      focusedGestureStartClientYRef.current = null
      focusedGestureBlurredRef.current = false
    }

    function handleTouchStart(event: TouchEvent) {
      if (!isComposerFocused || window.innerWidth >= 768) {
        resetFocusedGestureTracking()
        return
      }

      const activeScrollContainer = scrollContainerRef.current
      const touch = event.touches[0]

      if (!touch || !activeScrollContainer) {
        resetFocusedGestureTracking()
        return
      }

      focusedGestureStartScrollTopRef.current = activeScrollContainer.scrollTop
      focusedGestureStartClientYRef.current = touch.clientY
      focusedGestureBlurredRef.current = false
    }

    function handleTouchMove(event: TouchEvent) {
      if (!isComposerFocused || focusedGestureBlurredRef.current) {
        return
      }

      const activeScrollContainer = scrollContainerRef.current
      const touch = event.touches[0]
      const gestureStartScrollTop = focusedGestureStartScrollTopRef.current
      const gestureStartClientY = focusedGestureStartClientYRef.current
      const textarea = composerTextareaRef.current

      if (!touch || !activeScrollContainer || gestureStartScrollTop === null || gestureStartClientY === null || !textarea) {
        return
      }

      const dragDistance = touch.clientY - gestureStartClientY
      const scrollDelta = gestureStartScrollTop - activeScrollContainer.scrollTop
      const isIntentionalUpwardScroll = dragDistance > 18 && scrollDelta > 24

      if (!isIntentionalUpwardScroll) {
        return
      }

      focusedGestureBlurredRef.current = true
      textarea.blur()
    }

    scrollContainer.addEventListener('touchstart', handleTouchStart, { passive: true })
    scrollContainer.addEventListener('touchmove', handleTouchMove, { passive: true })
    scrollContainer.addEventListener('touchend', resetFocusedGestureTracking, { passive: true })
    scrollContainer.addEventListener('touchcancel', resetFocusedGestureTracking, { passive: true })

    return () => {
      scrollContainer.removeEventListener('touchstart', handleTouchStart)
      scrollContainer.removeEventListener('touchmove', handleTouchMove)
      scrollContainer.removeEventListener('touchend', resetFocusedGestureTracking)
      scrollContainer.removeEventListener('touchcancel', resetFocusedGestureTracking)
    }
  }, [isComposerFocused])

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
          const shouldAutoScroll = isNearBottom()

          if (!nextMessageId) {
            return
          }

          if (messagesRef.current.some((message) => message.id === nextMessageId)) {
            return
          }

          if (pendingDeletedMessageIdsRef.current.has(nextMessageId)) {
            return
          }

          try {
            const nextMessage = await loadChatMessageItem(nextMessageId)

            if (!nextMessage) {
              return
            }

            if (shouldAutoScroll) {
              pendingAutoScrollToBottomRef.current = true
              setPendingNewMessagesCount(0)
            } else {
              setPendingNewMessagesCount((currentCount) => currentCount + 1)
            }

            setMessages((currentMessages) =>
              keepLatestRenderedMessages(insertMessageChronologically(currentMessages, nextMessage))
            )
          } catch {
            void refreshMessages()
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
              pendingDeletedMessageIdsRef.current.delete(nextMessageId)
              setMessages((currentMessages) => removeMessageById(currentMessages, nextMessageId))
              return
            }

            if (pendingDeletedMessageIdsRef.current.has(nextMessageId)) {
              return
            }

            setMessages((currentMessages) =>
              keepLatestRenderedMessages(upsertMessageById(currentMessages, nextMessage))
            )
          } catch {
            // Keep realtime additive and non-blocking if enrichment fails.
          }
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [isNearBottom, keepLatestRenderedMessages, loading, isAuthenticated, refreshMessages])

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
      const { error: insertError } = await createChatMessage(currentUserId, trimmedDraftMessage, replyingToMessage?.id ?? null)

      if (insertError) {
        throw insertError
      }

      const recentMessages = await loadRecentChatMessages(50)
      pendingAutoScrollToBottomRef.current = true
      setPendingNewMessagesCount(0)
      setMessages(keepLatestRenderedMessages(recentMessages))
      setDraftMessage('')
      setReplyingToMessage(null)
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
    pendingDeletedMessageIdsRef.current.add(message.id)
    setMessages((currentMessages) => removeMessageById(currentMessages, message.id))

    try {
      const { error: deleteError } = await softDeleteChatMessage(message.id, currentUserId)

      if (deleteError) {
        throw deleteError
      }

    } catch {
      pendingDeletedMessageIdsRef.current.delete(message.id)
      setMessages((currentMessages) =>
        keepLatestRenderedMessages(insertMessageChronologically(currentMessages, message))
      )
      setError('Не удалось удалить сообщение')
    } finally {
      setDeletingMessageId(null)
    }
  }

  function handleActionSheetOpenChange(open: boolean) {
    setIsActionSheetOpen(open)

    if (!open) {
      setSelectedMessage(null)
    }
  }

  function handleReplyToMessage(message: ChatMessageItem) {
    setReplyingToMessage(message)
  }

  function clearLongPressTimeout() {
    if (longPressTimeoutRef.current !== null) {
      window.clearTimeout(longPressTimeoutRef.current)
      longPressTimeoutRef.current = null
    }
  }

  function renderComposer() {
    return (
      <div>
        {pendingNewMessagesCount > 0 ? (
          <div className="mb-2 flex justify-center md:justify-end">
            <button
              type="button"
              onClick={() => {
                setPendingNewMessagesCount(0)
                scrollPageToBottom()
              }}
              className="app-button-secondary min-h-11 rounded-full border px-4 py-2 text-sm font-medium shadow-sm"
            >
              {getNewMessagesLabel(pendingNewMessagesCount)}
            </button>
          </div>
        ) : null}
        <section className="rounded-[24px] border border-black/[0.06] bg-[color:var(--background)]/82 px-2 py-1.5 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-[color:var(--background)]/78">
          <form onSubmit={handleSubmit}>
            {replyingToMessage ? (
              <div className="mb-1.5 flex items-start justify-between gap-2.5 rounded-[18px] bg-black/[0.04] px-3 py-2 dark:bg-white/[0.06]">
                <div className="min-w-0">
                  <p className="app-text-primary truncate text-sm font-medium">{replyingToMessage.displayName}</p>
                  <p className="app-text-secondary truncate text-sm">{replyingToMessage.text}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyingToMessage(null)}
                  className="app-text-secondary shrink-0 rounded-full p-1.5 text-sm"
                  aria-label="Отменить ответ"
                >
                  X
                </button>
              </div>
            ) : null}
            <div className="flex items-end gap-1.5">
              <button
                type="button"
                className="app-button-secondary flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-base font-medium shadow-none"
                aria-label="Скоро: вложения"
              >
                +
              </button>
              <div className="app-input flex min-w-0 flex-1 items-end rounded-[22px] border px-3.5 py-1.5 shadow-none">
                <label htmlFor="chat-message" className="sr-only">
                  Сообщение
                </label>
                <textarea
                  ref={composerTextareaRef}
                  id="chat-message"
                  value={draftMessage}
                  onChange={(event) => {
                    setDraftMessage(event.target.value)
                    setSubmitError('')
                  }}
                  onFocus={() => setIsComposerFocused(true)}
                  onBlur={() => setIsComposerFocused(false)}
                  placeholder="Сообщение"
                  disabled={submitting}
                  maxLength={CHAT_MESSAGE_MAX_LENGTH}
                  rows={1}
                  className="min-h-0 max-h-24 w-full resize-none bg-transparent py-0.5 text-sm leading-5 outline-none placeholder:app-text-secondary"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !trimmedDraftMessage || isMessageTooLong}
                className="app-button-primary flex h-10 min-w-10 shrink-0 items-center justify-center rounded-full px-3.5 text-sm font-medium shadow-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? '...' : '>'}
              </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3 px-1">
              <p className="app-text-secondary text-xs">
                {trimmedDraftMessage.length}/{CHAT_MESSAGE_MAX_LENGTH}
              </p>
              {submitError ? <p className="text-xs text-red-600">{submitError}</p> : <span />}
            </div>
          </form>
        </section>
      </div>
    )
  }

  function startLongPress(message: ChatMessageItem) {
    clearLongPressTimeout()
    longPressTimeoutRef.current = window.setTimeout(() => {
      navigator.vibrate?.(10)
      setSelectedMessage(message)
      setIsActionSheetOpen(true)
      longPressTimeoutRef.current = null
    }, LONG_PRESS_MS)
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
    <div className="mx-auto flex h-full min-h-0 max-w-xl flex-col overflow-hidden px-4 pb-4 pt-4 md:max-w-none md:p-4">
      {showTitle ? (
        <div className="mb-4 space-y-1">
          <h1 className="app-text-primary text-2xl font-bold">Чат клуба</h1>
          <p className="app-text-secondary text-sm">Последние 50 сообщений клуба в хронологическом порядке.</p>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <>
          <div
            ref={scrollContainerRef}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto [WebkitOverflowScrolling:touch]"
          >
            <div className="flex min-h-full flex-col">
              {error ? (
                <section className="app-card flex flex-1 rounded-2xl border p-4 shadow-sm">
                  <p className="text-sm text-red-600">{error}</p>
                </section>
              ) : messages.length === 0 ? (
                <section className="app-card flex flex-1 flex-col rounded-2xl border p-4 shadow-sm">
                  <p className="app-text-secondary text-sm">Пока нет сообщений.</p>
                  <p className="app-text-secondary mt-2 text-sm">
                    Когда в базе появятся сообщения, они отобразятся здесь.
                  </p>
                </section>
              ) : (
                <section className="app-card flex flex-1 flex-col rounded-2xl border p-4 shadow-sm">
                  <div className="mt-auto flex flex-col">
                    {messages.map((message, index) => {
                      const isOwnMessage = currentUserId === message.userId
                      const previousMessage = index > 0 ? messages[index - 1] : null
                      const isSameAuthorAsPrevious = previousMessage?.userId === message.userId
                      const isFirstInAuthorRun = !isSameAuthorAsPrevious
                      const showAvatar = !isOwnMessage && isFirstInAuthorRun
                      const showSenderName = isOwnMessage ? isFirstInAuthorRun : isFirstInAuthorRun
                      const messageSpacingClass = index === 0 ? '' : isSameAuthorAsPrevious ? 'mt-1' : 'mt-4'

                      return (
                        <div
                          key={message.id}
                          ref={(node) => setMessageRef(message.id, node)}
                          className={messageSpacingClass}
                        >
                        {message.id === firstUnreadMessageId ? (
                          <div className="mb-3.5 flex items-center gap-3">
                            <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
                            <p className="app-text-secondary text-xs font-medium">Непрочитанные сообщения</p>
                            <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
                          </div>
                        ) : null}
                        <article className={`flex items-end gap-2.5 ${isOwnMessage ? 'justify-end' : ''}`}>
                          {isOwnMessage ? null : showAvatar ? message.avatarUrl ? (
                            <Image
                              src={message.avatarUrl}
                              alt=""
                              width={40}
                              height={40}
                              className="h-10 w-10 shrink-0 rounded-full object-cover"
                            />
                          ) : (
                            <AvatarFallback />
                          ) : (
                            <div className="h-10 w-10 shrink-0" aria-hidden="true" />
                          )}
                          <div
                            className={`chat-no-select min-w-0 w-full max-w-[85%] rounded-[18px] border px-3 py-2 shadow-none ${
                              isOwnMessage
                                ? 'ml-auto border-black/[0.05] bg-black/[0.035] dark:border-white/[0.08] dark:bg-white/[0.075]'
                                : 'border-black/[0.04] bg-black/[0.015] dark:border-white/[0.08] dark:bg-white/[0.035]'
                            }`}
                            onTouchStart={() => startLongPress(message)}
                            onTouchEnd={clearLongPressTimeout}
                            onTouchCancel={clearLongPressTimeout}
                            onTouchMove={clearLongPressTimeout}
                            onMouseDown={() => startLongPress(message)}
                            onMouseUp={clearLongPressTimeout}
                            onMouseLeave={clearLongPressTimeout}
                            onContextMenu={(event) => {
                              event.preventDefault()
                              clearLongPressTimeout()
                              setSelectedMessage(message)
                              setIsActionSheetOpen(true)
                            }}
                          >
                            <ChatMessageBody
                              message={message}
                              isOwnMessage={isOwnMessage}
                              showSenderName={showSenderName}
                            />
                          </div>
                        </article>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}
              <div ref={bottomSentinelRef} className="h-px w-full shrink-0" aria-hidden="true" />
            </div>
          </div>
          <div className="shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
            {renderComposer()}
          </div>
        </>
      </div>
      {selectedMessage && isActionSheetOpen ? (
        <div className="chat-no-select pointer-events-none fixed inset-x-4 top-[40svh] z-[60] mx-auto max-w-xl -translate-y-1/2 md:left-1/2 md:w-full md:max-w-md md:-translate-x-1/2">
          <div className="chat-no-select chat-selected-preview app-card rounded-2xl border px-4 py-3 shadow-lg ring-1 ring-black/10 dark:ring-white/10">
            <div className="flex items-start gap-3">
              {selectedMessage.avatarUrl ? (
                <Image
                  src={selectedMessage.avatarUrl}
                  alt=""
                  width={40}
                  height={40}
                  className="h-10 w-10 shrink-0 rounded-full object-cover"
                />
              ) : (
                <AvatarFallback />
              )}
              <div className="chat-no-select min-w-0 flex-1 rounded-2xl bg-black/[0.03] px-3 py-2 dark:bg-white/[0.08]">
                <ChatMessageBody message={selectedMessage} />
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {selectedMessage ? (
        <ChatMessageActions
          message={selectedMessage}
          currentUserId={currentUserId}
          open={isActionSheetOpen}
          onOpenChange={handleActionSheetOpenChange}
          onDelete={handleDeleteMessage}
          onReply={handleReplyToMessage}
        />
      ) : null}
    </div>
  )
}
