'use client'

import { ArrowUpRight, LoaderCircle } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import ConversationScreenShell from '@/components/ConversationScreenShell'
import RunCommentThreadList from '@/components/RunCommentThreadList'
import { getBootstrapUser } from '@/lib/auth'
import { formatDistanceKm, formatRunTimestampLabel } from '@/lib/format'
import { useRunDetailReturnState } from '@/lib/run-detail-navigation'
import {
  formatClock,
  formatRaceDateLabel,
  getRaceEventDisplayDistanceLabel,
  getRaceEventDisplayTimeSeconds,
  getRaceEventLinkedRun,
  isRaceEventUpcoming,
  loadRaceEvent,
  type RaceEvent,
  type RaceEventLinkedRunSummary,
} from '@/lib/race-events'
import { countVisibleRunComments, loadRaceComments, type RunCommentItem } from '@/lib/run-comments'
import { useEntityCommentsController } from '@/lib/use-entity-comments-controller'
import type { User } from '@supabase/supabase-js'

function normalizeCommentTarget(value: string | null) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getLinkedRunPreviewLabel(linkedRun: RaceEventLinkedRunSummary) {
  const runName = linkedRun.name?.trim() || linkedRun.title?.trim() || 'Тренировка'
  const distanceKm = Number(linkedRun.distance_km ?? 0)
  const distanceLabel = distanceKm > 0 ? `${formatDistanceKm(distanceKm)} км` : '—'
  return `${formatRunTimestampLabel(linkedRun.created_at, null)} • ${runName} • ${distanceLabel}`
}

export default function RaceDiscussionPage() {
  const router = useRouter()
  const params = useParams<{ raceId: string }>()
  const searchParams = useSearchParams()
  const raceId = typeof params?.raceId === 'string' ? params.raceId : ''
  const targetCommentId = normalizeCommentTarget(searchParams.get('commentId'))
  const targetParentCommentId = normalizeCommentTarget(searchParams.get('parentCommentId'))
  const hasDeepLinkTarget = Boolean(targetCommentId || targetParentCommentId)

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [raceEvent, setRaceEvent] = useState<RaceEvent | null>(null)
  const [loadingRace, setLoadingRace] = useState(true)
  const [loadingComments, setLoadingComments] = useState(true)
  const [pageError, setPageError] = useState('')
  const [commentsError, setCommentsError] = useState('')
  const [draft, setDraft] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null)
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const hasHandledInitialCommentTargetRef = useRef(false)

  const handleAuthRequired = useMemo(
    () => () => {
      router.replace('/login')
    },
    [router]
  )

  const {
    comments,
    pendingLikeCommentIds,
    replaceComments,
    createComment,
    editComment,
    deleteComment,
    toggleLikeComment,
  } = useEntityCommentsController({
    entityType: 'race',
    entityId: raceId,
    currentUserId: user?.id ?? null,
    onAuthRequired: handleAuthRequired,
  })

  const trimmedDraft = useMemo(() => draft.trim(), [draft])
  const replyTarget = useMemo(
    () => comments.find((comment) => comment.id === replyTargetId && !comment.parentId && !comment.deletedAt) ?? null,
    [comments, replyTargetId]
  )
  const visibleCommentsCount = useMemo(() => countVisibleRunComments(comments), [comments])
  const linkedRun = useMemo(() => (raceEvent ? getRaceEventLinkedRun(raceEvent) : null), [raceEvent])
  const displayTime = useMemo(() => (raceEvent ? getRaceEventDisplayTimeSeconds(raceEvent) : null), [raceEvent])
  const resultLabel = useMemo(() => formatClock(displayTime?.seconds), [displayTime?.seconds])
  const targetLabel = useMemo(() => formatClock(raceEvent?.target_time_seconds), [raceEvent?.target_time_seconds])
  const displayDistance = useMemo(() => (raceEvent ? getRaceEventDisplayDistanceLabel(raceEvent) : null), [raceEvent])
  const isUpcoming = useMemo(() => (raceEvent ? isRaceEventUpcoming(raceEvent) : false), [raceEvent])
  const { prepareForRunDetailNavigation } = useRunDetailReturnState({
    sourceKey: 'race-detail',
    scrollContainerRef,
    debugLabel: 'RaceDetail',
  })

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

      if (!user) {
        if (isMounted) {
          setRaceEvent(null)
          replaceComments([])
          setLoadingRace(false)
          setLoadingComments(false)
        }
        router.replace('/login')
        return
      }

      if (!raceId) {
        if (isMounted) {
          setPageError('Обсуждение старта не найдено')
          setLoadingRace(false)
          setLoadingComments(false)
        }
        return
      }

      setLoadingRace(true)
      setLoadingComments(true)
      setPageError('')
      setCommentsError('')

      try {
        const [loadedRaceEvent, loadedComments] = await Promise.all([
          loadRaceEvent(raceId),
          loadRaceComments(raceId, user.id),
        ])

        if (!isMounted) {
          return
        }

        setRaceEvent(loadedRaceEvent)
        replaceComments(loadedComments)
      } catch {
        if (isMounted) {
          setPageError('Не удалось загрузить обсуждение старта')
          setRaceEvent(null)
        }
      } finally {
        if (isMounted) {
          setLoadingRace(false)
          setLoadingComments(false)
        }
      }
    }

    void loadDiscussion()

    return () => {
      isMounted = false
    }
  }, [authLoading, raceId, replaceComments, router, user])

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
    if (!highlightedCommentId) {
      return
    }

    const timer = window.setTimeout(() => {
      setHighlightedCommentId((currentValue) => (
        currentValue === highlightedCommentId ? null : currentValue
      ))
    }, 2600)

    return () => {
      window.clearTimeout(timer)
    }
  }, [highlightedCommentId])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      if (hasDeepLinkTarget && !hasHandledInitialCommentTargetRef.current) {
        return
      }

      scrollToBottom(comments.length > 0 ? 'smooth' : 'auto')
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [comments.length, hasDeepLinkTarget, loadingComments])

  useEffect(() => {
    if (!hasDeepLinkTarget || loadingComments) {
      return
    }

    const candidateCommentIds = [
      targetCommentId,
      targetParentCommentId,
    ].filter((value): value is string => Boolean(value))

    if (candidateCommentIds.length === 0) {
      hasHandledInitialCommentTargetRef.current = true
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      for (const commentId of candidateCommentIds) {
        const targetElement = document.getElementById(`race-comment-${commentId}`)

        if (!targetElement) {
          continue
        }

        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
        setHighlightedCommentId(commentId)
        hasHandledInitialCommentTargetRef.current = true
        return
      }

      hasHandledInitialCommentTargetRef.current = true
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [hasDeepLinkTarget, loadingComments, targetCommentId, targetParentCommentId])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!raceId || !trimmedDraft || submitting) {
      return
    }

    if (!user) {
      handleAuthRequired()
      return
    }

    setSubmitting(true)
    setSubmitError('')
    setCommentsError('')

    try {
      await createComment(trimmedDraft, replyTarget?.id ?? null)
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

    await createComment(trimmedComment, parentId)
    setCommentsError('')
  }

  async function handleEditComment(commentId: string, comment: string) {
    const trimmedComment = comment.trim()

    if (!trimmedComment) {
      throw new Error('empty_comment')
    }

    await editComment(commentId, trimmedComment)
    setCommentsError('')
  }

  async function handleDeleteComment(commentId: string) {
    await deleteComment(commentId)
    setCommentsError('')
  }

  async function handleToggleLikeComment(commentId: string) {
    await toggleLikeComment(commentId)
  }

  function handleOpenLinkedRun(runId: string) {
    if (!runId) {
      return
    }

    prepareForRunDetailNavigation()
    router.push(`/runs/${runId}`)
  }

  const discussionSummary = loadingRace ? (
    <section className="app-card rounded-2xl border p-4 shadow-sm">
      <div className="space-y-3">
        <div className="skeleton-line h-5 w-32" />
        <div className="skeleton-line h-4 w-44" />
        <div className="skeleton-line h-4 w-36" />
      </div>
    </section>
  ) : pageError || !raceEvent ? (
    <section className="app-card rounded-2xl border p-4 shadow-sm">
      <p className="text-sm text-red-600">{pageError || 'Старт не найден'}</p>
    </section>
  ) : (
    <section className="app-card rounded-2xl border p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="app-text-primary break-words text-base font-semibold">{raceEvent.name}</p>
          <p className="app-text-secondary mt-1 break-words text-sm">{formatRaceDateLabel(raceEvent.race_date)}</p>
        </div>
        <p className="app-text-secondary min-w-0 break-words text-sm">{visibleCommentsCount} комм.</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {displayDistance ? <span className="app-text-primary break-words">{displayDistance.label}</span> : null}
        {displayDistance && (isUpcoming ? targetLabel : resultLabel) ? <span className="app-text-secondary">•</span> : null}
        {isUpcoming ? (
          <span className={`${targetLabel ? 'app-text-primary' : 'app-text-secondary'} break-words`}>
            {targetLabel ? `Цель: ${targetLabel}` : 'Цель не задана'}
          </span>
        ) : (
          <span className={`${resultLabel ? 'app-text-primary' : 'app-text-secondary'} break-words`}>
            {resultLabel ? `Результат: ${resultLabel}` : 'Результат не указан'}
          </span>
        )}
      </div>

      {linkedRun ? (
        <div className="mt-4 rounded-2xl border px-3 py-3">
          <p className="app-text-primary text-sm font-medium">Привязанная тренировка</p>
          <p className="app-text-secondary mt-1 break-words text-sm">{getLinkedRunPreviewLabel(linkedRun)}</p>
          <button
            type="button"
            onClick={() => handleOpenLinkedRun(linkedRun.id)}
            className="app-button-secondary mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium sm:w-auto"
          >
            <span>Открыть тренировку</span>
            <ArrowUpRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </section>
  )

  const discussionComposer = (
    <form onSubmit={handleSubmit}>
      {replyTarget ? (
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/5 bg-black/[0.02] px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
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
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
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
          className="app-button-secondary min-h-12 w-full shrink-0 rounded-2xl border px-4 py-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
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
      title="Обсуждение старта"
      fallbackHref={raceId ? '/races' : '/activity'}
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
            commentDomIdPrefix="race-comment"
            currentUserId={user?.id ?? null}
            highlightedCommentId={highlightedCommentId}
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
