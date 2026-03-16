'use client'

import Image from 'next/image'
import { useState } from 'react'
import type { RunCommentItem } from '@/lib/run-comments'

type RunCommentsSectionProps = {
  comments: RunCommentItem[]
  loading?: boolean
  error?: string
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
    return 'Дата неизвестна'
  }

  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function RunCommentsSection({
  comments,
  loading = false,
  error = '',
  onSubmitComment,
}: RunCommentsSectionProps) {
  const [comment, setComment] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const trimmedComment = comment.trim()

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!onSubmitComment || submitting) {
      return
    }

    if (!trimmedComment) {
      setSubmitError('Введите комментарий')
      return
    }

    setSubmitting(true)
    setSubmitError('')

    try {
      await onSubmitComment(trimmedComment)
      setComment('')
    } catch {
      setSubmitError('Не удалось отправить комментарий')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="app-card rounded-2xl border p-4 shadow-sm">
      <h2 className="app-text-primary text-base font-semibold">Комментарии</h2>
      {onSubmitComment ? (
        <form onSubmit={handleSubmit} className="mt-4">
          <label htmlFor="run-comment" className="sr-only">Комментарий</label>
          <textarea
            id="run-comment"
            value={comment}
            onChange={(event) => {
              setComment(event.target.value)
              setSubmitError('')
            }}
            placeholder="Напиши комментарий"
            disabled={submitting}
            className="app-input min-h-24 w-full rounded-lg border px-3 py-2"
          />
          {submitError ? <p className="mt-2 text-sm text-red-600">{submitError}</p> : null}
          <div className="mt-3 flex justify-end">
            <button
              type="submit"
              disabled={submitting || !trimmedComment}
              className="app-button-secondary min-h-11 rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Отправляем...' : 'Отправить'}
            </button>
          </div>
        </form>
      ) : null}
      {loading ? (
        <div className="mt-4 space-y-4">
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
              <div className="skeleton-line h-4 w-24" />
              <div className="skeleton-line h-4 w-5/6" />
            </div>
          </div>
        </div>
      ) : error ? (
        <p className="mt-4 text-sm text-red-600">{error}</p>
      ) : comments.length === 0 ? (
        <p className="app-text-secondary mt-4 text-sm">Пока нет комментариев</p>
      ) : (
        <div className="mt-4 space-y-4">
          {comments.map((comment) => (
            <div key={comment.id} className="flex items-start gap-3">
              {comment.avatarUrl ? (
                <Image
                  src={comment.avatarUrl}
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
                  <p className="app-text-primary truncate font-semibold">{comment.displayName}</p>
                  <p className="app-text-secondary text-xs">{formatCommentTimestamp(comment.createdAt)}</p>
                </div>
                <p className="app-text-primary mt-1 break-words whitespace-pre-wrap text-sm leading-6">
                  {comment.comment}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
