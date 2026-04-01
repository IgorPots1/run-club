'use client'

import { LoaderCircle } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import ConversationScreenShell from '@/components/ConversationScreenShell'
import ParticipantIdentity from '@/components/ParticipantIdentity'
import RunCommentThreadList from '@/components/RunCommentThreadList'
import { getBootstrapUser } from '@/lib/auth'
import { loadTotalXpByUserIds } from '@/lib/dashboard'
import { formatDistanceKm, formatRunTimestampLabel } from '@/lib/format'
import {
  applyRunCommentLikeState,
  applyRunCommentInsert,
  applyRunCommentUpdate,
  countVisibleRunComments,
  createRunComment,
  deleteRunComment,
  loadRunCommentAuthorProfile,
  loadRunComments,
  resolveRunCommentRealtimeItem,
  subscribeToRunCommentLikes,
  subscribeToRunComments,
  toggleRunCommentLike,
  type RunCommentAuthorIdentity,
  type RunCommentItem,
  type RunCommentLikeRealtimeRow,
  type RunCommentRealtimeRow,
  updateRunComment,
} from '@/lib/run-comments'
import { supabase } from '@/lib/supabase'
import { getLevelFromXP } from '@/lib/xp'
import type { User } from '@supabase/supabase-js'

type RunDiscussionRow = {
  id: string
  user_id: string
  name: string | null
  title?: string | null
  description?: string | null
  external_source?: string | null
  distance_km: number | null
  duration_minutes: number | null
  duration_seconds?: number | null
  moving_time_seconds?: number | null
  xp?: number | null
  created_at: string
}

type QueryErrorLike = {
  code?: string | null
  message?: string | null
}

const RUN_DISCUSSION_SELECT_WITH_OPTIONAL_COLUMNS =
  'id, user_id, name, title, description, external_source, distance_km, duration_minutes, duration_seconds, moving_time_seconds, xp, created_at'

const RUN_DISCUSSION_SELECT_LEGACY =
  'id, user_id, name, title, external_source, distance_km, duration_minutes, duration_seconds, moving_time_seconds, created_at'

function isMissingOptionalRunColumnsError(error: QueryErrorLike | null | undefined) {
  if (!error) {
    return false
  }

  if (error.code === '42703' || error.code === 'PGRST204') {
    return true
  }

  const message = (error.message ?? '').toLowerCase()

  return message.includes('description') || message.includes('xp')
}

async function loadRunDiscussionRow(runId: string) {
  const primaryResult = await supabase
    .from('runs')
    .select(RUN_DISCUSSION_SELECT_WITH_OPTIONAL_COLUMNS)
    .eq('id', runId)
    .maybeSingle()

  if (!isMissingOptionalRunColumnsError(primaryResult.error)) {
    return primaryResult
  }

  return supabase
    .from('runs')
    .select(RUN_DISCUSSION_SELECT_LEGACY)
    .eq('id', runId)
    .maybeSingle()
}

function getRunTitle(run: Pick<RunDiscussionRow, 'name' | 'title'>) {
  return run.name?.trim() || run.title?.trim() || 'Тренировка'
}

function toNullableTrimmedText(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

function getRunCommentUpdateSignature(
  comment:
    | Pick<RunCommentItem, 'id' | 'editedAt' | 'deletedAt'>
    | Pick<RunCommentRealtimeRow, 'id' | 'edited_at' | 'deleted_at'>
) {
  const editedAt = 'editedAt' in comment ? comment.editedAt : comment.edited_at
  const deletedAt = 'deletedAt' in comment ? comment.deletedAt : comment.deleted_at
  return `${comment.id}:${editedAt ?? ''}:${deletedAt ?? ''}`
}

function getRunCommentLikeEchoKey(
  commentLike:
    | Pick<RunCommentLikeRealtimeRow, 'comment_id' | 'user_id'>
    | { commentId: string; userId: string }
) {
  const commentId = 'comment_id' in commentLike ? commentLike.comment_id : commentLike.commentId
  return `${commentId}:${commentLike.userId}`
}

function resolveDurationSeconds(run: Pick<RunDiscussionRow, 'moving_time_seconds' | 'duration_seconds' | 'duration_minutes'>) {
  if (Number.isFinite(run.moving_time_seconds) && (run.moving_time_seconds ?? 0) > 0) {
    return Math.round(run.moving_time_seconds ?? 0)
  }

  if (Number.isFinite(run.duration_seconds) && (run.duration_seconds ?? 0) > 0) {
    return Math.round(run.duration_seconds ?? 0)
  }

  if (Number.isFinite(run.duration_minutes) && (run.duration_minutes ?? 0) > 0) {
    return Math.round(Number(run.duration_minutes ?? 0) * 60)
  }

  return null
}

function formatDurationLabel(totalSeconds: number | null) {
  if (!Number.isFinite(Number(totalSeconds)) || Number(totalSeconds) <= 0) {
    return '—'
  }

  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds)))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatPaceLabel(distanceKm: number | null, totalDurationSeconds: number | null) {
  if (!Number.isFinite(distanceKm) || (distanceKm ?? 0) <= 0) {
    return '—'
  }

  if (!Number.isFinite(totalDurationSeconds) || (totalDurationSeconds ?? 0) <= 0) {
    return '—'
  }

  const paceSeconds = Math.round(Number(totalDurationSeconds) / Number(distanceKm))
  const minutes = Math.floor(paceSeconds / 60)
  const seconds = paceSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')} /км`
}

function StravaIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="block h-[14px] w-[14px] shrink-0 text-[#FC4C02]"
    >
      <path d="M15.39 1.5 9.45 13.17h3.51l2.43-4.79 2.43 4.79h3.5L15.39 1.5Z" />
      <path d="M10 14.95 7.57 19.73h3.51L10 17.62l-1.08 2.11h3.51L10 14.95Z" />
    </svg>
  )
}

export default function RunDiscussionPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const runId = typeof params?.id === 'string' ? params.id : ''

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [run, setRun] = useState<RunDiscussionRow | null>(null)
  const [author, setAuthor] = useState<RunCommentAuthorIdentity | null>(null)
  const [authorLevel, setAuthorLevel] = useState(1)
  const [comments, setComments] = useState<RunCommentItem[]>([])
  const [loadingRun, setLoadingRun] = useState(true)
  const [loadingComments, setLoadingComments] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [pageError, setPageError] = useState('')
  const [commentsError, setCommentsError] = useState('')
  const [draft, setDraft] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null)
  const [pendingLikeCommentIds, setPendingLikeCommentIds] = useState<Record<string, boolean>>({})

  const commentsRef = useRef<RunCommentItem[]>([])
  const pendingLocalUpdateEchoesRef = useRef<Map<string, string>>(new Map())
  const pendingLocalLikeInsertEchoesRef = useRef<Set<string>>(new Set())
  const pendingLocalLikeDeleteEchoesRef = useRef<Set<string>>(new Set())
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const trimmedDraft = useMemo(() => draft.trim(), [draft])
  const replyTarget = useMemo(
    () => comments.find((comment) => comment.id === replyTargetId && !comment.parentId && !comment.deletedAt) ?? null,
    [comments, replyTargetId]
  )
  const visibleCommentsCount = useMemo(() => countVisibleRunComments(comments), [comments])

  useEffect(() => {
    commentsRef.current = comments
  }, [comments])

  useEffect(() => {
    pendingLocalUpdateEchoesRef.current.clear()
    pendingLocalLikeInsertEchoesRef.current.clear()
    pendingLocalLikeDeleteEchoesRef.current.clear()
    setPendingLikeCommentIds({})
  }, [runId])

  useEffect(() => {
    if (replyTargetId && !replyTarget) {
      setReplyTargetId(null)
    }
  }, [replyTarget, replyTargetId])

  useEffect(() => {
    let isMounted = true

    async function loadUser() {
      try {
        const nextUser = await getBootstrapUser()

        if (isMounted) {
          setUser(nextUser)
        }
      } finally {
        if (isMounted) {
          setAuthLoading(false)
        }
      }
    }

    void loadUser()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadDiscussion() {
      if (authLoading) {
        return
      }

      if (!runId) {
        if (isMounted) {
          setPageError('Обсуждение не найдено')
          setLoadingRun(false)
          setLoadingComments(false)
        }
        return
      }

      setLoadingRun(true)
      setLoadingComments(true)
      setPageError('')
      setCommentsError('')

      try {
        const { data: runData, error: runError } = await loadRunDiscussionRow(runId)

        if (runError || !runData) {
          if (isMounted) {
            setPageError('Не удалось загрузить обсуждение')
            setRun(null)
          }
          return
        }

        const [authorIdentity, totalXpByUser, loadedComments] = await Promise.all([
          loadRunCommentAuthorProfile(runData.user_id).catch(() => ({
            userId: runData.user_id,
            displayName: 'Бегун',
            nickname: null,
            avatarUrl: null,
          })),
          loadTotalXpByUserIds([runData.user_id]).catch(() => ({} as Record<string, number>)),
          loadRunComments(runId, user?.id ?? null),
        ])

        if (!isMounted) {
          return
        }

        setRun(runData as RunDiscussionRow)
        setAuthor(authorIdentity)
        setAuthorLevel(getLevelFromXP(totalXpByUser[runData.user_id] ?? 0).level)
        setComments(loadedComments)
      } catch {
        if (isMounted) {
          setPageError('Не удалось загрузить обсуждение')
          setRun(null)
        }
      } finally {
        if (isMounted) {
          setLoadingRun(false)
          setLoadingComments(false)
        }
      }
    }

    void loadDiscussion()

    return () => {
      isMounted = false
    }
  }, [authLoading, runId, user?.id])

  useEffect(() => {
    if (!runId) {
      return
    }

    return subscribeToRunComments(runId, {
      onInsert: (commentRow) => {
        void (async () => {
          const existingComment = commentsRef.current.find((comment) => comment.id === commentRow.id) ?? null
          const realtimeComment = await resolveRunCommentRealtimeItem(commentRow, existingComment)

          setComments((prev) => applyRunCommentInsert(prev, realtimeComment))
        })()
      },
      onUpdate: (commentRow) => {
        void (async () => {
          const updateSignature = getRunCommentUpdateSignature(commentRow)
          const pendingLocalSignature = pendingLocalUpdateEchoesRef.current.get(commentRow.id)

          if (pendingLocalSignature === updateSignature) {
            pendingLocalUpdateEchoesRef.current.delete(commentRow.id)
            return
          }

          const existingComment = commentsRef.current.find((comment) => comment.id === commentRow.id) ?? null
          const realtimeComment = await resolveRunCommentRealtimeItem(commentRow, existingComment)

          setComments((prev) => applyRunCommentUpdate(prev, realtimeComment))
        })()
      },
    })
  }, [runId])

  useEffect(() => {
    if (!runId) {
      return
    }

    return subscribeToRunCommentLikes(runId, {
      onInsert: (likeRow) => {
        const isOwnLike = Boolean(user?.id) && likeRow.user_id === user?.id
        const echoKey = getRunCommentLikeEchoKey(likeRow)

        if (isOwnLike && pendingLocalLikeInsertEchoesRef.current.has(echoKey)) {
          pendingLocalLikeInsertEchoesRef.current.delete(echoKey)
          return
        }

        setComments((prev) =>
          applyRunCommentLikeState(prev, {
            commentId: likeRow.comment_id,
            delta: 1,
            likedByMe: isOwnLike ? true : undefined,
          })
        )
      },
      onDelete: (likeRow) => {
        const isOwnLike = Boolean(user?.id) && likeRow.user_id === user?.id
        const echoKey = getRunCommentLikeEchoKey(likeRow)

        if (isOwnLike && pendingLocalLikeDeleteEchoesRef.current.has(echoKey)) {
          pendingLocalLikeDeleteEchoesRef.current.delete(echoKey)
          return
        }

        setComments((prev) =>
          applyRunCommentLikeState(prev, {
            commentId: likeRow.comment_id,
            delta: -1,
            likedByMe: isOwnLike ? false : undefined,
          })
        )
      },
    })
  }, [runId, user?.id])

  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior,
      })
      return
    }

    bottomRef.current?.scrollIntoView({
      block: 'end',
      behavior,
    })
  }

  useEffect(() => {
    const textarea = textareaRef.current

    if (!textarea) {
      return
    }

    textarea.style.height = '0px'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`
  }, [draft])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      scrollToBottom(comments.length > 0 ? 'smooth' : 'auto')
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [comments.length, loadingComments])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!runId || !trimmedDraft || submitting) {
      return
    }

    if (!user) {
      router.replace('/login')
      return
    }

    setSubmitting(true)
    setSubmitError('')
    setCommentsError('')

    try {
      const createdComment = await createRunComment(runId, {
        comment: trimmedDraft,
        parentId: replyTarget?.id ?? null,
      })

      setComments((prev) => applyRunCommentInsert(prev, createdComment))

      setDraft('')
      setReplyTargetId(null)
    } catch {
      setSubmitError(replyTarget ? 'Не удалось отправить ответ' : 'Не удалось отправить комментарий')
    } finally {
      setSubmitting(false)
    }
  }

  function handleSelectReplyTarget(comment: RunCommentItem | null) {
    setReplyTargetId(comment?.id ?? null)
    setSubmitError('')

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
      scrollToBottom('smooth')
    })
  }

  async function handleReplyComment(parentId: string, comment: string) {
    const trimmedComment = comment.trim()

    if (!trimmedComment) {
      throw new Error('empty_comment')
    }

    const createdComment = await createRunComment(runId, {
      comment: trimmedComment,
      parentId,
    })

    setComments((prev) => applyRunCommentInsert(prev, createdComment))
    setCommentsError('')
  }

  async function handleEditComment(commentId: string, comment: string) {
    const trimmedComment = comment.trim()

    if (!trimmedComment) {
      throw new Error('empty_comment')
    }

    const updatedComment = await updateRunComment(commentId, {
      comment: trimmedComment,
    })

    pendingLocalUpdateEchoesRef.current.set(
      updatedComment.id,
      getRunCommentUpdateSignature(updatedComment)
    )
    setComments((prev) => applyRunCommentUpdate(prev, updatedComment))
    setCommentsError('')
  }

  async function handleDeleteComment(commentId: string) {
    const deletedComment = await deleteRunComment(commentId)

    pendingLocalUpdateEchoesRef.current.set(
      deletedComment.id,
      getRunCommentUpdateSignature(deletedComment)
    )
    setComments((prev) => applyRunCommentUpdate(prev, deletedComment))
    setCommentsError('')
  }

  async function handleToggleLikeComment(commentId: string) {
    if (!user) {
      router.replace('/login')
      return
    }

    if (pendingLikeCommentIds[commentId]) {
      return
    }

    const existingComment = commentsRef.current.find((comment) => comment.id === commentId) ?? null

    if (!existingComment || existingComment.deletedAt) {
      return
    }

    const wasLiked = existingComment.likedByMe
    const previousComments = commentsRef.current

    setPendingLikeCommentIds((prev) => ({
      ...prev,
      [commentId]: true,
    }))

    const nextComments = applyRunCommentLikeState(previousComments, {
      commentId,
      delta: wasLiked ? -1 : 1,
      likedByMe: !wasLiked,
    })

    commentsRef.current = nextComments
    setComments(nextComments)

    const echoKey = getRunCommentLikeEchoKey({
      commentId,
      userId: user.id,
    })

    try {
      const { error } = await toggleRunCommentLike(commentId, wasLiked)

      if (error) {
        throw error
      }

      if (wasLiked) {
        pendingLocalLikeDeleteEchoesRef.current.add(echoKey)
      } else {
        pendingLocalLikeInsertEchoesRef.current.add(echoKey)
      }
    } catch {
      commentsRef.current = previousComments
      setComments(previousComments)
    } finally {
      setPendingLikeCommentIds((prev) => {
        const next = { ...prev }
        delete next[commentId]
        return next
      })
    }
  }

  const runTitle = run ? getRunTitle(run) : 'Обсуждение'
  const runDescription = useMemo(() => toNullableTrimmedText(run?.description), [run?.description])
  const resolvedDurationSeconds = useMemo(() => (run ? resolveDurationSeconds(run) : null), [run])
  const distanceLabel = useMemo(() => {
    if (!run || !Number.isFinite(run.distance_km) || (run.distance_km ?? 0) <= 0) {
      return '—'
    }

    return `${formatDistanceKm(Number(run.distance_km))} км`
  }, [run])
  const paceLabel = useMemo(
    () => formatPaceLabel(run?.distance_km ?? null, resolvedDurationSeconds),
    [resolvedDurationSeconds, run?.distance_km]
  )
  const durationLabel = useMemo(() => formatDurationLabel(resolvedDurationSeconds), [resolvedDurationSeconds])
  const discussionSummary = loadingRun ? (
    <section className="app-card rounded-2xl border p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-full skeleton-line" />
          <div className="min-w-0 space-y-2">
            <div className="skeleton-line h-4 w-28" />
            <div className="skeleton-line h-3 w-20" />
          </div>
        </div>
        <div className="skeleton-line h-4 w-20" />
      </div>
      <div className="mt-3 skeleton-line h-5 w-40" />
      <div className="mt-3 flex gap-2">
        <div className="skeleton-line h-4 w-16" />
        <div className="skeleton-line h-4 w-14" />
        <div className="skeleton-line h-4 w-18" />
      </div>
    </section>
  ) : pageError || !run || !author ? (
    <section className="app-card rounded-2xl border p-4 shadow-sm">
      <p className="text-sm text-red-600">{pageError || 'Обсуждение не найдено'}</p>
    </section>
  ) : (
    <section className="app-card rounded-2xl border p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <ParticipantIdentity
          avatarUrl={author.avatarUrl}
          displayName={author.displayName}
          level={authorLevel}
          href={`/users/${run.user_id}`}
          size="sm"
        />
        <p className="app-text-secondary max-w-[7rem] text-right text-xs sm:text-sm">
          {formatRunTimestampLabel(run.created_at, run.external_source)}
        </p>
      </div>

      <p className="app-text-primary mt-3 break-words text-base font-semibold">{runTitle}</p>
      {runDescription ? (
        <p className="app-text-secondary mt-1 line-clamp-2 break-words text-sm leading-5">
          {runDescription}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-medium">
        <span className="app-text-primary">{distanceLabel}</span>
        <span className="app-text-secondary">•</span>
        <span className="app-text-primary">{paceLabel}</span>
        <span className="app-text-secondary">•</span>
        <span className="app-text-primary">{durationLabel}</span>
        <span className="app-text-secondary">•</span>
        <span className="app-text-secondary">⚡ +{Math.max(0, Math.round(run.xp ?? 0))} XP</span>
        {run.external_source === 'strava' ? (
          <>
            <span className="app-text-secondary">•</span>
            <span className="app-text-secondary inline-flex items-center gap-1">
              <StravaIcon />
              <span>Strava</span>
            </span>
          </>
        ) : null}
      </div>
    </section>
  )
  const discussionComposer = (
    <form onSubmit={handleSubmit}>
      {replyTarget ? (
        <div className="mb-2.5 flex items-center justify-between gap-3 rounded-2xl border border-black/5 bg-black/[0.02] px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
          <p className="app-text-secondary min-w-0 text-xs font-medium">
            Ответ на <span className="app-text-primary">{replyTarget.displayName}</span>
          </p>
          <button
            type="button"
            onClick={() => handleSelectReplyTarget(null)}
            className="app-text-muted shrink-0 text-xs font-medium transition-opacity hover:opacity-80"
          >
            Отмена
          </button>
        </div>
      ) : null}
      <div className="flex items-end gap-2.5">
        <label htmlFor="discussion-comment" className="sr-only">Сообщение</label>
        <textarea
          id="discussion-comment"
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setSubmitError('')
          }}
          placeholder={replyTarget ? 'Напиши ответ' : 'Сообщение'}
          disabled={submitting}
          enterKeyHint="send"
          className="app-input max-h-36 min-h-12 w-full resize-none rounded-2xl border px-4 py-[0.875rem] text-base leading-6 [overflow-y:auto] sm:text-sm sm:leading-5"
        />
        <button
          type="submit"
          disabled={submitting || !trimmedDraft}
          className="app-button-secondary min-h-12 shrink-0 self-end rounded-2xl border px-4 py-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
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
  )

  return (
    <ConversationScreenShell
      title="Обсуждение"
      fallbackHref={runId ? `/runs/${runId}` : '/dashboard'}
      footer={discussionComposer}
      scrollContainerRef={scrollContainerRef}
      scrollContainerClassName="scroll-smooth"
    >
      {discussionSummary}
      <div className="flex min-h-[12rem] flex-1 flex-col">
        {loadingComments ? (
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
        ) : commentsError ? (
          <div className="rounded-2xl border border-red-200/70 px-4 py-4 dark:border-red-900/60">
            <p className="text-sm text-red-600">{commentsError}</p>
          </div>
        ) : visibleCommentsCount === 0 ? (
          <div className="rounded-2xl border border-black/5 bg-black/[0.02] px-4 py-8 text-center dark:border-white/10 dark:bg-white/[0.03]">
            <p className="app-text-primary text-sm font-medium">Пока нет комментариев</p>
            <p className="app-text-secondary mt-1 text-sm">Напиши первым, чтобы начать обсуждение.</p>
          </div>
        ) : (
          <RunCommentThreadList
            comments={comments}
            currentUserId={user?.id ?? null}
            pendingLikeCommentIds={pendingLikeCommentIds}
            onToggleLikeComment={handleToggleLikeComment}
            replyComposerMode="external"
            activeReplyTargetId={replyTarget?.id ?? null}
            onReplyTargetChange={handleSelectReplyTarget}
            onReplyComment={handleReplyComment}
            onEditComment={handleEditComment}
            onDeleteComment={handleDeleteComment}
          />
        )}
        <div ref={bottomRef} />
      </div>
    </ConversationScreenShell>
  )
}
