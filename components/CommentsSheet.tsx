'use client'

import Image from 'next/image'
import { LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RunCommentItem } from '@/lib/run-comments'

type CommentsSheetProps = {
  open: boolean
  comments: RunCommentItem[]
  loading?: boolean
  error?: string
  submitting?: boolean
  onClose: () => void
  onRetry?: () => void
  onSubmitComment?: (comment: string) => Promise<void>
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

function formatCommentTimestamp(dateString: string) {
  const date = new Date(dateString)

  if (Number.isNaN(date.getTime())) {
    return 'только что'
  }

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()

  if (diffMs < 60 * 1000) {
    return 'только что'
  }

  const diffMinutes = Math.floor(diffMs / (60 * 1000))

  if (diffMinutes < 60) {
    if (diffMinutes === 1) {
      return '1 мин назад'
    }

    if (diffMinutes >= 2 && diffMinutes <= 4) {
      return `${diffMinutes} мин назад`
    }

    return `${diffMinutes} мин назад`
  }

  const diffHours = Math.floor(diffMinutes / 60)

  if (diffHours < 24) {
    if (diffHours === 1) {
      return '1 ч назад'
    }

    return `${diffHours} ч назад`
  }

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()

  if (isYesterday) {
    return `вчера ${date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    })}`
  }

  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  })
}

function CommentRow({ comment }: { comment: RunCommentItem }) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)
  const avatarSrc = comment.avatarUrl?.trim() ? comment.avatarUrl : null
  const showAvatarImage = Boolean(avatarSrc) && failedAvatarUrl !== avatarSrc
  const nicknameLabel = comment.nickname?.trim() ? `@${comment.nickname.trim()}` : null

  return (
    <div className="flex items-start gap-3">
      {showAvatarImage && avatarSrc ? (
        <Image
          src={avatarSrc}
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded-full object-cover"
          onError={() => setFailedAvatarUrl(avatarSrc)}
        />
      ) : (
        <AvatarFallback />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="app-text-primary truncate text-sm font-semibold">{comment.displayName}</p>
          {nicknameLabel ? (
            <p className="app-text-secondary truncate text-xs">{nicknameLabel}</p>
          ) : null}
          <p className="app-text-muted text-xs">{formatCommentTimestamp(comment.createdAt)}</p>
        </div>
        <p className="app-text-primary mt-1 break-words whitespace-pre-wrap text-sm leading-5">
          {comment.comment}
        </p>
      </div>
    </div>
  )
}

export default function CommentsSheet({
  open,
  comments,
  loading = false,
  error = '',
  submitting = false,
  onClose,
  onRetry,
  onSubmitComment,
}: CommentsSheetProps) {
  const [draft, setDraft] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [effectiveViewportHeight, setEffectiveViewportHeight] = useState<number | null>(() =>
    typeof window === 'undefined' ? null : window.innerHeight
  )
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const trimmedDraft = useMemo(() => draft.trim(), [draft])
  const sheetStyle = useMemo(
    () =>
      effectiveViewportHeight === null
        ? undefined
        : { maxHeight: `${Math.min(effectiveViewportHeight, 672)}px` },
    [effectiveViewportHeight]
  )

  useEffect(() => {
    if (!open) {
      return
    }

    const previousBodyOverflow = document.body.style.overflow
    const previousDocumentOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousDocumentOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  useEffect(() => {
    if (!open) {
      setDraft('')
      setSubmitError('')
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }

    function syncEffectiveViewportHeight() {
      const visualViewport = window.visualViewport
      const nextEffectiveViewportHeight = Math.round(
        (visualViewport?.height ?? window.innerHeight) + (visualViewport?.offsetTop ?? 0)
      )

      setEffectiveViewportHeight((currentHeight) =>
        currentHeight === nextEffectiveViewportHeight ? currentHeight : nextEffectiveViewportHeight
      )
    }

    syncEffectiveViewportHeight()

    window.visualViewport?.addEventListener('resize', syncEffectiveViewportHeight)
    window.visualViewport?.addEventListener('scroll', syncEffectiveViewportHeight)

    return () => {
      window.visualViewport?.removeEventListener('resize', syncEffectiveViewportHeight)
      window.visualViewport?.removeEventListener('scroll', syncEffectiveViewportHeight)
    }
  }, [open])

  useEffect(() => {
    const textarea = textareaRef.current

    if (!textarea) {
      return
    }

    textarea.style.height = '0px'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
  }, [draft])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!onSubmitComment || submitting) {
      return
    }

    if (!trimmedDraft) {
      setSubmitError('Введите сообщение')
      return
    }

    try {
      setSubmitError('')
      await onSubmitComment(trimmedDraft)
      setDraft('')
    } catch {
      setSubmitError('Не удалось отправить комментарий')
    }
  }

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 md:items-center md:justify-center md:p-4">
      <button
        type="button"
        aria-label="Закрыть комментарии"
        className="absolute inset-0"
        onClick={onClose}
      />
      <section
        className="app-card relative flex min-h-0 w-full flex-col overflow-hidden rounded-t-3xl shadow-xl md:max-w-lg md:rounded-3xl"
        style={sheetStyle}
      >
        <div className="shrink-0 px-4 pt-4">
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200 dark:bg-gray-700 md:hidden" />
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="app-text-primary text-base font-semibold">Комментарии</h2>
              <p className="app-text-secondary mt-1 text-sm">
                {loading ? 'Загружаем беседу...' : `${comments.length} сообщений`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="app-text-secondary min-h-11 shrink-0 rounded-xl px-3 py-2 text-sm font-medium"
            >
              Закрыть
            </button>
          </div>
        </div>

        <div
          ref={scrollContainerRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-4 scroll-smooth [overscroll-behavior-y:contain]"
        >
          {loading ? (
            <div className="space-y-4">
              <div className="app-text-secondary inline-flex items-center gap-2 text-sm">
                <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.9} />
                <span>Подтягиваем комментарии...</span>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 shrink-0 rounded-full skeleton-line" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="skeleton-line h-4 w-28" />
                  <div className="skeleton-line h-4 w-full" />
                  <div className="skeleton-line h-4 w-3/4" />
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 shrink-0 rounded-full skeleton-line" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="skeleton-line h-4 w-32" />
                  <div className="skeleton-line h-4 w-5/6" />
                </div>
              </div>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-200/70 px-4 py-4 dark:border-red-900/60">
              <p className="text-sm text-red-600">{error}</p>
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="app-text-primary mt-3 min-h-11 rounded-xl border px-4 py-2 text-sm font-medium"
                >
                  Попробовать снова
                </button>
              ) : null}
            </div>
          ) : comments.length === 0 ? (
            <div className="rounded-2xl border border-black/5 bg-black/[0.02] px-4 py-8 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <p className="app-text-primary text-sm font-medium">Пока нет комментариев</p>
              <p className="app-text-secondary mt-1 text-sm">Можно начать разговор первым.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {comments.map((comment) => (
                <CommentRow key={comment.id} comment={comment} />
              ))}
            </div>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="shrink-0 border-t border-black/5 bg-[var(--surface)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 dark:border-white/10"
        >
          <div className="flex items-end gap-2">
            <label htmlFor="feed-run-comment" className="sr-only">Сообщение</label>
            <textarea
              id="feed-run-comment"
              ref={textareaRef}
              rows={1}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                setSubmitError('')
              }}
              placeholder="Сообщение"
              disabled={submitting}
              enterKeyHint="send"
              className="app-input max-h-[120px] min-h-11 w-full resize-none rounded-2xl border px-4 py-3 text-base leading-5 outline-none [appearance:none] [-webkit-appearance:none] [-webkit-tap-highlight-color:transparent] transition-[border-color,box-shadow] focus:border-black/15 focus:outline-none focus:ring-2 focus:ring-black/10 focus-visible:outline-none dark:focus:border-white/20 dark:focus:ring-white/10 sm:text-sm"
            />
            <button
              type="submit"
              disabled={submitting || !trimmedDraft}
              className="app-button-secondary min-h-11 shrink-0 rounded-2xl border px-4 py-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-1.5">
                  <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.9} />
                  <span>...</span>
                </span>
              ) : 'Отпр.'}
            </button>
          </div>
          {submitError ? <p className="mt-2 text-sm text-red-600">{submitError}</p> : null}
        </form>
      </section>
    </div>
  )
}
