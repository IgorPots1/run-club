'use client'

import { LoaderCircle } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import ParticipantIdentity from '@/components/ParticipantIdentity'
import WorkoutDetailShell from '@/components/WorkoutDetailShell'
import { getBootstrapUser } from '@/lib/auth'
import { loadTotalXpByUserIds } from '@/lib/dashboard'
import { formatDistanceKm, formatRunTimestampLabel } from '@/lib/format'
import {
  createRunComment,
  loadRunCommentAuthorProfile,
  loadRunComments,
  subscribeToRunComments,
  type RunCommentAuthorIdentity,
  type RunCommentItem,
  type RunCommentRealtimeRow,
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

type ProfileRow = {
  id: string
  name: string | null
  nickname?: string | null
  email: string | null
  avatar_url?: string | null
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
    return `${diffMinutes} мин назад`
  }

  const diffHours = Math.floor(diffMinutes / 60)

  if (diffHours < 24) {
    return `${diffHours} ч назад`
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
        <img
          src={avatarSrc}
          alt=""
          className="h-10 w-10 shrink-0 rounded-full object-cover"
          loading="lazy"
          decoding="async"
          draggable={false}
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

export default function RunDiscussionPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const runId = typeof params?.id === 'string' ? params.id : ''

  const [user, setUser] = useState<User | null>(null)
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
  const [currentCommentAuthor, setCurrentCommentAuthor] = useState<RunCommentAuthorIdentity | null>(null)

  const commentsRef = useRef<RunCommentItem[]>([])
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const previousSubmittingRef = useRef(false)
  const trimmedDraft = useMemo(() => draft.trim(), [draft])

  useEffect(() => {
    commentsRef.current = comments
  }, [comments])

  useEffect(() => {
    let isMounted = true

    async function loadUser() {
      const nextUser = await getBootstrapUser()

      if (isMounted) {
        setUser(nextUser)
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
          loadRunComments(runId),
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
  }, [runId])

  useEffect(() => {
    if (!runId) {
      return
    }

    return subscribeToRunComments(runId, (commentRow) => {
      void (async () => {
        if (commentsRef.current.some((comment) => comment.id === commentRow.id)) {
          return
        }

        const optimisticCommentIndex = commentsRef.current.findIndex((comment) =>
          comment.id.startsWith('optimistic-') &&
          comment.userId === commentRow.user_id &&
          comment.comment.trim() === commentRow.comment.trim()
        )

        const authorIdentity = await loadRunCommentAuthorProfile(commentRow.user_id).catch(() => ({
          userId: commentRow.user_id,
          displayName: 'Бегун',
          nickname: null,
          avatarUrl: null,
        }))

        const realtimeComment: RunCommentItem = {
          id: commentRow.id,
          runId: commentRow.run_id,
          userId: commentRow.user_id,
          comment: commentRow.comment,
          createdAt: commentRow.created_at,
          displayName: authorIdentity.displayName,
          nickname: authorIdentity.nickname,
          avatarUrl: authorIdentity.avatarUrl,
        }

        setComments((prev) => {
          if (prev.some((comment) => comment.id === realtimeComment.id)) {
            return prev
          }

          if (optimisticCommentIndex >= 0) {
            return prev.map((comment, index) =>
              index === optimisticCommentIndex ? realtimeComment : comment
            )
          }

          return [...prev, realtimeComment]
        })
      })()
    })
  }, [runId])

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

  function focusComposer() {
    const textarea = textareaRef.current

    if (!textarea) {
      return
    }

    textarea.focus()
    const nextCursorPosition = textarea.value.length
    textarea.setSelectionRange(nextCursorPosition, nextCursorPosition)
  }

  useEffect(() => {
    const textarea = textareaRef.current

    if (!textarea) {
      return
    }

    textarea.style.height = '0px'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
  }, [draft])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      scrollToBottom(comments.length > 0 ? 'smooth' : 'auto')
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [comments.length, loadingComments])

  useEffect(() => {
    const justFinishedSubmitting = previousSubmittingRef.current && !submitting
    previousSubmittingRef.current = submitting

    if (!justFinishedSubmitting) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      focusComposer()
      scrollToBottom('smooth')
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [submitting])

  async function ensureCurrentAuthor() {
    if (!user?.id) {
      return null
    }

    if (currentCommentAuthor?.userId === user.id) {
      return currentCommentAuthor
    }

    try {
      const authorIdentity = await loadRunCommentAuthorProfile(user.id)
      setCurrentCommentAuthor(authorIdentity)
      return authorIdentity
    } catch {
      const fallbackAuthor = {
        userId: user.id,
        displayName: 'Вы',
        nickname: null,
        avatarUrl: null,
      }
      setCurrentCommentAuthor(fallbackAuthor)
      return fallbackAuthor
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!runId || !trimmedDraft || submitting) {
      return
    }

    if (!user) {
      router.replace('/login')
      return
    }

    const authorIdentity = await ensureCurrentAuthor()

    if (!authorIdentity) {
      setSubmitError('Не удалось отправить комментарий')
      return
    }

    const optimisticCommentId = `optimistic-${Date.now()}`
    const optimisticComment: RunCommentItem = {
      id: optimisticCommentId,
      runId,
      userId: user.id,
      comment: trimmedDraft,
      createdAt: new Date().toISOString(),
      displayName: authorIdentity.displayName,
      nickname: authorIdentity.nickname,
      avatarUrl: authorIdentity.avatarUrl,
    }

    setSubmitting(true)
    setSubmitError('')
    setCommentsError('')
    setComments((prev) => [...prev, optimisticComment])

    try {
      const { error } = await createRunComment(runId, user.id, trimmedDraft)

      if (error) {
        throw error
      }

      setDraft('')

      try {
        const refreshedComments = await loadRunComments(runId)
        setComments(refreshedComments)
      } catch {
        // Keep the optimistic comment visible if follow-up refresh fails.
      }
    } catch {
      setComments((prev) => prev.filter((comment) => comment.id !== optimisticCommentId))
      setSubmitError('Не удалось отправить комментарий')
    } finally {
      setSubmitting(false)
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
    <section className="app-card mt-3 rounded-2xl border p-4 shadow-sm">
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
    <section className="app-card mt-3 rounded-2xl border p-4 shadow-sm">
      <p className="text-sm text-red-600">{pageError || 'Обсуждение не найдено'}</p>
    </section>
  ) : (
    <section className="app-card mt-3 rounded-2xl border p-4 shadow-sm">
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
    <form
      onSubmit={handleSubmit}
      className="shrink-0 border-t border-black/5 bg-[var(--surface)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 dark:border-white/10"
    >
      <div className="flex items-end gap-2">
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
          placeholder="Сообщение"
          disabled={submitting}
          enterKeyHint="send"
          className="app-input max-h-[120px] min-h-11 w-full resize-none rounded-2xl border px-4 py-3 text-sm leading-5"
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
  )

  return (
    <WorkoutDetailShell
      title="Обсуждение"
      fallbackHref={runId ? `/runs/${runId}` : '/dashboard'}
      topContent={discussionSummary}
      footer={discussionComposer}
      scrollContainerRef={scrollContainerRef}
      scrollContentClassName="scroll-smooth"
    >
          {loadingComments ? (
            <div className="space-y-4 pb-2">
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
          ) : comments.length === 0 ? (
            <div className="rounded-2xl border border-black/5 bg-black/[0.02] px-4 py-8 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <p className="app-text-primary text-sm font-medium">Пока нет комментариев</p>
              <p className="app-text-secondary mt-1 text-sm">Напиши первым, чтобы начать обсуждение.</p>
            </div>
          ) : (
            <div className="space-y-4 pb-2">
              {comments.map((comment) => (
                <CommentRow key={comment.id} comment={comment} />
              ))}
            </div>
          )}
          <div ref={bottomRef} />
    </WorkoutDetailShell>
  )
}
