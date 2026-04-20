'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import MyShoesPicker from '@/components/MyShoesPicker'
import ParticipantIdentity from '@/components/ParticipantIdentity'
import RunPhotoLightbox from '@/components/RunPhotoLightbox'
import RunCommentsSection from '@/components/RunCommentsSection'
import WorkoutDetailShell from '@/components/WorkoutDetailShell'
import WorkoutMediaCarousel from '@/components/WorkoutMediaCarousel'
import { loadTotalXpByUserIds } from '@/lib/dashboard'
import { getBootstrapUser } from '@/lib/auth'
import { formatDistanceKm, formatRunTimestampLabel } from '@/lib/format'
import { getStaticMapUrl } from '@/lib/getStaticMapUrl'
import { consumeSeededRunDetail, type SeededRunDetailPayload } from '@/lib/run-detail-navigation'
import {
  loadRunComments,
  type RunCommentItem,
} from '@/lib/run-comments'
import { dispatchRunsUpdatedEvent } from '@/lib/runs-refresh'
import { useRunCommentsController } from '@/lib/use-run-comments-controller'
import { updateRun, type UpdateRunInput } from '@/lib/runs'
import {
  loadRunAssignedShoe,
  loadUserShoeSelectionData,
  type RunAssignedShoeSummary,
  type UserShoeRecord,
} from '@/lib/shoes-client'
import { uploadRunPhoto } from '@/lib/storage/uploadRunPhoto'
import { supabase } from '@/lib/supabase'
import { getLevelFromXP } from '@/lib/xp'
import type { User } from '@supabase/supabase-js'

type RunDetailsRow = {
  id: string
  user_id: string
  name: string | null
  title?: string | null
  description?: string | null
  shoe_id?: string | null
  name_manually_edited?: boolean
  description_manually_edited?: boolean
  city?: string | null
  region?: string | null
  country?: string | null
  external_source?: string | null
  external_id?: string | null
  distance_km: number | null
  duration_minutes: number | null
  duration_seconds?: number | null
  moving_time_seconds?: number | null
  elapsed_time_seconds?: number | null
  average_pace_seconds?: number | null
  elevation_gain_meters?: number | null
  average_heartrate?: number | null
  max_heartrate?: number | null
  calories?: number | null
  xp?: number | null
  map_polyline?: string | null
  raw_strava_payload?: Record<string, unknown> | null
  created_at: string
}

type ProfileRow = {
  id: string
  name: string | null
  nickname?: string | null
  email: string | null
  avatar_url?: string | null
}

type RunDetailSeriesPoint = {
  time: number
  value: number
}

type RunDetailDistanceSeriesPoint = {
  distance: number
  value: number
}

type RunDetailSeriesRow = {
  exists: boolean
  pace_points: RunDetailSeriesPoint[] | null
  heartrate_points: RunDetailSeriesPoint[] | null
  cadence_points: RunDetailSeriesPoint[] | null
  altitude_points: RunDetailDistanceSeriesPoint[] | null
}

type RunLapRow = {
  lap_index: number
  distance_meters: number | null
  elapsed_time_seconds: number | null
  pace_seconds_per_km: number | null
  average_heartrate: number | null
  total_elevation_gain?: number | null
}

type RunPhotoRow = {
  id: string
  public_url: string
  thumbnail_url: string | null
  sort_order: number
  created_at?: string | null
}

type InsertedRunPhotoRow = RunPhotoRow

const EMPTY_RUN_DETAIL_SERIES: RunDetailSeriesRow = {
  exists: false,
  pace_points: null,
  heartrate_points: null,
  cadence_points: null,
  altitude_points: null,
}

const RUN_DETAILS_SELECT_WITH_OPTIONAL_COLUMNS =
  'id, user_id, name, title, description, shoe_id, name_manually_edited, description_manually_edited, city, region, country, external_source, external_id, distance_km, duration_minutes, duration_seconds, moving_time_seconds, elapsed_time_seconds, average_pace_seconds, elevation_gain_meters, average_heartrate, max_heartrate, xp, map_polyline, raw_strava_payload, calories, average_cadence, created_at'

const RUN_DETAILS_SELECT_LEGACY =
  'id, user_id, name, title, shoe_id, external_source, external_id, distance_km, duration_minutes, duration_seconds, moving_time_seconds, elapsed_time_seconds, average_pace_seconds, elevation_gain_meters, created_at'

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
    message.includes('raw_strava_payload') ||
    message.includes('external_id') ||
    message.includes('calories') ||
    message.includes('average_cadence') ||
    message.includes('description') ||
    message.includes('name_manually_edited') ||
    message.includes('description_manually_edited') ||
    message.includes('city') ||
    message.includes('region') ||
    message.includes('country')
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

function normalizeRunDetailSeriesPoints(value: unknown): RunDetailSeriesPoint[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const points = value
    .filter(
      (point): point is { time?: unknown; value?: unknown; x?: unknown; y?: unknown } =>
        typeof point === 'object' && point !== null
    )
    .map((point) => ({
      time: Number(point.time ?? point.x),
      value: Number(point.value ?? point.y),
    }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))

  return points.length > 0 ? points : null
}

function normalizeRunDetailDistanceSeriesPoints(value: unknown): RunDetailDistanceSeriesPoint[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const points = value
    .filter(
      (point): point is { distance?: unknown; value?: unknown; x?: unknown; y?: unknown } =>
        typeof point === 'object' && point !== null
    )
    .map((point) => ({
      distance: Number(point.distance ?? point.x),
      value: Number(point.value ?? point.y),
    }))
    .filter((point) => Number.isFinite(point.distance) && point.distance >= 0 && Number.isFinite(point.value))

  return points.length > 0 ? points : null
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

function getSeededRunTitle(run: Pick<SeededRunDetailPayload, 'title'>) {
  return run.title.trim() || 'Тренировка'
}

function toNullableTrimmedText(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

function resolveWorkoutDetailScrollTarget(scrollContainer: HTMLDivElement | null) {
  if (typeof window === 'undefined') {
    return null
  }

  if (!scrollContainer) {
    return window
  }

  const computedStyle = window.getComputedStyle(scrollContainer)
  const isScrollableContainer = /(auto|scroll|overlay)/.test(computedStyle.overflowY)

  if (isScrollableContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight + 1) {
    return scrollContainer
  }

  return window
}

function formatSeededPaceLabel(pace: string | number | null | undefined) {
  if (typeof pace === 'number' && Number.isFinite(pace) && pace > 0) {
    return formatPaceLabel(pace)
  }

  if (typeof pace !== 'string') {
    return null
  }

  const trimmedPace = pace.trim()

  if (!trimmedPace) {
    return null
  }

  return trimmedPace.endsWith('/км') ? trimmedPace : `${trimmedPace} /км`
}

function buildSeededRunLocationLabel(run: Pick<SeededRunDetailPayload, 'city' | 'country'>) {
  const uniqueParts = [run.city, run.country].reduce<string[]>((parts, value) => {
    const trimmedValue = toNullableTrimmedText(value)

    if (!trimmedValue || parts.includes(trimmedValue)) {
      return parts
    }

    return [...parts, trimmedValue]
  }, [])

  return uniqueParts.length > 0 ? uniqueParts.join(', ') : null
}

function RunDetailChartsPlaceholder() {
  return (
    <>
      <section className="app-card rounded-2xl border p-4 shadow-sm" aria-hidden="true">
        <div className="skeleton-line h-6 w-28" />
        <div className="mt-3 overflow-hidden rounded-xl border">
          <div className="grid grid-cols-[56px_1fr_1fr_1fr] gap-3 border-b px-3 py-2">
            <div className="skeleton-line h-3 w-6" />
            <div className="skeleton-line h-3 w-12" />
            <div className="skeleton-line h-3 w-16" />
            <div className="skeleton-line h-3 w-14" />
          </div>
          <div className="space-y-3 px-3 py-3">
            <div className="grid grid-cols-[56px_1fr_1fr_1fr] gap-3">
              <div className="skeleton-line h-4 w-8" />
              <div className="skeleton-line h-4 w-12" />
              <div className="skeleton-line h-4 w-14" />
              <div className="skeleton-line h-4 w-14" />
            </div>
            <div className="grid grid-cols-[56px_1fr_1fr_1fr] gap-3">
              <div className="skeleton-line h-4 w-8" />
              <div className="skeleton-line h-4 w-12" />
              <div className="skeleton-line h-4 w-14" />
              <div className="skeleton-line h-4 w-14" />
            </div>
          </div>
        </div>
      </section>

      <section className="app-card rounded-2xl border p-4 shadow-sm" aria-hidden="true">
        <div className="skeleton-line h-6 w-20" />
        <div className="mt-3 h-[220px] w-full rounded-xl skeleton-line" />
      </section>
    </>
  )
}

const RunDetailCharts = dynamic(() => import('./RunDetailCharts'), {
  ssr: false,
  loading: () => <RunDetailChartsPlaceholder />,
})

export default function RunDetailsPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const runId = typeof params?.id === 'string' ? params.id : ''
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [run, setRun] = useState<RunDetailsRow | null>(null)
  const [runSeries, setRunSeries] = useState<RunDetailSeriesRow>(EMPTY_RUN_DETAIL_SERIES)
  const [runLaps, setRunLaps] = useState<RunLapRow[]>([])
  const [runPhotos, setRunPhotos] = useState<RunPhotoRow[]>([])
  const [author, setAuthor] = useState<ProfileRow | null>(null)
  const [authorLevel, setAuthorLevel] = useState(1)
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [commentsError, setCommentsError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const [isDescriptionTruncated, setIsDescriptionTruncated] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [draft, setDraft] = useState({
    name: '',
    description: '',
    shoeId: '',
  })
  const [saveError, setSaveError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [availableShoes, setAvailableShoes] = useState<UserShoeRecord[]>([])
  const [fallbackAssignedShoe, setFallbackAssignedShoe] = useState<RunAssignedShoeSummary | null>(null)
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null)
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const [uploadPhotosError, setUploadPhotosError] = useState('')
  const [isShoePickerOpen, setIsShoePickerOpen] = useState(false)
  const [refreshingStravaSupplemental, setRefreshingStravaSupplemental] = useState(false)
  const [stravaSupplementalError, setStravaSupplementalError] = useState('')
  const [stravaSupplementalInfoMessage, setStravaSupplementalInfoMessage] = useState('')
  const [seededRun, setSeededRun] = useState<SeededRunDetailPayload | null>(() => consumeSeededRunDetail(runId))
  const [shouldMountCharts, setShouldMountCharts] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const descriptionRef = useRef<HTMLParagraphElement | null>(null)
  const previousIsEditModeRef = useRef(false)
  const shouldScrollToTopOnEditExitRef = useRef(true)
  const previousRouteRunIdRef = useRef(runId)
  const currentRunIdRef = useRef(runId)
  const activeRunRequestIdRef = useRef(0)
  currentRunIdRef.current = runId
  const activeRun = run?.id === runId ? run : null
  const activeSeededRun = seededRun?.runId === runId ? seededRun : null
  const hasMismatchedRunState = Boolean(run && run.id !== runId)
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
  } = useRunCommentsController({
    runId,
    currentUserId: user?.id ?? null,
    onAuthRequired: handleAuthRequired,
  })

  useLayoutEffect(() => {
    if (previousRouteRunIdRef.current === runId) {
      return
    }

    previousRouteRunIdRef.current = runId
    setSeededRun(consumeSeededRunDetail(runId))
    setLoading(true)
    setError('')
    setRun(null)
    setRunSeries(EMPTY_RUN_DETAIL_SERIES)
    setRunLaps([])
    setRunPhotos([])
    setAuthor(null)
    setAuthorLevel(1)
    setAvailableShoes([])
    setFallbackAssignedShoe(null)
    replaceComments([])
    setCommentsLoading(true)
    setCommentsError('')
    setDescriptionExpanded(false)
    setIsDescriptionTruncated(false)
    setIsEditMode(false)
    setSaveError('')
    setUploadPhotosError('')
    setSelectedPhotoIndex(null)
    setIsShoePickerOpen(false)
    setRefreshingStravaSupplemental(false)
    setStravaSupplementalError('')
    setStravaSupplementalInfoMessage('')
  }, [replaceComments, runId])

  useEffect(() => {
    if (activeRun?.id === runId || error) {
      setSeededRun(null)
    }
  }, [activeRun?.id, error, runId])

  async function handleCommentSubmit(comment: string) {
    if (!run) {
      throw new Error('missing_context')
    }

    const trimmedComment = comment.trim()

    if (!trimmedComment) {
      throw new Error('empty_comment')
    }

    await createComment(trimmedComment)
    setCommentsError('')
    dispatchRunsUpdatedEvent()
  }

  async function handleReplySubmit(parentId: string, comment: string) {
    if (!run) {
      throw new Error('missing_context')
    }

    const trimmedComment = comment.trim()

    if (!trimmedComment) {
      throw new Error('empty_comment')
    }

    await createComment(trimmedComment, parentId)
    setCommentsError('')
    dispatchRunsUpdatedEvent()
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
    dispatchRunsUpdatedEvent()
  }

  async function handleToggleLikeComment(commentId: string) {
    await toggleLikeComment(commentId)
  }

  function handleOpenPhotoPicker() {
    if (!photoInputRef.current || uploadingPhotos || !isOwner || !isEditMode) {
      return
    }

    photoInputRef.current.value = ''
    photoInputRef.current.click()
  }

  async function handlePhotoInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target
    const files = Array.from(input.files ?? [])
    input.value = ''

    if (files.length === 0) {
      return
    }

    if (!user || !run || !isOwner || !isEditMode || uploadingPhotos) {
      setUploadPhotosError('Добавлять фото может только владелец тренировки')
      return
    }

    if (files.some((file) => !file.type.startsWith('image/'))) {
      setUploadPhotosError('Можно загрузить только изображения')
      return
    }

    setUploadingPhotos(true)
    setUploadPhotosError('')

    try {
      const baseSortOrder = runPhotos.reduce((maxValue, photo) => Math.max(maxValue, photo.sort_order), -1) + 1
      const insertedRows: InsertedRunPhotoRow[] = []

      for (const [index, file] of files.entries()) {
        const { path, publicUrl } = await uploadRunPhoto({
          file,
          userId: user.id,
          runId: run.id,
          index,
        })

        const insertPayload = {
          run_id: run.id,
          source: 'manual',
          source_photo_id: path,
          public_url: publicUrl,
          thumbnail_url: null,
          sort_order: baseSortOrder + index,
          metadata: {
            storage_path: path,
            original_file_name: file.name,
            mime_type: file.type || null,
            size_bytes: Number.isFinite(file.size) ? file.size : null,
          },
        }

        const { data: insertedPhoto, error: insertError } = await supabase
          .from('run_photos')
          .insert(insertPayload)
          .select('id, public_url, thumbnail_url, sort_order, created_at')
          .single()

        if (insertError) {
          throw insertError
        }

        if (insertedPhoto) {
          insertedRows.push(insertedPhoto as InsertedRunPhotoRow)
        }
      }

      if (insertedRows.length > 0) {
        setRunPhotos((currentPhotos) =>
          [...currentPhotos, ...insertedRows].sort((left, right) => {
            if (left.sort_order !== right.sort_order) {
              return left.sort_order - right.sort_order
            }

            const leftCreatedAt = left.created_at ?? ''
            const rightCreatedAt = right.created_at ?? ''

            if (leftCreatedAt !== rightCreatedAt) {
              return leftCreatedAt.localeCompare(rightCreatedAt)
            }

            return left.id.localeCompare(right.id)
          })
        )
      }
    } catch (caughtError) {
      console.error('Failed to upload run photos', caughtError)
      setUploadPhotosError('Не удалось загрузить фото')
    } finally {
      setUploadingPhotos(false)
    }
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
      const requestId = activeRunRequestIdRef.current + 1
      activeRunRequestIdRef.current = requestId
      const requestedRunId = runId
      const isCurrentRequest = () =>
        isMounted &&
        activeRunRequestIdRef.current === requestId &&
        currentRunIdRef.current === requestedRunId

      if (authLoading) {
        return
      }

      if (!user) {
        if (isCurrentRequest()) {
          setRun(null)
          setRunSeries(EMPTY_RUN_DETAIL_SERIES)
          setRunLaps([])
          setRunPhotos([])
          setCommentsLoading(false)
          setLoading(false)
        }
        return
      }

      if (!requestedRunId) {
        if (isCurrentRequest()) {
          setError('Тренировка не найдена')
          setRun(null)
          setRunSeries(EMPTY_RUN_DETAIL_SERIES)
          setRunLaps([])
          setRunPhotos([])
          setCommentsLoading(false)
          setLoading(false)
        }
        return
      }

      setLoading(true)
      setError('')
      setRunSeries(EMPTY_RUN_DETAIL_SERIES)
      setRunLaps([])
      setRunPhotos([])
      setAuthor(null)
      setAuthorLevel(1)
      replaceComments([])
      setCommentsLoading(true)
      setCommentsError('')

      try {
        const { data: runData, error: runError } = await loadRunDetailsRow(requestedRunId)

        if (runError) {
          if (isCurrentRequest()) {
            setError('Не удалось загрузить тренировку')
            setRun(null)
            setRunSeries(EMPTY_RUN_DETAIL_SERIES)
            setRunLaps([])
            setRunPhotos([])
            setCommentsLoading(false)
          }
          return
        }

        if (!runData) {
          if (isCurrentRequest()) {
            setError('Тренировка не найдена')
            setRun(null)
            setRunSeries(EMPTY_RUN_DETAIL_SERIES)
            setRunLaps([])
            setRunPhotos([])
            setCommentsLoading(false)
          }
          return
        }

        const profilePromise = supabase
          .from('profiles')
          .select('id, name, nickname, email, avatar_url')
          .eq('id', runData.user_id)
          .maybeSingle()
        const secondaryDataPromise = Promise.all([
          supabase
            .from('run_detail_series')
            .select('pace_points, heartrate_points, cadence_points, altitude_points')
            .eq('run_id', runData.id)
            .maybeSingle(),
          supabase
            .from('run_laps')
            .select(
              'lap_index, distance_meters, elapsed_time_seconds, pace_seconds_per_km, average_heartrate, total_elevation_gain'
            )
            .eq('run_id', runData.id)
            .order('lap_index', { ascending: true }),
          supabase
            .from('run_photos')
            .select('id, public_url, thumbnail_url, sort_order, created_at')
            .eq('run_id', runData.id)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true })
            .order('id', { ascending: true }),
          loadTotalXpByUserIds([runData.user_id]).catch(() => ({} as Record<string, number>)),
        ])
        const commentsPromise = loadRunComments(runData.id, user.id)

        const profileResult = await profilePromise

        if (!isCurrentRequest()) {
          return
        }

        setRun(runData as RunDetailsRow)
        setAuthor((profileResult.data as ProfileRow | null) ?? null)
        setLoading(false)

        void secondaryDataPromise.then(([seriesResult, lapsResult, photosResult, totalXpByUser]) => {
          if (!isCurrentRequest()) {
            return
          }

          const normalizedRunSeries = seriesResult.error
            ? EMPTY_RUN_DETAIL_SERIES
            : {
                exists: Boolean(seriesResult.data),
                pace_points: normalizeRunDetailSeriesPoints(seriesResult.data?.pace_points),
                heartrate_points: normalizeRunDetailSeriesPoints(seriesResult.data?.heartrate_points),
                cadence_points: normalizeRunDetailSeriesPoints(seriesResult.data?.cadence_points),
                altitude_points: normalizeRunDetailDistanceSeriesPoints(seriesResult.data?.altitude_points),
              }

          setRunSeries(normalizedRunSeries)
          setRunLaps(((lapsResult.data as RunLapRow[] | null) ?? []).filter((lap) => Number.isFinite(lap.lap_index)))
          setRunPhotos(
            ((photosResult.data as Array<RunPhotoRow & { created_at?: string | null }> | null) ?? []).filter(
              (photo): photo is RunPhotoRow =>
                typeof photo.id === 'string' &&
                typeof photo.public_url === 'string' &&
                photo.public_url.trim().length > 0 &&
                Number.isFinite(photo.sort_order)
            )
          )
          setAuthorLevel(getLevelFromXP(totalXpByUser[runData.user_id] ?? 0).level)
        })

        void commentsPromise
          .then((runComments: RunCommentItem[]) => {
            if (!isCurrentRequest()) {
              return
            }

            replaceComments(runComments)
            setCommentsError('')
          })
          .catch(() => {
            if (!isCurrentRequest()) {
              return
            }

            replaceComments([])
            setCommentsError('Не удалось загрузить комментарии')
          })
          .finally(() => {
            if (isCurrentRequest()) {
              setCommentsLoading(false)
            }
          })
      } catch {
        if (isCurrentRequest()) {
          setError('Не удалось загрузить тренировку')
          setRun(null)
          setRunSeries(EMPTY_RUN_DETAIL_SERIES)
          setRunLaps([])
          setRunPhotos([])
          replaceComments([])
          setCommentsLoading(false)
        }
      } finally {
        if (isCurrentRequest()) {
          setLoading(false)
        }
      }
    }

    void loadRunDetails()

    return () => {
      isMounted = false
    }
  }, [authLoading, reloadKey, replaceComments, runId, user])

  useEffect(() => {
    if (isEditMode) {
      return
    }

    setDraft({
      name: activeRun?.name ?? activeRun?.title ?? '',
      description: activeRun?.description ?? '',
      shoeId: activeRun?.shoe_id ?? '',
    })
  }, [activeRun?.description, activeRun?.name, activeRun?.shoe_id, activeRun?.title, isEditMode])

  const runDescription = useMemo(() => toNullableTrimmedText(activeRun?.description), [activeRun?.description])

  useEffect(() => {
    if (previousIsEditModeRef.current && !isEditMode && shouldScrollToTopOnEditExitRef.current) {
      window.requestAnimationFrame(() => {
        ;(resolveWorkoutDetailScrollTarget(scrollContainerRef.current) ?? window).scrollTo({ top: 0, behavior: 'auto' })
      })
    }

    if (!isEditMode) {
      shouldScrollToTopOnEditExitRef.current = true
    }

    previousIsEditModeRef.current = isEditMode
  }, [isEditMode])

  useEffect(() => {
    setDescriptionExpanded(false)
  }, [runDescription])

  useEffect(() => {
    if (!runDescription) {
      setIsDescriptionTruncated(false)
      return
    }

    if (descriptionExpanded) {
      return
    }

    const descriptionElement = descriptionRef.current

    if (!descriptionElement) {
      return
    }

    const measureTruncation = () => {
      setIsDescriptionTruncated(descriptionElement.scrollHeight > descriptionElement.clientHeight + 1)
    }

    measureTruncation()
    window.addEventListener('resize', measureTruncation)

    return () => {
      window.removeEventListener('resize', measureTruncation)
    }
  }, [descriptionExpanded, runDescription])

  useEffect(() => {
    if (!stravaSupplementalInfoMessage) {
      return
    }

    const timer = window.setTimeout(() => {
      setStravaSupplementalInfoMessage('')
    }, 3200)

    return () => {
      window.clearTimeout(timer)
    }
  }, [stravaSupplementalInfoMessage])

  useEffect(() => {
    let isMounted = true

    if (!user || !activeRun || user.id !== activeRun.user_id) {
      setAvailableShoes([])
      return () => {
        isMounted = false
      }
    }

    void loadUserShoeSelectionData({
      activeOnly: true,
      includeShoeId: activeRun.shoe_id ?? null,
    })
      .then((selectionData) => {
        if (isMounted) {
          setAvailableShoes(selectionData.shoes)
        }
      })
      .catch(() => {
        if (isMounted) {
          setAvailableShoes([])
        }
      })

    return () => {
      isMounted = false
    }
  }, [activeRun, user])

  useEffect(() => {
    let isMounted = true

    if (!activeRun?.shoe_id || !user || user.id === activeRun.user_id) {
      setFallbackAssignedShoe(null)
      return () => {
        isMounted = false
      }
    }

    void loadRunAssignedShoe(activeRun.id)
      .then((shoe) => {
        if (isMounted) {
          setFallbackAssignedShoe(shoe)
        }
      })
      .catch(() => {
        if (isMounted) {
          setFallbackAssignedShoe(null)
        }
      })

    return () => {
      isMounted = false
    }
  }, [activeRun, user])
  const hasDeferredChartsContent = Boolean(
    activeRun &&
    (
      runLaps.length > 0 ||
      (runSeries.pace_points?.length ?? 0) > 1 ||
      (runSeries.heartrate_points?.length ?? 0) > 1 ||
      (runSeries.cadence_points?.length ?? 0) > 1 ||
      (runSeries.altitude_points?.length ?? 0) > 1
    )
  )

  useEffect(() => {
    if (isEditMode || !hasDeferredChartsContent) {
      setShouldMountCharts(false)
      return
    }

    const timer = window.setTimeout(() => {
      setShouldMountCharts(true)
    }, 180)

    return () => {
      window.clearTimeout(timer)
    }
  }, [hasDeferredChartsContent, isEditMode, runId])

  const runLocationLabel = useMemo(() => {
    const uniqueParts = [activeRun?.city, activeRun?.region, activeRun?.country].reduce<string[]>((parts, value) => {
      const trimmedValue = toNullableTrimmedText(value)

      if (!trimmedValue || parts.includes(trimmedValue)) {
        return parts
      }

      return [...parts, trimmedValue]
    }, [])

    return uniqueParts.length > 0 ? uniqueParts.join(', ') : null
  }, [activeRun?.city, activeRun?.country, activeRun?.region])
  const isOwner = Boolean(user && activeRun && user.id === activeRun.user_id)
  const canRefreshStravaSupplemental = Boolean(
    isOwner &&
    activeRun?.external_source === 'strava' &&
    typeof activeRun?.external_id === 'string' &&
    activeRun.external_id.trim().length > 0
  )
  const isMissingOfficialLaps = canRefreshStravaSupplemental && runLaps.length === 0
  const currentEditableName = activeRun?.name ?? activeRun?.title ?? ''
  const normalizedDraftName = toNullableTrimmedText(draft.name)
  const normalizedDraftDescription = toNullableTrimmedText(draft.description)
  const normalizedDraftShoeId = draft.shoeId || null
  const hasTitleChanged = normalizedDraftName !== toNullableTrimmedText(currentEditableName)
  const hasDescriptionChanged = normalizedDraftDescription !== toNullableTrimmedText(activeRun?.description)
  const hasShoeChanged = normalizedDraftShoeId !== (activeRun?.shoe_id ?? null)
  const currentAssignedShoe =
    availableShoes.find((shoe) => shoe.id === (activeRun?.shoe_id ?? '')) ?? fallbackAssignedShoe
  const currentAssignedShoeLabel = currentAssignedShoe
    ? `${currentAssignedShoe.displayName}${currentAssignedShoe.nickname ? ` (${currentAssignedShoe.nickname})` : ''}${!currentAssignedShoe.isActive ? ' • архив' : ''}`
    : ''
  const selectedDraftShoe =
    availableShoes.find((shoe) => shoe.id === draft.shoeId) ??
    (draft.shoeId && draft.shoeId === (activeRun?.shoe_id ?? '') ? currentAssignedShoe : null)
  const selectedDraftShoeLabel = selectedDraftShoe
    ? `${selectedDraftShoe.displayName}${selectedDraftShoe.nickname ? ` (${selectedDraftShoe.nickname})` : ''}${!selectedDraftShoe.isActive ? ' • архив' : ''}`
    : 'Без кроссовок'
  const hasPendingChanges = hasTitleChanged || hasDescriptionChanged || hasShoeChanged

  function handleEnterEditMode() {
    if (!isOwner || !activeRun) {
      return
    }

    setDraft({
      name: activeRun.name ?? activeRun.title ?? '',
      description: activeRun.description ?? '',
      shoeId: activeRun.shoe_id ?? '',
    })
    setSaveError('')
    setUploadPhotosError('')
    setIsShoePickerOpen(false)
    shouldScrollToTopOnEditExitRef.current = true
    setIsEditMode(true)
  }

  function handleCancelEditMode() {
    setDraft({
      name: activeRun?.name ?? activeRun?.title ?? '',
      description: activeRun?.description ?? '',
      shoeId: activeRun?.shoe_id ?? '',
    })
    setSaveError('')
    setUploadPhotosError('')
    setIsShoePickerOpen(false)
    shouldScrollToTopOnEditExitRef.current = true
    setIsEditMode(false)
  }

  async function handleSaveEditMode() {
    if (!user || !activeRun || !isOwner || isSaving || !hasPendingChanges) {
      return
    }

    const updates: UpdateRunInput = {}
    const nextRunUpdates: Partial<RunDetailsRow> = {}

    if (hasTitleChanged) {
      updates.name = normalizedDraftName
      updates.nameManuallyEdited = true
      nextRunUpdates.name = normalizedDraftName
      nextRunUpdates.name_manually_edited = true
    }

    if (hasDescriptionChanged) {
      updates.description = normalizedDraftDescription
      updates.descriptionManuallyEdited = true
      nextRunUpdates.description = normalizedDraftDescription
      nextRunUpdates.description_manually_edited = true
    }

    if (hasShoeChanged) {
      updates.shoeId = normalizedDraftShoeId
      nextRunUpdates.shoe_id = normalizedDraftShoeId
    }

    setIsSaving(true)
    setSaveError('')

    try {
      const { error: updateError } = await updateRun(activeRun.id, updates)

      if (updateError) {
        setSaveError('Не удалось сохранить изменения')
        return
      }

      shouldScrollToTopOnEditExitRef.current = false
      setRun((currentRun) => (currentRun ? { ...currentRun, ...nextRunUpdates } : currentRun))
      setDescriptionExpanded(false)
      setIsShoePickerOpen(false)
      setSaveError('')
      setIsEditMode(false)
      dispatchRunsUpdatedEvent()
    } catch {
      setSaveError('Не удалось сохранить изменения')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRefreshStravaSupplemental() {
    if (!runId || !canRefreshStravaSupplemental || refreshingStravaSupplemental) {
      return
    }

    setRefreshingStravaSupplemental(true)
    setStravaSupplementalError('')
    setStravaSupplementalInfoMessage('')

    try {
      const response = await fetch(`/api/runs/${runId}/strava-backfill`, {
        method: 'POST',
      })

      if (response.status === 401) {
        router.replace('/login')
        return
      }

      const payload = (await response.json().catch(() => null)) as
        | { ok: true; synced?: boolean }
        | { ok: false; error?: string }
        | null

      if (!response.ok || !payload?.ok) {
        setStravaSupplementalError('Не удалось обновить данные из Strava')
        return
      }

      if (payload.synced) {
        setStravaSupplementalInfoMessage('Данные из Strava обновлены')
        setReloadKey((currentValue) => currentValue + 1)
        return
      }

      setStravaSupplementalInfoMessage('Дополнительные данные Strava пока недоступны')
    } catch {
      setStravaSupplementalError('Не удалось обновить данные из Strava')
    } finally {
      setRefreshingStravaSupplemental(false)
    }
  }

  const details = useMemo(() => {
    if (!activeRun) {
      return null
    }

    const distanceKm = Number(activeRun.distance_km ?? 0)
    const totalDurationSeconds = getTotalDurationSeconds(activeRun)
    const movingTimeSeconds = Number.isFinite(activeRun.moving_time_seconds) && (activeRun.moving_time_seconds ?? 0) > 0
      ? Math.round(activeRun.moving_time_seconds ?? 0)
      : null
    const computedAveragePace = distanceKm > 0 && totalDurationSeconds > 0
      ? Math.round(totalDurationSeconds / distanceKm)
      : null
    const averagePaceSeconds = Number.isFinite(activeRun.average_pace_seconds) && (activeRun.average_pace_seconds ?? 0) > 0
      ? Math.round(activeRun.average_pace_seconds ?? 0)
      : computedAveragePace
    const distanceLabel = distanceKm > 0 ? `${formatDistanceKm(distanceKm)} км` : null
    const durationLabel = totalDurationSeconds > 0 ? formatDurationLabel(totalDurationSeconds) : null
    const movingTimeLabel =
      movingTimeSeconds && movingTimeSeconds > 0 ? formatDurationLabel(movingTimeSeconds) : null
    const paceLabel = averagePaceSeconds && averagePaceSeconds > 0 ? formatPaceLabel(averagePaceSeconds) : null
    const elevationLabel =
      Number.isFinite(activeRun.elevation_gain_meters) && (activeRun.elevation_gain_meters ?? 0) > 0
        ? `${Math.round(activeRun.elevation_gain_meters ?? 0)} м`
        : null
    const heartRateLabel =
      Number.isFinite(activeRun.average_heartrate) && (activeRun.average_heartrate ?? 0) > 0
        ? `${Math.round(activeRun.average_heartrate ?? 0)} уд/мин`
        : null
    const caloriesLabel =
      Number.isFinite(activeRun.calories) && (activeRun.calories ?? 0) > 0
        ? `${Math.round(activeRun.calories ?? 0)} ккал`
        : null

    return {
      distanceLabel,
      durationLabel,
      movingTimeLabel,
      paceLabel,
      elevationLabel,
      heartRateLabel,
      caloriesLabel,
      xpValue: Number.isFinite(activeRun.xp) && (activeRun.xp ?? 0) > 0
        ? Math.round(activeRun.xp ?? 0)
        : Math.max(0, Math.round(50 + distanceKm * 10)),
      mapPreviewUrl: activeRun.map_polyline ? getStaticMapUrl(activeRun.map_polyline) : null,
    }
  }, [activeRun])
  const seededDetails = useMemo(() => {
    if (!activeSeededRun) {
      return null
    }

    const distanceKm = Number(activeSeededRun.distance_km ?? 0)

    return {
      distanceLabel: distanceKm > 0 ? `${formatDistanceKm(distanceKm)} км` : null,
      movingTimeLabel: toNullableTrimmedText(activeSeededRun.movingTime),
      paceLabel: formatSeededPaceLabel(activeSeededRun.pace),
      xpValue: Number.isFinite(activeSeededRun.xp) && (activeSeededRun.xp ?? 0) > 0
        ? Math.round(activeSeededRun.xp ?? 0)
        : null,
      mapPreviewUrl: activeSeededRun.map_polyline ? getStaticMapUrl(activeSeededRun.map_polyline) : null,
    }
  }, [activeSeededRun])

  const summaryMetricItems = useMemo(() => {
    if (!details) {
      return []
    }

    return [
      { label: 'Расстояние', value: details.distanceLabel ?? '—', prominent: true },
      { label: 'Время', value: details.movingTimeLabel || details.durationLabel || '—' },
      { label: 'Темп', value: details.paceLabel ?? '—' },
      { label: 'Высота', value: details.elevationLabel ?? '—' },
      ...(details.heartRateLabel ? [{ label: 'Пульс', value: details.heartRateLabel }] : []),
      ...(details.caloriesLabel ? [{ label: 'Калории', value: details.caloriesLabel }] : []),
    ]
  }, [details])
  const seededSummaryMetricItems = useMemo(() => {
    if (!seededDetails) {
      return []
    }

    return [
      { label: 'Расстояние', value: seededDetails.distanceLabel ?? '—', prominent: true },
      { label: 'Время', value: seededDetails.movingTimeLabel ?? '—' },
      { label: 'Темп', value: seededDetails.paceLabel ?? '—' },
    ]
  }, [seededDetails])
  const seededRunLocationLabel = useMemo(
    () => (activeSeededRun ? buildSeededRunLocationLabel(activeSeededRun) : null),
    [activeSeededRun]
  )
  const seededRunPhotos = useMemo<RunPhotoRow[]>(
    () => (activeSeededRun?.photos ?? []).map((photo, index) => ({
      id: photo.id,
      public_url: photo.public_url,
      thumbnail_url: photo.thumbnail_url,
      sort_order: index,
      created_at: null,
    })),
    [activeSeededRun]
  )
  const shouldShowSeededDetail = Boolean(
    activeSeededRun &&
    !activeRun &&
    !error &&
    (authLoading || loading || hasMismatchedRunState)
  )

  if (authLoading || loading || hasMismatchedRunState) {
    if (shouldShowSeededDetail && activeSeededRun && seededDetails) {
      const seededHasMedia = Boolean(activeSeededRun.map_polyline?.trim()) || seededRunPhotos.length > 0

      return (
        <WorkoutDetailShell
          title="Тренировка"
          enableSourceRestore
          pinnedHeader
          scrollContainerRef={scrollContainerRef}
          scrollContentClassName="pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:pb-5 md:pt-5"
        >
          <div className="min-w-0 overflow-x-hidden space-y-4">
            {seededHasMedia ? (
              <section>
                <WorkoutMediaCarousel
                  mapPolyline={activeSeededRun.map_polyline}
                  mapPreviewUrl={seededDetails.mapPreviewUrl}
                  photos={seededRunPhotos}
                  allowSwipeMode="always"
                  enableMapFallbackPreview
                  onOpenPhoto={setSelectedPhotoIndex}
                />
              </section>
            ) : null}

            <section className="app-card rounded-2xl border p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {activeSeededRun.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={activeSeededRun.avatar_url}
                      alt=""
                      className="h-11 w-11 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-11 w-11 shrink-0 rounded-full bg-[var(--surface-muted)] ring-1 ring-black/5 dark:ring-white/10" />
                  )}
                  <div className="min-w-0">
                    <p className="app-text-primary break-words text-[15px] font-semibold">
                      {activeSeededRun.displayName.trim() || 'Бегун'}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <p className="app-text-secondary max-w-[6.5rem] text-right text-xs sm:max-w-none sm:text-sm">
                    {formatRunTimestampLabel(activeSeededRun.created_at, null)}
                  </p>
                  {seededDetails.xpValue != null ? (
                    <p className="app-text-muted mt-1 text-right text-xs font-medium">
                      +{seededDetails.xpValue} XP
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-3">
                <h1 className="app-text-primary min-w-0 break-words text-base font-semibold">
                  {getSeededRunTitle(activeSeededRun)}
                </h1>
              </div>

              {seededRunLocationLabel ? (
                <div className="mt-2 space-y-1">
                  <p className="app-text-secondary text-sm leading-5">{seededRunLocationLabel}</p>
                </div>
              ) : null}

              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
                {seededSummaryMetricItems.map((metric) => (
                  <div key={metric.label} className="grid content-start gap-1">
                    <p className="app-text-secondary text-xs font-medium leading-tight">{metric.label}</p>
                    <p
                      className={`app-text-primary leading-tight ${
                        metric.prominent ? 'text-2xl font-semibold tracking-tight' : 'text-xl font-semibold'
                      }`}
                    >
                      {metric.value}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section className="app-card rounded-2xl border p-4 shadow-sm" aria-hidden="true">
              <div className="skeleton-line h-6 w-28" />
              <div className="mt-3 overflow-hidden rounded-xl border">
                <div className="grid grid-cols-[56px_1fr_1fr_1fr] gap-3 border-b px-3 py-2">
                  <div className="skeleton-line h-3 w-6" />
                  <div className="skeleton-line h-3 w-12" />
                  <div className="skeleton-line h-3 w-16" />
                  <div className="skeleton-line h-3 w-14" />
                </div>
                <div className="space-y-3 px-3 py-3">
                  <div className="grid grid-cols-[56px_1fr_1fr_1fr] gap-3">
                    <div className="skeleton-line h-4 w-8" />
                    <div className="skeleton-line h-4 w-12" />
                    <div className="skeleton-line h-4 w-14" />
                    <div className="skeleton-line h-4 w-14" />
                  </div>
                  <div className="grid grid-cols-[56px_1fr_1fr_1fr] gap-3">
                    <div className="skeleton-line h-4 w-8" />
                    <div className="skeleton-line h-4 w-12" />
                    <div className="skeleton-line h-4 w-14" />
                    <div className="skeleton-line h-4 w-14" />
                  </div>
                </div>
              </div>
            </section>

            <section className="app-card rounded-2xl border p-4 shadow-sm" aria-hidden="true">
              <div className="skeleton-line h-6 w-20" />
              <div className="mt-3 h-[220px] w-full rounded-xl skeleton-line" />
            </section>

            <RunCommentsSection
              comments={comments}
              currentUserId={user?.id ?? null}
              loading
              error=""
              pendingLikeCommentIds={pendingLikeCommentIds}
            />
          </div>

          <RunPhotoLightbox
            key={selectedPhotoIndex ?? 'closed'}
            photos={seededRunPhotos}
            selectedIndex={selectedPhotoIndex}
            onClose={() => setSelectedPhotoIndex(null)}
          />
        </WorkoutDetailShell>
      )
    }

    return (
      <WorkoutDetailShell title="Тренировка" enableSourceRestore pinnedHeader>
      <div className="min-w-0 overflow-x-hidden space-y-4">
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
      </WorkoutDetailShell>
    )
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

  if (!activeRun || !details) {
    return (
      <WorkoutDetailShell title="Тренировка" enableSourceRestore pinnedHeader>
      <div className="min-w-0 overflow-x-hidden app-card rounded-xl border p-4 shadow-sm">
        <p className="text-sm text-red-600">{error || 'Тренировка не найдена'}</p>
      </div>
      </WorkoutDetailShell>
    )
  }

  const headerRightSlot = isOwner ? (
    isEditMode ? (
      <button
        type="button"
        onClick={() => {
          void handleSaveEditMode()
        }}
        disabled={isSaving || !hasPendingChanges}
        className="app-text-primary relative inline-flex min-h-11 w-full min-w-0 items-center justify-end overflow-hidden rounded-full px-0 text-right text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="whitespace-nowrap">
          Сохранить
        </span>
      </button>
    ) : (
      <button
        type="button"
        onClick={handleEnterEditMode}
        className="app-text-primary inline-flex min-h-11 max-w-full items-center justify-end truncate rounded-full px-0 text-right text-sm font-medium"
      >
        Изменить
      </button>
    )
  ) : null

  const detailScrollContentClassName =
    'pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:pb-5 md:pt-5'
  const hasMedia = Boolean(activeRun.map_polyline?.trim()) || runPhotos.length > 0

  return (
    <WorkoutDetailShell
      title="Тренировка"
      enableSourceRestore
      onBack={isEditMode ? handleCancelEditMode : undefined}
      pinnedHeader
      headerRightSlot={headerRightSlot}
      scrollContainerRef={scrollContainerRef}
      scrollContentClassName={detailScrollContentClassName}
    >
    <div className="min-w-0 overflow-x-hidden space-y-4">
      {hasMedia || isEditMode ? (
        <section className={isEditMode ? 'relative space-y-3' : undefined}>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => void handlePhotoInputChange(event)}
            className="hidden"
          />

          {isOwner && isEditMode ? (
            <button
              type="button"
              onClick={handleOpenPhotoPicker}
              disabled={uploadingPhotos}
              aria-label={uploadingPhotos ? 'Загружаем фото' : 'Добавить фото'}
              title={uploadingPhotos ? 'Загружаем фото' : 'Добавить фото'}
              className="app-button-secondary absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border p-0 text-xl leading-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              +
            </button>
          ) : null}

          {isEditMode && uploadPhotosError ? <p className="text-sm text-red-600">{uploadPhotosError}</p> : null}

          {hasMedia ? (
            <WorkoutMediaCarousel
              mapPolyline={activeRun.map_polyline}
              mapPreviewUrl={details.mapPreviewUrl}
              photos={runPhotos}
              allowSwipeMode="always"
              enableMapFallbackPreview
              onOpenPhoto={setSelectedPhotoIndex}
            />
          ) : (
            <div className="app-card rounded-2xl border p-4 shadow-sm">
              <p className="app-text-secondary text-sm">
                Добавьте фотографии тренировки, чтобы они появились в галерее.
              </p>
            </div>
          )}
        </section>
      ) : null}

      {isEditMode ? (
        <section className="app-card rounded-2xl border p-4 shadow-sm">
          <div className="mt-1">
            <label htmlFor="run-name" className="app-text-secondary text-sm font-medium">
              Название
            </label>
            <input
              id="run-name"
              type="text"
              value={draft.name}
              onChange={(event) => {
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  name: event.target.value,
                }))
                setSaveError('')
              }}
              placeholder="Введите название"
              disabled={isSaving}
              className="app-input mt-1 min-h-11 w-full rounded-lg border px-3 py-2"
            />
          </div>

          <div className="mt-4">
            <p className="app-text-secondary text-sm font-medium">Описание</p>

            <div className="mt-2">
              <textarea
                id="run-description"
                value={draft.description}
                onChange={(event) => {
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    description: event.target.value,
                  }))
                  setSaveError('')
                }}
                placeholder="Добавьте описание"
                disabled={isSaving}
                className="app-input min-h-28 w-full rounded-lg border px-3 py-2"
              />
              {saveError ? <p className="mt-2 text-sm text-red-600">{saveError}</p> : null}
            </div>
          </div>

          <div className="mt-4">
            <p className="app-text-secondary text-sm font-medium">Кроссовки</p>
            <button
              type="button"
              onClick={() => setIsShoePickerOpen((currentValue) => !currentValue)}
              disabled={isSaving}
              className="mt-2 flex w-full items-center justify-between gap-3 rounded-2xl border border-black/[0.05] px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.08]"
            >
              <span className="app-text-primary min-w-0 break-words text-sm font-medium">
                {selectedDraftShoeLabel}
              </span>
              <span className="app-text-secondary shrink-0 text-sm">{isShoePickerOpen ? 'Скрыть' : 'Выбрать'}</span>
            </button>

            {isShoePickerOpen ? (
              <div className="mt-2 rounded-2xl border border-black/[0.05] p-3 dark:border-white/[0.08]">
                <MyShoesPicker
                  shoes={availableShoes}
                  selectedShoeId={draft.shoeId}
                  onSelect={(nextShoeId) => {
                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      shoeId: nextShoeId,
                    }))
                    setSaveError('')
                    setIsShoePickerOpen(false)
                  }}
                  disabled={isSaving}
                  loading={false}
                  hint="Выберите пару для этой тренировки."
                />
              </div>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="app-card rounded-2xl border p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <ParticipantIdentity
              avatarUrl={author?.avatar_url ?? null}
              displayName={author?.nickname?.trim() || author?.name?.trim() || author?.email?.trim() || 'Бегун'}
              level={authorLevel}
              href={`/users/${activeRun.user_id}`}
              size="md"
            />
            <div className="flex shrink-0 flex-col items-end">
              <p className="app-text-secondary max-w-[6.5rem] text-right text-xs sm:max-w-none sm:text-sm">
                {formatRunTimestampLabel(activeRun.created_at, activeRun.external_source)}
              </p>
              <p className="app-text-muted mt-1 text-right text-xs font-medium">
                +{details.xpValue} XP
              </p>
            </div>
          </div>

          <div className="mt-3">
            <h1 className="app-text-primary min-w-0 break-words text-base font-semibold">{getRunTitle(activeRun)}</h1>
          </div>

          {runLocationLabel || currentAssignedShoeLabel ? (
            <div className="mt-2 space-y-1">
              {runLocationLabel ? (
                <p className="app-text-secondary text-sm leading-5">{runLocationLabel}</p>
              ) : null}
              {currentAssignedShoeLabel ? (
                <p className="app-text-secondary text-sm leading-5">
                  Кроссовки: {currentAssignedShoeLabel}
                </p>
              ) : null}
            </div>
          ) : null}

          {runDescription ? (
            <div className="mt-3">
              <p
                ref={descriptionRef}
                className={`app-text-primary break-words whitespace-pre-wrap text-sm font-medium leading-5 ${
                  descriptionExpanded ? '' : 'line-clamp-2'
                }`}
              >
                {runDescription}
              </p>

              {descriptionExpanded ? (
                <button
                  type="button"
                  onClick={() => setDescriptionExpanded(false)}
                  className="app-text-muted mt-1 inline text-xs font-medium transition-opacity hover:opacity-80"
                >
                  Скрыть
                </button>
              ) : isDescriptionTruncated ? (
                <button
                  type="button"
                  onClick={() => setDescriptionExpanded(true)}
                  className="app-text-muted mt-1 inline text-xs font-medium transition-opacity hover:opacity-80"
                >
                  Читать
                </button>
              ) : null}
            </div>
          ) : null}

          <div className={`${runDescription ? 'mt-3' : 'mt-4'} grid grid-cols-2 gap-x-4 gap-y-4`}>
            {summaryMetricItems.map((metric) => (
              <div key={metric.label} className="grid content-start gap-1">
                <p className="app-text-secondary text-xs font-medium leading-tight">{metric.label}</p>
                <p
                  className={`app-text-primary leading-tight ${
                    metric.prominent ? 'text-2xl font-semibold tracking-tight' : 'text-xl font-semibold'
                  }`}
                >
                  {metric.value}
                </p>
              </div>
            ))}
          </div>

          {isMissingOfficialLaps ? (
            <div className="mt-4 rounded-xl border px-4 py-3">
              <p className="app-text-secondary text-sm">
                Разбивка показана по расчетным данным. Официальные сплиты из Strava можно загрузить вручную.
              </p>
              <button
                type="button"
                onClick={() => {
                  void handleRefreshStravaSupplemental()
                }}
                disabled={refreshingStravaSupplemental}
                className="app-button-secondary mt-3 min-h-11 rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
              >
                {refreshingStravaSupplemental ? 'Обновляем из Strava...' : 'Обновить из Strava'}
              </button>
              {stravaSupplementalError ? <p className="mt-2 text-sm text-red-600">{stravaSupplementalError}</p> : null}
              {stravaSupplementalInfoMessage ? <p className="mt-2 text-sm text-green-700">{stravaSupplementalInfoMessage}</p> : null}
            </div>
          ) : null}
        </section>
      )}

      {!isEditMode ? (
        <>
          {hasDeferredChartsContent ? (
            shouldMountCharts ? (
              <RunDetailCharts
                run={activeRun}
                runSeries={runSeries}
                runLaps={runLaps}
              />
            ) : (
              <RunDetailChartsPlaceholder />
            )
          ) : null}

          <RunCommentsSection
            comments={comments}
            currentUserId={user?.id ?? null}
            loading={commentsLoading}
            error={commentsError}
            pendingLikeCommentIds={pendingLikeCommentIds}
            onSubmitComment={handleCommentSubmit}
            onToggleLikeComment={handleToggleLikeComment}
            onReplyComment={handleReplySubmit}
            onEditComment={handleEditComment}
            onDeleteComment={handleDeleteComment}
          />
        </>
      ) : null}
    </div>

    <RunPhotoLightbox
      key={selectedPhotoIndex ?? 'closed'}
      photos={runPhotos}
      selectedIndex={selectedPhotoIndex}
      onClose={() => setSelectedPhotoIndex(null)}
    />
    </WorkoutDetailShell>
  )
}
