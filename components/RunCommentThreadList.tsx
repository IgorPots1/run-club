'use client'

import Image from 'next/image'
import { useMemo, useState } from 'react'
import { buildRunCommentThreads, type RunCommentItem } from '@/lib/run-comments'

type RunCommentThreadListProps = {
  comments: RunCommentItem[]
  currentUserId?: string | null
  onReplyComment?: (parentId: string, comment: string) => Promise<void>
  onEditComment?: (commentId: string, comment: string) => Promise<void>
  onDeleteComment?: (commentId: string) => Promise<void>
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

type ComposerProps = {
  id: string
  value: string
  placeholder: string
  submitLabel: string
  submittingLabel: string
  disabled?: boolean
  error?: string
  onChange: (value: string) => void
  onCancel: () => void
  onSubmit: () => Promise<void>
}

function InlineComposer({
  id,
  value,
  placeholder,
  submitLabel,
  submittingLabel,
  disabled = false,
  error = '',
  onChange,
  onCancel,
  onSubmit,
}: ComposerProps) {
  const [submitting, setSubmitting] = useState(false)
  const trimmedValue = value.trim()

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!trimmedValue || submitting || disabled) {
      return
    }

    setSubmitting(true)

    try {
      await onSubmit()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 rounded-2xl border border-black/5 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <label htmlFor={id} className="sr-only">Комментарий</label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={submitting || disabled}
        className="app-input min-h-24 w-full rounded-xl border px-3 py-2 text-sm leading-5"
      />
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting || disabled}
          className="app-button-secondary min-h-10 rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
        >
          Отмена
        </button>
        <button
          type="submit"
          disabled={submitting || disabled || !trimmedValue}
          className="app-button-secondary min-h-10 rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? submittingLabel : submitLabel}
        </button>
      </div>
    </form>
  )
}

type CommentCardProps = {
  comment: RunCommentItem
  currentUserId?: string | null
  isReply?: boolean
  isReplyComposerOpen?: boolean
  isEditComposerOpen?: boolean
  replyDraft: string
  replyError: string
  editDraft: string
  editError: string
  onReplyDraftChange: (value: string) => void
  onEditDraftChange: (value: string) => void
  onStartReply?: () => void
  onCancelReply: () => void
  onSubmitReply: () => Promise<void>
  onStartEdit?: () => void
  onCancelEdit: () => void
  onSubmitEdit: () => Promise<void>
  onDelete?: () => Promise<void>
}

function CommentCard({
  comment,
  currentUserId = null,
  isReply = false,
  isReplyComposerOpen = false,
  isEditComposerOpen = false,
  replyDraft,
  replyError,
  editDraft,
  editError,
  onReplyDraftChange,
  onEditDraftChange,
  onStartReply,
  onCancelReply,
  onSubmitReply,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onDelete,
}: CommentCardProps) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)
  const avatarSrc = comment.avatarUrl?.trim() ? comment.avatarUrl : null
  const showAvatarImage = Boolean(avatarSrc) && failedAvatarUrl !== avatarSrc
  const nicknameLabel = comment.nickname?.trim() ? `@${comment.nickname.trim()}` : null
  const isDeleted = Boolean(comment.deletedAt)
  const isEdited = Boolean(comment.editedAt) && !isDeleted
  const isOwnComment = Boolean(currentUserId && currentUserId === comment.userId)

  async function handleDeleteClick() {
    if (!onDelete) {
      return
    }

    const confirmed = window.confirm('Удалить комментарий?')

    if (!confirmed) {
      return
    }

    await onDelete()
  }

  return (
    <div className={isReply ? 'ml-13 border-l border-black/10 pl-4 dark:border-white/10' : ''}>
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
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="app-text-primary truncate font-semibold">{comment.displayName}</p>
            {nicknameLabel ? (
              <p className="app-text-secondary truncate text-xs">{nicknameLabel}</p>
            ) : null}
            <p className="app-text-secondary text-xs">{formatCommentTimestamp(comment.createdAt)}</p>
            {isEdited ? <p className="app-text-muted text-xs">изменено</p> : null}
          </div>

          {isEditComposerOpen ? (
            <InlineComposer
              id={`edit-comment-${comment.id}`}
              value={editDraft}
              placeholder="Обнови комментарий"
              submitLabel="Сохранить"
              submittingLabel="Сохраняем..."
              error={editError}
              onChange={onEditDraftChange}
              onCancel={onCancelEdit}
              onSubmit={onSubmitEdit}
            />
          ) : (
            <p
              className={`mt-1 break-words whitespace-pre-wrap text-sm leading-6 ${
                isDeleted ? 'app-text-muted italic' : 'app-text-primary'
              }`}
            >
              {comment.comment}
            </p>
          )}

          {!isDeleted && !isEditComposerOpen ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {!isReply && onStartReply ? (
                <button
                  type="button"
                  onClick={onStartReply}
                  className="app-text-muted text-xs font-medium"
                >
                  Ответить
                </button>
              ) : null}
              {isOwnComment && onStartEdit ? (
                <button
                  type="button"
                  onClick={onStartEdit}
                  className="app-text-muted text-xs font-medium"
                >
                  Редактировать
                </button>
              ) : null}
              {isOwnComment && onDelete ? (
                <button
                  type="button"
                  onClick={() => void handleDeleteClick()}
                  className="text-xs font-medium text-red-600"
                >
                  Удалить
                </button>
              ) : null}
            </div>
          ) : null}

          {isReplyComposerOpen ? (
            <InlineComposer
              id={`reply-comment-${comment.id}`}
              value={replyDraft}
              placeholder="Напиши ответ"
              submitLabel="Ответить"
              submittingLabel="Отправляем..."
              error={replyError}
              onChange={onReplyDraftChange}
              onCancel={onCancelReply}
              onSubmit={onSubmitReply}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function RunCommentThreadList({
  comments,
  currentUserId = null,
  onReplyComment,
  onEditComment,
  onDeleteComment,
}: RunCommentThreadListProps) {
  const threads = useMemo(() => buildRunCommentThreads(comments), [comments])
  const [replyParentId, setReplyParentId] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [replyError, setReplyError] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [editError, setEditError] = useState('')
  const activeReplyParentId =
    replyParentId && threads.some((thread) => thread.id === replyParentId && !thread.deletedAt)
      ? replyParentId
      : null
  const activeEditingCommentId =
    editingCommentId && comments.some((comment) => comment.id === editingCommentId && !comment.deletedAt)
      ? editingCommentId
      : null

  function startReply(parentId: string) {
    setEditingCommentId(null)
    setEditDraft('')
    setEditError('')
    setReplyParentId(parentId)
    setReplyDraft('')
    setReplyError('')
  }

  function cancelReply() {
    setReplyParentId(null)
    setReplyDraft('')
    setReplyError('')
  }

  async function submitReply(parentId: string) {
    const trimmedReplyDraft = replyDraft.trim()

    if (!trimmedReplyDraft || !onReplyComment) {
      setReplyError('Введите комментарий')
      return
    }

    try {
      setReplyError('')
      await onReplyComment(parentId, trimmedReplyDraft)
      cancelReply()
    } catch {
      setReplyError('Не удалось отправить ответ')
    }
  }

  function startEdit(comment: RunCommentItem) {
    setReplyParentId(null)
    setReplyDraft('')
    setReplyError('')
    setEditingCommentId(comment.id)
    setEditDraft(comment.comment)
    setEditError('')
  }

  function cancelEdit() {
    setEditingCommentId(null)
    setEditDraft('')
    setEditError('')
  }

  async function submitEdit(commentId: string) {
    const trimmedEditDraft = editDraft.trim()

    if (!trimmedEditDraft || !onEditComment) {
      setEditError('Введите комментарий')
      return
    }

    try {
      setEditError('')
      await onEditComment(commentId, trimmedEditDraft)
      cancelEdit()
    } catch {
      setEditError('Не удалось сохранить комментарий')
    }
  }

  async function handleDelete(commentId: string) {
    if (!onDeleteComment) {
      return
    }

    try {
      await onDeleteComment(commentId)

      if (activeEditingCommentId === commentId) {
        cancelEdit()
      }

      if (activeReplyParentId === commentId) {
        cancelReply()
      }
    } catch {
      // Keep current UI state unchanged if deletion fails.
    }
  }

  return (
    <div className="space-y-5">
      {threads.map((thread) => (
        <div key={thread.id} className="space-y-3">
          <CommentCard
            comment={thread}
            currentUserId={currentUserId}
            isReplyComposerOpen={activeReplyParentId === thread.id}
            isEditComposerOpen={activeEditingCommentId === thread.id}
            replyDraft={replyDraft}
            replyError={replyError}
            editDraft={editDraft}
            editError={editError}
            onReplyDraftChange={(value) => {
              setReplyDraft(value)
              setReplyError('')
            }}
            onEditDraftChange={(value) => {
              setEditDraft(value)
              setEditError('')
            }}
            onStartReply={onReplyComment && !thread.deletedAt ? () => startReply(thread.id) : undefined}
            onCancelReply={cancelReply}
            onSubmitReply={() => submitReply(thread.id)}
            onStartEdit={!thread.deletedAt ? () => startEdit(thread) : undefined}
            onCancelEdit={cancelEdit}
            onSubmitEdit={() => submitEdit(thread.id)}
            onDelete={onDeleteComment && !thread.deletedAt ? () => handleDelete(thread.id) : undefined}
          />

          {thread.replies.length > 0 ? (
            <div className="space-y-3">
              {thread.replies.map((reply) => (
                <CommentCard
                  key={reply.id}
                  comment={reply}
                  currentUserId={currentUserId}
                  isReply
                  isEditComposerOpen={activeEditingCommentId === reply.id}
                  replyDraft=""
                  replyError=""
                  editDraft={editDraft}
                  editError={editError}
                  onReplyDraftChange={() => {}}
                  onEditDraftChange={(value) => {
                    setEditDraft(value)
                    setEditError('')
                  }}
                  onCancelReply={() => {}}
                  onSubmitReply={async () => {}}
                  onStartEdit={!reply.deletedAt ? () => startEdit(reply) : undefined}
                  onCancelEdit={cancelEdit}
                  onSubmitEdit={() => submitEdit(reply.id)}
                  onDelete={onDeleteComment && !reply.deletedAt ? () => handleDelete(reply.id) : undefined}
                />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
