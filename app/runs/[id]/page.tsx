'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Map } from 'lucide-react'
import RunCommentsSection from '@/components/RunCommentsSection'
import { getBootstrapUser } from '@/lib/auth'
import { formatDistanceKm, formatRunTimestampLabel } from '@/lib/format'
import { getStaticMapUrl } from '@/lib/getStaticMapUrl'
import { getProfileDisplayName } from '@/lib/profiles'
import { createRunComment, loadRunComments, type RunCommentItem } from '@/lib/run-comments'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

type RunDetailsRow = {
  id: string
  user_id: string
  name: string | null
  title?: string | null
  external_source?: string | null
  distance_km: number | null
  duration_minutes: number | null
  duration_seconds?: number | null
  moving_time_seconds?: number | null
  average_pace_seconds?: number | null
  elevation_gain_meters?: number | null
  average_heartrate?: number | null
  max_heartrate?: number | null
  xp?: number | null
  map_polyline?: string | null
  created_at: string
}

type ProfileRow = {
  id: string
  name: string | null
  nickname?: string | null
  email: string | null
  avatar_url?: string | null
}

const RUN_DETAILS_SELECT_WITH_OPTIONAL_COLUMNS =
  'id, user_id, name, title, external_source, distance_km, duration_minutes, duration_seconds, moving_time_seconds, average_pace_seconds, elevation_gain_meters, average_heartrate, max_heartrate, xp, map_polyline, calories, average_cadence, created_at'

const RUN_DETAILS_SELECT_LEGACY =
  'id, user_id, name, title, external_source, distance_km, duration_minutes, duration_seconds, moving_time_seconds, average_pace_seconds, elevation_gain_meters, created_at'

type QueryErrorLike = {
  code?: string | null
  message?: string | null
}

function isMissingOptionalRunColumnsError(error: QueryErrorLike | null | undefined) {
  if (!error) {
    return false
  }

  if (error.code === '42703' || error.code === 'PGRST204') {
    return true
  }

  const message = (error.message ?? '').toLowerCase()

  return (
    message.includes('average_heartrate') ||
    message.includes('max_heartrate') ||
    message.includes('xp') ||
    message.includes('map_polyline') ||
    message.includes('calories') ||
    message.includes('average_cadence')
  )
}

async function loadRunDetailsRow(runId: string) {
  const primaryResult = await supabase
    .from('runs')
    .select(RUN_DETAILS_SELECT_WITH_OPTIONAL_COLUMNS)
    .eq('id', runId)
    .maybeSingle()

  if (!isMissingOptionalRunColumnsError(primaryResult.error)) {
    return primaryResult
  }

  return supabase
    .from('runs')
    .select(RUN_DETAILS_SELECT_LEGACY)
    .eq('id', runId)
    .maybeSingle()
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

function formatDurationLabel(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function getTotalDurationSeconds(run: Pick<RunDetailsRow, 'duration_minutes' | 'duration_seconds'>) {
  if (Number.isFinite(run.duration_seconds) && (run.duration_seconds ?? 0) > 0) {
    return Math.round(run.duration_seconds ?? 0)
  }

  return Math.max(0, Math.round(Number(run.duration_minutes ?? 0) * 60))
}

function formatPaceLabel(averagePaceSeconds: number) {
  const safePace = Math.max(1, Math.round(averagePaceSeconds))
  const minutes = Math.floor(safePace / 60)
  const seconds = safePace % 60
  return `${minutes}:${String(seconds).padStart(2, '0')} /км`
}

function getRunTitle(run: Pick<RunDetailsRow, 'name' | 'title'>) {
  return run.name?.trim() || run.title?.trim() || 'Тренировка'
}

export default function RunDetailsPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const runId = typeof params?.id === 'string' ? params.id : ''
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [run, setRun] = useState<RunDetailsRow | null>(null)
  const [author, setAuthor] = useState<ProfileRow | null>(null)
  const [likesCount, setLikesCount] = useState(0)
  const [comments, setComments] = useState<RunCommentItem[]>([])
  const [commentsError, setCommentsError] = useState('')

  function handleBackNavigation() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }

    router.push('/dashboard')
  }

  async function handleCommentSubmit(comment: string) {
    if (!user || !run) {
      throw new Error('missing_context')
    }

    const trimmedComment = comment.trim()

    if (!trimmedComment) {
      throw new Error('empty_comment')
    }

    const { error: insertError } = await createRunComment(run.id, user.id, trimmedComment)

    if (insertError) {
      throw insertError
    }

    const refreshedComments = await loadRunComments(run.id)
    setComments(refreshedComments)
    setCommentsError('')
  }

  useEffect(() => {
    let isMounted = true

    async function loadUser() {
      try {
        if (!isMounted) return

        const nextUser = await getBootstrapUser()
        setUser(nextUser)

        if (!nextUser) {
          router.replace('/login')
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
  }, [router])

  useEffect(() => {
    let isMounted = true

    async function loadRunDetails() {
      if (authLoading) {
        return
      }

      if (!user) {
        if (isMounted) {
          setRun(null)
          setLoading(false)
        }
        return
      }

      if (!runId) {
        if (isMounted) {
          setError('Тренировка не найдена')
          setLoading(false)
        }
        return
      }

      setLoading(true)
      setError('')
      setCommentsError('')

      try {
        const { data: runData, error: runError } = await loadRunDetailsRow(runId)

        if (runError) {
          if (isMounted) {
            setError('Не удалось загрузить тренировку')
            setRun(null)
          }
          return
        }

        if (!runData) {
          if (isMounted) {
            setError('Тренировка не найдена')
            setRun(null)
          }
          return
        }

        const [profileResult, likesResult] = await Promise.all([
          supabase
            .from('profiles')
            .select('id, name, nickname, email, avatar_url')
            .eq('id', runData.user_id)
            .maybeSingle(),
          supabase
            .from('run_likes')
            .select('id', { count: 'exact', head: true })
            .eq('run_id', runData.id),
        ])

        let runComments: RunCommentItem[] = []
        let nextCommentsError = ''

        try {
          runComments = await loadRunComments(runData.id)
        } catch (error) {
          nextCommentsError = 'Не удалось загрузить комментарии'
        }

        if (!isMounted) {
          return
        }

        setRun(runData as RunDetailsRow)
        setAuthor((profileResult.data as ProfileRow | null) ?? null)
        setLikesCount(Number(likesResult.count ?? 0))
        setComments(runComments)
        setCommentsError(nextCommentsError)
      } catch {
        if (isMounted) {
          setError('Не удалось загрузить тренировку')
          setRun(null)
          setComments([])
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    void loadRunDetails()

    return () => {
      isMounted = false
    }
  }, [authLoading, runId, user])

  const avatarSrc = author?.avatar_url?.trim() || null
  const authorName = getProfileDisplayName(author, 'Бегун')
  const commentsCount = comments.length
  const details = useMemo(() => {
    if (!run) {
      return null
    }

    const distanceKm = Number(run.distance_km ?? 0)
    const totalDurationSeconds = getTotalDurationSeconds(run)
    const movingTimeSeconds = Number.isFinite(run.moving_time_seconds) && (run.moving_time_seconds ?? 0) > 0
      ? Math.round(run.moving_time_seconds ?? 0)
      : null
    const computedAveragePace = distanceKm > 0 && totalDurationSeconds > 0
      ? Math.round(totalDurationSeconds / distanceKm)
      : null
    const averagePaceSeconds = Number.isFinite(run.average_pace_seconds) && (run.average_pace_seconds ?? 0) > 0
      ? Math.round(run.average_pace_seconds ?? 0)
      : computedAveragePace

    return {
      distanceLabel: distanceKm > 0 ? `${formatDistanceKm(distanceKm)} км` : null,
      durationLabel: totalDurationSeconds > 0 ? formatDurationLabel(totalDurationSeconds) : null,
      movingTimeLabel: movingTimeSeconds && movingTimeSeconds > 0 ? formatDurationLabel(movingTimeSeconds) : null,
      paceLabel: averagePaceSeconds && averagePaceSeconds > 0 ? formatPaceLabel(averagePaceSeconds) : null,
      elevationLabel:
        Number.isFinite(run.elevation_gain_meters) && (run.elevation_gain_meters ?? 0) > 0
          ? `${Math.round(run.elevation_gain_meters ?? 0)} м`
          : null,
      xpValue: Number.isFinite(run.xp) && (run.xp ?? 0) > 0
        ? Math.round(run.xp ?? 0)
        : Math.max(0, Math.round(50 + distanceKm * 10)),
      mapPreviewUrl: run.map_polyline ? getStaticMapUrl(run.map_polyline) : null,
    }
  }, [run])

  if (authLoading || loading) {
    return (
      <main className="min-h-screen pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
        <div className="mx-auto max-w-xl space-y-4 px-4 pb-4 pt-4 md:p-4">
          <button
            type="button"
            onClick={handleBackNavigation}
            className="app-text-secondary inline-flex items-center text-sm font-medium"
            aria-label="Назад"
          >
            ← Назад
          </button>

          <section className="app-card rounded-2xl border p-4 shadow-sm" aria-hidden="true">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="h-10 w-10 shrink-0 rounded-full skeleton-line" />
                <div className="min-w-0 space-y-2">
                  <div className="skeleton-line h-4 w-28" />
                  <div className="skeleton-line h-3 w-24" />
                </div>
              </div>
              <div className="h-6 w-16 rounded-full skeleton-line" />
            </div>

            <div className="mt-4 skeleton-line h-7 w-44" />

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="app-surface-muted rounded-xl p-3">
                <div className="skeleton-line h-3 w-16" />
                <div className="mt-2 skeleton-line h-5 w-20" />
              </div>
              <div className="app-surface-muted rounded-xl p-3">
                <div className="skeleton-line h-3 w-24" />
                <div className="mt-2 skeleton-line h-5 w-20" />
              </div>
              <div className="app-surface-muted rounded-xl p-3">
                <div className="skeleton-line h-3 w-20" />
                <div className="mt-2 skeleton-line h-5 w-24" />
              </div>
            </div>
          </section>

          <section className="app-card rounded-2xl border p-4 shadow-sm" aria-hidden="true">
            <div className="skeleton-line h-6 w-28" />
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="app-surface-muted rounded-xl p-3">
                <div className="skeleton-line h-3 w-16" />
                <div className="mt-2 skeleton-line h-5 w-10" />
              </div>
              <div className="app-surface-muted rounded-xl p-3">
                <div className="skeleton-line h-3 w-24" />
                <div className="mt-2 skeleton-line h-5 w-10" />
              </div>
            </div>
          </section>
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

  if (!run || !details) {
    return (
      <main className="min-h-screen pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
        <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
          <button
            type="button"
            onClick={handleBackNavigation}
            className="app-text-secondary inline-flex items-center text-sm font-medium"
            aria-label="Назад"
          >
            ← Назад
          </button>
          <div className="app-card mt-4 rounded-xl border p-4 shadow-sm">
            <p className="text-sm text-red-600">{error || 'Тренировка не найдена'}</p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
      <div className="mx-auto max-w-xl space-y-4 px-4 pb-4 pt-4 md:p-4">
        <button
          type="button"
          onClick={handleBackNavigation}
          className="app-text-secondary inline-flex items-center text-sm font-medium"
          aria-label="Назад"
        >
          ← Назад
        </button>

        <section className="app-card rounded-2xl border p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <Link href={`/users/${run.user_id}`} className="flex min-w-0 items-center gap-3">
              {avatarSrc ? (
                <Image
                  src={avatarSrc}
                  alt=""
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <AvatarFallback />
              )}
              <div className="min-w-0">
                <p className="app-text-primary truncate font-semibold">{authorName}</p>
                <p className="app-text-secondary truncate text-sm">
                  {formatRunTimestampLabel(run.created_at, run.external_source)}
                </p>
              </div>
            </Link>
            {run.external_source === 'strava' ? (
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium">
                <StravaIcon />
                Strava
              </span>
            ) : null}
          </div>

          <h1 className="app-text-primary mt-3 break-words text-base font-medium">{getRunTitle(run)}</h1>

          <div className="mt-2.5 text-sm">
            <p className="app-text-primary font-medium">+{details.xpValue} XP</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5">
            <div className="grid content-start gap-1.5">
              <p className="app-text-secondary text-sm leading-tight">Расстояние</p>
              <p className="app-text-primary text-lg font-semibold leading-tight">{details.distanceLabel ?? '—'}</p>
            </div>
            <div className="grid content-start gap-1.5">
              <p className="app-text-secondary text-sm leading-tight">Время в движении</p>
              <p className="app-text-primary text-lg font-semibold leading-tight">{details.movingTimeLabel || details.durationLabel || '—'}</p>
            </div>
            <div className="grid content-start gap-1.5">
              <p className="app-text-secondary text-sm leading-tight">Средний темп</p>
              <p className="app-text-primary text-lg font-semibold leading-tight">{details.paceLabel ?? '—'}</p>
            </div>
            <div className="grid content-start gap-1.5">
              <p className="app-text-secondary text-sm leading-tight">Набор высоты</p>
              <p className="app-text-primary text-lg font-semibold leading-tight">{details.elevationLabel ?? '—'}</p>
            </div>
          </div>
        </section>

        {details.mapPreviewUrl ? (
          <section className="app-card rounded-2xl border p-4 shadow-sm">
            <h2 className="app-text-primary inline-flex items-center gap-2 text-base font-semibold">
              <Map className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              <span>
                Маршрут
                {details.distanceLabel ? ` • ${details.distanceLabel}` : ''}
              </span>
            </h2>
            <div className="mt-3 rounded-2xl p-1 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
              <div className="h-[210px] w-full overflow-hidden rounded-2xl border bg-[var(--surface-muted)]">
                <img
                  src={details.mapPreviewUrl}
                  alt="Маршрут тренировки"
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                />
              </div>
            </div>
          </section>
        ) : null}

        <section className="app-card rounded-2xl border p-4 shadow-sm">
          <div className="app-text-secondary flex items-center gap-6 text-sm">
            <span>{likesCount} лайков</span>
            <span>{commentsCount} комментариев</span>
          </div>
        </section>

        <RunCommentsSection comments={comments} error={commentsError} onSubmitComment={handleCommentSubmit} />
      </div>
    </main>
  )
}
