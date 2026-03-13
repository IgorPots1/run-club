'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import RunRouteMapPreview, { hasRenderableRoutePolyline } from '@/components/RunRouteMapPreview'
import { getBootstrapUser } from '@/lib/auth'
import { formatDistanceKm, formatRunTimestampLabel } from '@/lib/format'
import { getProfileDisplayName } from '@/lib/profiles'
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
  'id, user_id, name, title, external_source, distance_km, duration_minutes, duration_seconds, moving_time_seconds, average_pace_seconds, elevation_gain_meters, average_heartrate, max_heartrate, map_polyline, calories, average_cadence, created_at'

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
  return `${minutes}:${String(seconds).padStart(2, '0')}/км`
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
  const commentsCount = 0

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

        if (!isMounted) {
          return
        }

        setRun(runData as RunDetailsRow)
        setAuthor((profileResult.data as ProfileRow | null) ?? null)
        setLikesCount(Number(likesResult.count ?? 0))
      } catch {
        if (isMounted) {
          setError('Не удалось загрузить тренировку')
          setRun(null)
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
      averageHeartrateLabel:
        Number.isFinite(run.average_heartrate) && (run.average_heartrate ?? 0) > 0
          ? `${Math.round(run.average_heartrate ?? 0)} уд/мин`
          : null,
      maxHeartrateLabel:
        Number.isFinite(run.max_heartrate) && (run.max_heartrate ?? 0) > 0
          ? `${Math.round(run.max_heartrate ?? 0)} уд/мин`
          : null,
      hasMap: Boolean(run.map_polyline?.trim() && hasRenderableRoutePolyline(run.map_polyline)),
    }
  }, [run])

  if (authLoading || loading) {
    return (
      <main className="min-h-screen pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
        <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
          <div className="app-card rounded-xl border p-4 shadow-sm">
            <div className="skeleton-line h-5 w-40" />
            <div className="mt-2 skeleton-line h-4 w-32" />
            <div className="mt-4 space-y-2">
              <div className="skeleton-line h-4 w-28" />
              <div className="skeleton-line h-4 w-24" />
            </div>
          </div>
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
          <Link href="/dashboard" className="app-button-secondary inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm">
            Назад к тренировкам
          </Link>
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
        <Link href="/dashboard" className="app-button-secondary inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm">
          Назад к тренировкам
        </Link>

        <section className="app-card rounded-2xl border p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
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
            </div>
            {run.external_source === 'strava' ? (
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium">
                <StravaIcon />
                Strava
              </span>
            ) : null}
          </div>

          <h1 className="app-text-primary mt-4 break-words text-xl font-semibold">{getRunTitle(run)}</h1>

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            {details.distanceLabel ? (
              <div className="app-surface-muted rounded-xl p-3">
                <p className="app-text-secondary text-xs">Дистанция</p>
                <p className="app-text-primary mt-1 font-semibold">{details.distanceLabel}</p>
              </div>
            ) : null}
            {details.movingTimeLabel || details.durationLabel ? (
              <div className="app-surface-muted rounded-xl p-3">
                <p className="app-text-secondary text-xs">
                  {details.movingTimeLabel ? 'Время в движении' : 'Длительность'}
                </p>
                <p className="app-text-primary mt-1 font-semibold">
                  {details.movingTimeLabel || details.durationLabel}
                </p>
              </div>
            ) : null}
            {details.durationLabel && details.movingTimeLabel && details.durationLabel !== details.movingTimeLabel ? (
              <div className="app-surface-muted rounded-xl p-3">
                <p className="app-text-secondary text-xs">Общая длительность</p>
                <p className="app-text-primary mt-1 font-semibold">{details.durationLabel}</p>
              </div>
            ) : null}
            {details.paceLabel ? (
              <div className="app-surface-muted rounded-xl p-3">
                <p className="app-text-secondary text-xs">Средний темп</p>
                <p className="app-text-primary mt-1 font-semibold">{details.paceLabel}</p>
              </div>
            ) : null}
            {details.elevationLabel ? (
              <div className="app-surface-muted rounded-xl p-3">
                <p className="app-text-secondary text-xs">Набор высоты</p>
                <p className="app-text-primary mt-1 font-semibold">{details.elevationLabel}</p>
              </div>
            ) : null}
            {details.averageHeartrateLabel ? (
              <div className="app-surface-muted rounded-xl p-3">
                <p className="app-text-secondary text-xs">Средний пульс</p>
                <p className="app-text-primary mt-1 font-semibold">{details.averageHeartrateLabel}</p>
              </div>
            ) : null}
            {details.maxHeartrateLabel ? (
              <div className="app-surface-muted rounded-xl p-3">
                <p className="app-text-secondary text-xs">Макс. пульс</p>
                <p className="app-text-primary mt-1 font-semibold">{details.maxHeartrateLabel}</p>
              </div>
            ) : null}
          </div>
        </section>

        {details.hasMap && run.map_polyline ? (
          <section className="app-card rounded-2xl border p-4 shadow-sm">
            <h2 className="app-text-primary text-base font-semibold">Маршрут</h2>
            <RunRouteMapPreview polyline={run.map_polyline} className="mt-3 h-44 w-full overflow-hidden rounded-xl border" />
          </section>
        ) : null}

        <section className="app-card rounded-2xl border p-4 shadow-sm">
          <h2 className="app-text-primary text-base font-semibold">Обсуждение</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="app-surface-muted rounded-xl p-3">
              <p className="app-text-secondary text-xs">Лайки</p>
              <p className="app-text-primary mt-1 font-semibold">{likesCount}</p>
            </div>
            <div className="app-surface-muted rounded-xl p-3">
              <p className="app-text-secondary text-xs">Комментарии</p>
              <p className="app-text-primary mt-1 font-semibold">{commentsCount}</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
