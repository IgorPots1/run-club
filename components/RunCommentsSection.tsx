'use client'

import { useState } from 'react'
import RunCommentThreadList from '@/components/RunCommentThreadList'
import { countVisibleRunComments, type RunCommentItem } from '@/lib/run-comments'

type RunCommentsSectionProps = {
  comments: RunCommentItem[]
  currentUserId?: string | null
  loading?: boolean
  error?: string
  pendingLikeCommentIds?: Record<string, boolean>
  onSubmitComment?: (comment: string) => Promise<void>
  onToggleLikeComment?: (commentId: string) => void
  onReplyComment?: (parentId: string, comment: string) => Promise<void>
  onEditComment?: (commentId: string, comment: string) => Promise<void>
  onDeleteComment?: (commentId: string) => Promise<void>
}

export default function RunCommentsSection({
  comments,
  currentUserId = null,
  loading = false,
  error = '',
  pendingLikeCommentIds = {},
  onSubmitComment,
  onToggleLikeComment,
  onReplyComment,
  onEditComment,
  onDeleteComment,
}: RunCommentsSectionProps) {
  const [comment, setComment] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const trimmedComment = comment.trim()
  const visibleCommentsCount = countVisibleRunComments(comments)

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
    <section className="space-y-4">
      <h2 className="app-text-primary text-base font-semibold">Комментарии</h2>
      {onSubmitComment ? (
        <form onSubmit={handleSubmit}>
          <label htmlFor="run-comment" className="sr-only">Комментарий</label>
          <textarea
            id="run-comment"
            value={comment}
            onChange={(event) => {
              setComment(event.target.value)
              setSubmitError('')
            }}
            placeholder="Напиши комментарий"
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
        <div className="space-y-4">
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
        <p className="text-sm text-red-600">{error}</p>
      ) : visibleCommentsCount === 0 ? (
        <p className="app-text-secondary text-sm">Пока нет комментариев</p>
      ) : (
        <div>
          <RunCommentThreadList
            comments={comments}
            currentUserId={currentUserId}
            pendingLikeCommentIds={pendingLikeCommentIds}
            onToggleLikeComment={onToggleLikeComment}
            onReplyComment={onReplyComment}
            onEditComment={onEditComment}
            onDeleteComment={onDeleteComment}
          />
        </div>
      )}
    </section>
  )
}
