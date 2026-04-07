'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Heart, LoaderCircle, Map } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import ParticipantIdentity from '@/components/ParticipantIdentity'
import RunPhotoLightbox from '@/components/RunPhotoLightbox'
import RunCommentsSection from '@/components/RunCommentsSection'
import RunRouteMapPreview from '@/components/RunRouteMapPreview'
import WorkoutDetailShell from '@/components/WorkoutDetailShell'
import { loadTotalXpByUserIds } from '@/lib/dashboard'
import { getBootstrapUser } from '@/lib/auth'
import { formatDistanceKm, formatRunTimestampLabel } from '@/lib/format'
import { getStaticMapUrl } from '@/lib/getStaticMapUrl'
import {
  countVisibleRunComments,
  loadRunComments,
  type RunCommentItem,
} from '@/lib/run-comments'
import {
  loadRunLikesSummaryForRunIds,
  subscribeToRunLikes,
  toggleRunLike,
} from '@/lib/run-likes'
import { useRunCommentsController } from '@/lib/use-run-comments-controller'
import { updateRun } from '@/lib/runs'
import { loadUserShoeSelectionData, type UserShoeRecord } from '@/lib/shoes-client'
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

type RunDetailSeriesPoint = {
  time: number
  value: number
}

type RunDetailSeriesRow = {
  exists: boolean
  pace_points: RunDetailSeriesPoint[] | null
  heartrate_points: RunDetailSeriesPoint[] | null
}

type RunLapRow = {
  lap_index: number
  distance_meters: number | null
  elapsed_time_seconds: number | null
  pace_seconds_per_km: number | null
  average_heartrate: number | null
}

type RunPhotoRow = {
  id: string
  public_url: string
  thumbnail_url: string | null
  sort_order: number
  created_at?: string | null
}

type InsertedRunPhotoRow = RunPhotoRow

type BreakdownRow = {
  index: number
  distanceMeters: number
  elapsedTimeSeconds: number
  paceSecondsPerKm: number | null
  averageHeartrate: number | null
}

const EMPTY_RUN_DETAIL_SERIES: RunDetailSeriesRow = {
  exists: false,
  pace_points: null,
  heartrate_points: null,
}

const RUN_DETAILS_SELECT_WITH_OPTIONAL_COLUMNS =
  'id, user_id, name, title, description, shoe_id, name_manually_edited, description_manually_edited, city, region, country, external_source, external_id, distance_km, duration_minutes, duration_seconds, moving_time_seconds, elapsed_time_seconds, average_pace_seconds, elevation_gain_meters, average_heartrate, max_heartrate, xp, map_polyline, calories, average_cadence, created_at'

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

function formatPaceTick(value: number) {
  const safePace = Math.max(1, Math.round(value))
  const minutes = Math.floor(safePace / 60)
  const seconds = safePace % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatElapsedMinutesLabel(value: number) {
  const totalSeconds = Math.max(0, Math.round(value * 60))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatBreakdownDistanceLabel(distanceMeters: number) {
  return `${(distanceMeters / 1000).toFixed(2)} км`
}

function formatBreakdownPaceLabel(averagePaceSeconds: number) {
  const safePace = Math.max(1, Math.round(averagePaceSeconds))
  const minutes = Math.floor(safePace / 60)
  const seconds = safePace % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}/км`
}

function formatHeartRateTick(value: number) {
  return `${Math.round(value)}`
}

function buildSeriesAnchors(
  points: RunDetailSeriesPoint[] | null | undefined,
  totalDurationSeconds: number
) {
  if (!Array.isArray(points) || points.length === 0 || totalDurationSeconds <= 0) {
    return [] as RunDetailSeriesPoint[]
  }

  const sortedPoints = points
    .map((point) => ({
      time: Math.max(0, Math.min(totalDurationSeconds, point.time)),
      value: point.value,
    }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
    .sort((left, right) => left.time - right.time)

  if (sortedPoints.length === 0) {
    return []
  }

  const anchors: RunDetailSeriesPoint[] = []

  if (sortedPoints[0].time > 0) {
    anchors.push({ time: 0, value: sortedPoints[0].value })
  }

  for (const point of sortedPoints) {
    const previousPoint = anchors[anchors.length - 1]

    if (previousPoint && previousPoint.time === point.time) {
      previousPoint.value = point.value
      continue
    }

    anchors.push(point)
  }

  const lastPoint = anchors[anchors.length - 1]

  if (!lastPoint) {
    return []
  }

  if (lastPoint.time < totalDurationSeconds) {
    anchors.push({
      time: totalDurationSeconds,
      value: lastPoint.value,
    })
  } else if (lastPoint.time > totalDurationSeconds) {
    lastPoint.time = totalDurationSeconds
  }

  return anchors.length >= 2 ? anchors : []
}

function getAverageSeriesValueForInterval(
  anchors: RunDetailSeriesPoint[],
  startTimeSeconds: number,
  endTimeSeconds: number
) {
  if (anchors.length < 2 || endTimeSeconds <= startTimeSeconds) {
    return null
  }

  let weightedValueSum = 0
  let totalCoveredSeconds = 0

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const segmentStart = anchors[index].time
    const segmentEnd = anchors[index + 1].time
    const overlapStart = Math.max(startTimeSeconds, segmentStart)
    const overlapEnd = Math.min(endTimeSeconds, segmentEnd)

    if (overlapEnd <= overlapStart) {
      continue
    }

    const overlapDuration = overlapEnd - overlapStart
    weightedValueSum += anchors[index].value * overlapDuration
    totalCoveredSeconds += overlapDuration
  }

  return totalCoveredSeconds > 0 ? weightedValueSum / totalCoveredSeconds : null
}

function buildFallbackBreakdownRows(params: {
  pacePoints: RunDetailSeriesPoint[] | null | undefined
  heartratePoints: RunDetailSeriesPoint[] | null | undefined
  totalDurationSeconds: number | null
  totalDistanceKm: number | null
}) {
  const totalDurationSeconds = params.totalDurationSeconds ?? 0
  const paceAnchors = buildSeriesAnchors(params.pacePoints, totalDurationSeconds)

  if (paceAnchors.length < 2 || totalDurationSeconds <= 0) {
    return [] as BreakdownRow[]
  }

  const heartrateAnchors = buildSeriesAnchors(params.heartratePoints, totalDurationSeconds)
  const rawSegments = paceAnchors
    .slice(0, -1)
    .map((point, index) => {
      const nextPoint = paceAnchors[index + 1]
      const durationSeconds = nextPoint.time - point.time

      if (!Number.isFinite(point.value) || point.value <= 0 || durationSeconds <= 0) {
        return null
      }

      return {
        startTimeSeconds: point.time,
        endTimeSeconds: nextPoint.time,
        durationSeconds,
        distanceKm: durationSeconds / point.value,
      }
    })
    .filter((segment): segment is {
      startTimeSeconds: number
      endTimeSeconds: number
      durationSeconds: number
      distanceKm: number
    } => segment != null && Number.isFinite(segment.distanceKm) && segment.distanceKm > 0)

  if (rawSegments.length === 0) {
    return []
  }

  const derivedDistanceKm = rawSegments.reduce((sum, segment) => sum + segment.distanceKm, 0)
  const targetDistanceKm =
    Number.isFinite(params.totalDistanceKm) && (params.totalDistanceKm ?? 0) > 0
      ? Number(params.totalDistanceKm)
      : null
  const distanceScale =
    targetDistanceKm && derivedDistanceKm > 0
      ? targetDistanceKm / derivedDistanceKm
      : 1

  const rows: BreakdownRow[] = []
  let currentTimeSeconds = rawSegments[0].startTimeSeconds
  let currentSplitStartTimeSeconds = currentTimeSeconds
  let currentSplitDistanceKm = 0
  let currentSplitDurationSeconds = 0

  for (const segment of rawSegments) {
    const distancePerSecondKm = (segment.distanceKm * distanceScale) / segment.durationSeconds

    if (!Number.isFinite(distancePerSecondKm) || distancePerSecondKm <= 0) {
      currentTimeSeconds = segment.endTimeSeconds
      continue
    }

    let remainingSegmentDurationSeconds = segment.durationSeconds

    while (remainingSegmentDurationSeconds > 1e-6) {
      const remainingSplitDistanceKm = Math.max(0, 1 - currentSplitDistanceKm)
      const durationToCompleteSplitSeconds = remainingSplitDistanceKm / distancePerSecondKm
      const consumedDurationSeconds = Math.min(remainingSegmentDurationSeconds, durationToCompleteSplitSeconds)
      const consumedDistanceKm = distancePerSecondKm * consumedDurationSeconds

      currentSplitDistanceKm += consumedDistanceKm
      currentSplitDurationSeconds += consumedDurationSeconds
      currentTimeSeconds += consumedDurationSeconds
      remainingSegmentDurationSeconds -= consumedDurationSeconds

      if (currentSplitDistanceKm >= 1 - 1e-6) {
        const splitAverageHeartrate = getAverageSeriesValueForInterval(
          heartrateAnchors,
          currentSplitStartTimeSeconds,
          currentTimeSeconds
        )

        rows.push({
          index: rows.length + 1,
          distanceMeters: currentSplitDistanceKm * 1000,
          elapsedTimeSeconds: currentSplitDurationSeconds,
          paceSecondsPerKm: currentSplitDurationSeconds / currentSplitDistanceKm,
          averageHeartrate: splitAverageHeartrate,
        })

        currentSplitStartTimeSeconds = currentTimeSeconds
        currentSplitDistanceKm = 0
        currentSplitDurationSeconds = 0
      }
    }
  }

  if (currentSplitDistanceKm > 1e-6) {
    const splitAverageHeartrate = getAverageSeriesValueForInterval(
      heartrateAnchors,
      currentSplitStartTimeSeconds,
      currentTimeSeconds
    )

    rows.push({
      index: rows.length + 1,
      distanceMeters: currentSplitDistanceKm * 1000,
      elapsedTimeSeconds: currentSplitDurationSeconds,
      paceSecondsPerKm: currentSplitDurationSeconds / currentSplitDistanceKm,
      averageHeartrate: splitAverageHeartrate,
    })
  }

  return rows
}

function getChartDurationSeconds(
  run: Pick<RunDetailsRow, 'moving_time_seconds' | 'elapsed_time_seconds' | 'duration_seconds'> | null
) {
  if (!run) {
    return null
  }

  if (Number.isFinite(run.moving_time_seconds) && (run.moving_time_seconds ?? 0) > 0) {
    return Math.round(run.moving_time_seconds ?? 0)
  }

  if (Number.isFinite(run.elapsed_time_seconds) && (run.elapsed_time_seconds ?? 0) > 0) {
    return Math.round(run.elapsed_time_seconds ?? 0)
  }

  if (Number.isFinite(run.duration_seconds) && (run.duration_seconds ?? 0) > 0) {
    return Math.round(run.duration_seconds ?? 0)
  }

  return null
}

function mapSeriesPointsToElapsedMinutes(
  points: RunDetailSeriesPoint[] | null | undefined,
  totalDurationSeconds: number | null
) {
  const safePoints = points ?? []

  if (safePoints.length === 0) {
    return {
      data: [] as RunDetailSeriesPoint[],
      usedFallbackApproximation: false,
    }
  }

  const maxRawTime = safePoints.reduce((maxTime, point) => Math.max(maxTime, point.time), safePoints[0].time)
  const looksLikeSampleIndex = maxRawTime <= safePoints.length
  const canApproximateAcrossDuration = looksLikeSampleIndex && safePoints.length > 1 && totalDurationSeconds != null

  return {
    data: safePoints.map((point, index) => {
      if (canApproximateAcrossDuration) {
        return {
          time: ((index / (safePoints.length - 1)) * totalDurationSeconds) / 60,
          value: point.value,
        }
      }

      return {
        time: point.time / 60,
        value: point.value,
      }
    }),
    usedFallbackApproximation: canApproximateAcrossDuration,
  }
}

function getRunTitle(run: Pick<RunDetailsRow, 'name' | 'title'>) {
  return run.name?.trim() || run.title?.trim() || 'Тренировка'
}

function toNullableTrimmedText(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

function getRunEditDraft(run: Pick<RunDetailsRow, 'name' | 'description' | 'shoe_id'> | null | undefined) {
  return {
    name: run?.name ?? '',
    description: run?.description ?? '',
    shoeId: run?.shoe_id ?? '',
  }
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
  const [runSeries, setRunSeries] = useState<RunDetailSeriesRow>(EMPTY_RUN_DETAIL_SERIES)
  const [runLaps, setRunLaps] = useState<RunLapRow[]>([])
  const [runPhotos, setRunPhotos] = useState<RunPhotoRow[]>([])
  const [author, setAuthor] = useState<ProfileRow | null>(null)
  const [authorLevel, setAuthorLevel] = useState(1)
  const [likesCount, setLikesCount] = useState(0)
  const [likedByMe, setLikedByMe] = useState(false)
  const [likeInFlight, setLikeInFlight] = useState(false)
  const [commentsError, setCommentsError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const [isEditingDetails, setIsEditingDetails] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [editedDescription, setEditedDescription] = useState('')
  const [editedShoeId, setEditedShoeId] = useState('')
  const [saveDetailsError, setSaveDetailsError] = useState('')
  const [saveDetailsInfoMessage, setSaveDetailsInfoMessage] = useState('')
  const [savingDetails, setSavingDetails] = useState(false)
  const [availableShoes, setAvailableShoes] = useState<UserShoeRecord[]>([])
  const [loadingShoes, setLoadingShoes] = useState(false)
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null)
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const [uploadPhotosError, setUploadPhotosError] = useState('')
  const [refreshingStravaSupplemental, setRefreshingStravaSupplemental] = useState(false)
  const [stravaSupplementalError, setStravaSupplementalError] = useState('')
  const [stravaSupplementalInfoMessage, setStravaSupplementalInfoMessage] = useState('')
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const currentUserIdRef = useRef<string | null>(null)
  const likeInFlightRef = useRef(false)
  const likeRequestVersionRef = useRef(0)
  const likesCountRef = useRef(0)
  const likedByMeRef = useRef(false)
  const handleAuthRequired = useMemo(
    () => () => {
      router.replace('/login')
    },
    [router]
  )

  function applyRunLikeState(nextLikesCount: number, nextLikedByMe: boolean) {
    const safeLikesCount = Math.max(0, nextLikesCount)
    likesCountRef.current = safeLikesCount
    likedByMeRef.current = nextLikedByMe
    setLikesCount(safeLikesCount)
    setLikedByMe(nextLikedByMe)
  }
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

  function handleOpenPhotoPicker() {
    if (!photoInputRef.current || uploadingPhotos || !isOwner) {
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

    if (!user || !run || !isOwner || uploadingPhotos) {
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
    currentUserIdRef.current = user?.id ?? null
  }, [user?.id])

  useEffect(() => {
    let isMounted = true

    async function loadRunDetails() {
      if (authLoading) {
        return
      }

      if (!user) {
        if (isMounted) {
          setRun(null)
          setRunSeries(EMPTY_RUN_DETAIL_SERIES)
          setRunLaps([])
          setRunPhotos([])
          applyRunLikeState(0, false)
          setLoading(false)
        }
        return
      }

      if (!runId) {
        if (isMounted) {
          setError('Тренировка не найдена')
          setRunSeries(EMPTY_RUN_DETAIL_SERIES)
          setRunLaps([])
          setRunPhotos([])
          applyRunLikeState(0, false)
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
            setRunSeries(EMPTY_RUN_DETAIL_SERIES)
            setRunLaps([])
            setRunPhotos([])
          }
          return
        }

        if (!runData) {
          if (isMounted) {
            setError('Тренировка не найдена')
            setRun(null)
            setRunSeries(EMPTY_RUN_DETAIL_SERIES)
            setRunLaps([])
            setRunPhotos([])
          }
          return
        }

        const [profileResult, likesSummary, seriesResult, lapsResult, photosResult, totalXpByUser] = await Promise.all([
          supabase
            .from('profiles')
            .select('id, name, nickname, email, avatar_url')
            .eq('id', runData.user_id)
            .maybeSingle(),
          loadRunLikesSummaryForRunIds([runData.id], user.id),
          supabase
            .from('run_detail_series')
            .select('pace_points, heartrate_points')
            .eq('run_id', runData.id)
            .maybeSingle(),
          supabase
            .from('run_laps')
            .select('lap_index, distance_meters, elapsed_time_seconds, pace_seconds_per_km, average_heartrate')
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

        let runComments: RunCommentItem[] = []
        let nextCommentsError = ''

        try {
          runComments = await loadRunComments(runData.id, user?.id ?? null)
        } catch {
          nextCommentsError = 'Не удалось загрузить комментарии'
        }

        if (!isMounted) {
          return
        }

        const normalizedRunSeries = seriesResult.error
          ? EMPTY_RUN_DETAIL_SERIES
          : {
              exists: Boolean(seriesResult.data),
              pace_points: normalizeRunDetailSeriesPoints(seriesResult.data?.pace_points),
              heartrate_points: normalizeRunDetailSeriesPoints(seriesResult.data?.heartrate_points),
            }

        setRun(runData as RunDetailsRow)
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
        setAuthor((profileResult.data as ProfileRow | null) ?? null)
        setAuthorLevel(getLevelFromXP(totalXpByUser[runData.user_id] ?? 0).level)
        applyRunLikeState(
          likesSummary.likesByRunId[runData.id] ?? 0,
          likesSummary.likedRunIds.has(runData.id)
        )
        replaceComments(runComments)
        setCommentsError(nextCommentsError)
      } catch {
        if (isMounted) {
          setError('Не удалось загрузить тренировку')
          setRun(null)
          setRunSeries(EMPTY_RUN_DETAIL_SERIES)
          setRunLaps([])
          setRunPhotos([])
          applyRunLikeState(0, false)
          replaceComments([])
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
  }, [authLoading, reloadKey, replaceComments, runId, user])

  useEffect(() => {
    if (!runId) {
      return
    }

    const unsubscribe = subscribeToRunLikes((payload) => {
      if (payload.runId !== runId) {
        return
      }

      const activeUserId = currentUserIdRef.current

      if (likeInFlightRef.current && payload.userId === activeUserId) {
        return
      }

      if (payload.eventType === 'INSERT') {
        if (payload.userId === activeUserId) {
          if (likedByMeRef.current) {
            return
          }

          applyRunLikeState(likesCountRef.current + 1, true)
          return
        }

        applyRunLikeState(likesCountRef.current + 1, likedByMeRef.current)
        return
      }

      if (payload.userId === activeUserId) {
        if (!likedByMeRef.current) {
          return
        }

        applyRunLikeState(likesCountRef.current - 1, false)
        return
      }

      applyRunLikeState(likesCountRef.current - 1, likedByMeRef.current)
    })

    return () => {
      unsubscribe()
    }
  }, [runId])

  useEffect(() => {
    if (isEditingDetails) {
      return
    }

    const nextDraft = getRunEditDraft(run)
    setEditedName(nextDraft.name)
    setEditedDescription(nextDraft.description)
    setEditedShoeId(nextDraft.shoeId)
  }, [isEditingDetails, run])

  useEffect(() => {
    if (!saveDetailsInfoMessage) {
      return
    }

    const timer = window.setTimeout(() => {
      setSaveDetailsInfoMessage('')
    }, 3200)

    return () => {
      window.clearTimeout(timer)
    }
  }, [saveDetailsInfoMessage])

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

    if (!user || !run || user.id !== run.user_id) {
      setAvailableShoes([])
      setLoadingShoes(false)
      return () => {
        isMounted = false
      }
    }

    setLoadingShoes(true)

    void loadUserShoeSelectionData({
      activeOnly: true,
      includeShoeId: run.shoe_id ?? null,
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
      .finally(() => {
        if (isMounted) {
          setLoadingShoes(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [run, user])

  const commentsCount = useMemo(() => countVisibleRunComments(comments), [comments])
  const chartDurationSeconds = useMemo(() => getChartDurationSeconds(run), [run])
  const paceSeriesForChart = useMemo(
    () => mapSeriesPointsToElapsedMinutes(runSeries.pace_points, chartDurationSeconds),
    [chartDurationSeconds, runSeries.pace_points]
  )
  const heartRateSeriesForChart = useMemo(
    () => mapSeriesPointsToElapsedMinutes(runSeries.heartrate_points, chartDurationSeconds),
    [chartDurationSeconds, runSeries.heartrate_points]
  )
  const paceChartData = useMemo(
    () =>
      paceSeriesForChart.data.map((point) => ({
        time: point.time,
        paceSeconds: point.value,
        chartPace: -point.value,
      })),
    [paceSeriesForChart.data]
  )
  const heartRateChartData = useMemo(
    () =>
      heartRateSeriesForChart.data.map((point) => ({
        time: point.time,
        heartRate: point.value,
      })),
    [heartRateSeriesForChart.data]
  )
  const shouldRenderPaceChart = (runSeries.pace_points?.length ?? 0) > 1
  const shouldRenderHeartRateChart = (runSeries.heartrate_points?.length ?? 0) > 1
  const breakdownRows = useMemo(() => {
    if (runLaps.length > 0) {
      return runLaps
        .filter(
          (lap) =>
            Number.isFinite(lap.lap_index) &&
            Number.isFinite(lap.distance_meters) &&
            (lap.distance_meters ?? 0) > 0 &&
            Number.isFinite(lap.elapsed_time_seconds) &&
            (lap.elapsed_time_seconds ?? 0) > 0
        )
        .map((lap) => ({
          index: Math.round(lap.lap_index),
          distanceMeters: Number(lap.distance_meters ?? 0),
          elapsedTimeSeconds: Number(lap.elapsed_time_seconds ?? 0),
          paceSecondsPerKm:
            Number.isFinite(lap.pace_seconds_per_km) && (lap.pace_seconds_per_km ?? 0) > 0
              ? Number(lap.pace_seconds_per_km)
              : Number(lap.elapsed_time_seconds ?? 0) / (Number(lap.distance_meters ?? 0) / 1000),
          averageHeartrate:
            Number.isFinite(lap.average_heartrate) && (lap.average_heartrate ?? 0) > 0
              ? Number(lap.average_heartrate)
              : null,
        }))
    }

    return buildFallbackBreakdownRows({
      pacePoints: paceSeriesForChart.data.map((point) => ({
        time: point.time * 60,
        value: point.value,
      })),
      heartratePoints: heartRateSeriesForChart.data.map((point) => ({
        time: point.time * 60,
        value: point.value,
      })),
      totalDurationSeconds: chartDurationSeconds,
      totalDistanceKm: run?.distance_km ?? null,
    })
  }, [
    chartDurationSeconds,
    heartRateSeriesForChart.data,
    paceSeriesForChart.data,
    run?.distance_km,
    runLaps,
  ])
  const shouldShowBreakdownHeartRate = breakdownRows.some(
    (row) => Number.isFinite(row.averageHeartrate) && (row.averageHeartrate ?? 0) > 0
  )
  const formattedBreakdownRows = useMemo(
    () =>
      breakdownRows.map((row) => ({
        ...row,
        distanceLabel: formatBreakdownDistanceLabel(row.distanceMeters),
        durationLabel: formatDurationLabel(row.elapsedTimeSeconds),
        paceLabel:
          Number.isFinite(row.paceSecondsPerKm) && (row.paceSecondsPerKm ?? 0) > 0
            ? formatBreakdownPaceLabel(row.paceSecondsPerKm ?? 0)
            : '—',
        averageHeartrateLabel:
          Number.isFinite(row.averageHeartrate) && (row.averageHeartrate ?? 0) > 0
            ? `${Math.round(row.averageHeartrate ?? 0)}`
            : null,
      })),
    [breakdownRows]
  )
  const runDescription = useMemo(() => toNullableTrimmedText(run?.description), [run?.description])
  const isOwner = Boolean(user && run && user.id === run.user_id)
  const canRefreshStravaSupplemental = Boolean(
    isOwner &&
    run?.external_source === 'strava' &&
    typeof run?.external_id === 'string' &&
    run.external_id.trim().length > 0
  )
  const isMissingOfficialLaps = canRefreshStravaSupplemental && runLaps.length === 0
  const normalizedEditedName = toNullableTrimmedText(editedName)
  const normalizedEditedDescription = toNullableTrimmedText(editedDescription)
  const normalizedEditedShoeId = editedShoeId.trim() || null
  const hasNameChanged = normalizedEditedName !== toNullableTrimmedText(run?.name)
  const hasDescriptionChanged = normalizedEditedDescription !== toNullableTrimmedText(run?.description)
  const hasShoeChanged = normalizedEditedShoeId !== (run?.shoe_id ?? null)
  const hasPendingDetailChanges = hasNameChanged || hasDescriptionChanged || hasShoeChanged
  const currentAssignedShoe = availableShoes.find((shoe) => shoe.id === (run?.shoe_id ?? '')) ?? null
  const isLikeActive = isOwner ? likesCount > 0 : likedByMe

  function handleStartEditingDetails() {
    if (!isOwner || !run) {
      return
    }

    const nextDraft = getRunEditDraft(run)
    setEditedName(nextDraft.name)
    setEditedDescription(nextDraft.description)
    setEditedShoeId(nextDraft.shoeId)
    setSaveDetailsError('')
    setSaveDetailsInfoMessage('')
    setIsEditingDetails(true)
  }

  function handleCancelEditingDetails() {
    const nextDraft = getRunEditDraft(run)
    setEditedName(nextDraft.name)
    setEditedDescription(nextDraft.description)
    setEditedShoeId(nextDraft.shoeId)
    setSaveDetailsError('')
    setSaveDetailsInfoMessage('')
    setIsEditingDetails(false)
  }

  async function handleSaveDetails() {
    if (!user || !run || !isOwner || savingDetails || !hasPendingDetailChanges) {
      return
    }

    const nextName = normalizedEditedName
    const nextDescription = normalizedEditedDescription
    const updates: Partial<RunDetailsRow> = {}

    if (hasNameChanged) {
      updates.name = nextName
      updates.name_manually_edited = true
    }

    if (hasDescriptionChanged) {
      updates.description = nextDescription
      updates.description_manually_edited = true
    }

    if (hasShoeChanged) {
      updates.shoe_id = normalizedEditedShoeId
    }

    setSavingDetails(true)
    setSaveDetailsError('')
    setSaveDetailsInfoMessage('')

    try {
      const { error: updateError, shoeWearMessage } = await updateRun(run.id, {
        name: Object.prototype.hasOwnProperty.call(updates, 'name') ? (updates.name ?? null) : undefined,
        description: Object.prototype.hasOwnProperty.call(updates, 'description')
          ? (updates.description ?? null)
          : undefined,
        nameManuallyEdited: Object.prototype.hasOwnProperty.call(updates, 'name_manually_edited')
          ? Boolean(updates.name_manually_edited)
          : undefined,
        descriptionManuallyEdited: Object.prototype.hasOwnProperty.call(updates, 'description_manually_edited')
          ? Boolean(updates.description_manually_edited)
          : undefined,
        shoeId: Object.prototype.hasOwnProperty.call(updates, 'shoe_id')
          ? (updates.shoe_id ?? null)
          : undefined,
      })

      if (updateError) {
        setSaveDetailsError('Не удалось сохранить изменения')
        return
      }

      setRun((currentRun) => (currentRun ? { ...currentRun, ...updates } : currentRun))
      setEditedName(nextName ?? '')
      setEditedDescription(nextDescription ?? '')
      setEditedShoeId(normalizedEditedShoeId ?? '')
      setDescriptionExpanded(false)
      setIsEditingDetails(false)
      setSaveDetailsInfoMessage(shoeWearMessage ?? '')
    } catch {
      setSaveDetailsError('Не удалось сохранить изменения')
    } finally {
      setSavingDetails(false)
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

  async function handleToggleLike() {
    const activeUserId = currentUserIdRef.current

    if (!activeUserId) {
      router.replace('/login')
      return
    }

    if (!run || likeInFlightRef.current || run.user_id === activeUserId) {
      return
    }

    const previousLikesCount = likesCountRef.current
    const wasLiked = likedByMeRef.current
    const nextRequestVersion = likeRequestVersionRef.current + 1
    likeRequestVersionRef.current = nextRequestVersion
    likeInFlightRef.current = true
    setLikeInFlight(true)

    applyRunLikeState(previousLikesCount + (wasLiked ? -1 : 1), !wasLiked)

    try {
      const { error: likeError } = await toggleRunLike(run.id, activeUserId, wasLiked)

      if (likeRequestVersionRef.current !== nextRequestVersion) {
        return
      }

      if (likeError) {
        applyRunLikeState(previousLikesCount, wasLiked)
      }
    } catch {
      if (likeRequestVersionRef.current !== nextRequestVersion) {
        return
      }

      applyRunLikeState(previousLikesCount, wasLiked)
    } finally {
      if (likeRequestVersionRef.current === nextRequestVersion) {
        likeInFlightRef.current = false
        setLikeInFlight(false)
      }
    }
  }

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
      <WorkoutDetailShell title="Тренировка">
      <div className="space-y-4">
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

  if (!run || !details) {
    return (
      <WorkoutDetailShell title="Тренировка">
      <div className="app-card rounded-xl border p-4 shadow-sm">
        <p className="text-sm text-red-600">{error || 'Тренировка не найдена'}</p>
      </div>
      </WorkoutDetailShell>
    )
  }

  return (
    <WorkoutDetailShell title="Тренировка">
    <div className="space-y-4">
      {runPhotos.length > 0 || isOwner ? (
        <section className="app-card rounded-2xl border p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="app-text-primary text-base font-semibold">Фотографии</h2>
            {isOwner ? (
              <button
                type="button"
                onClick={handleOpenPhotoPicker}
                disabled={uploadingPhotos}
                className="app-button-secondary min-h-10 rounded-full border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploadingPhotos ? 'Загружаем...' : 'Добавить фото'}
              </button>
            ) : null}
          </div>

          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => void handlePhotoInputChange(event)}
            className="hidden"
          />

          {uploadPhotosError ? <p className="mt-3 text-sm text-red-600">{uploadPhotosError}</p> : null}

          {runPhotos.length > 0 ? (
            <div className="mt-3 overflow-x-auto pb-1">
              <div className="flex min-w-max gap-3">
                {runPhotos.map((photo, index) => (
                  <button
                    key={photo.id}
                    type="button"
                    onClick={() => setSelectedPhotoIndex(index)}
                    className="h-40 w-56 shrink-0 overflow-hidden rounded-2xl border bg-[var(--surface-muted)] shadow-sm transition-transform active:scale-[0.99]"
                    aria-label={`Открыть фото тренировки ${index + 1}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.thumbnail_url ?? photo.public_url}
                      alt={`Фото тренировки ${index + 1}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="app-text-secondary mt-3 text-sm">
              Добавьте фотографии тренировки, чтобы они появились в галерее.
            </p>
          )}
        </section>
      ) : null}

      <section className="app-card rounded-2xl border p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <ParticipantIdentity
            avatarUrl={author?.avatar_url ?? null}
            displayName={author?.nickname?.trim() || author?.name?.trim() || author?.email?.trim() || 'Бегун'}
            level={authorLevel}
            href={`/users/${run.user_id}`}
            size="md"
          />
          <div className="flex shrink-0 flex-col items-end gap-2">
            <p className="app-text-secondary max-w-[6.5rem] text-right text-xs sm:max-w-none sm:text-sm">
              {formatRunTimestampLabel(run.created_at, run.external_source)}
            </p>
            {run.external_source === 'strava' ? (
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium">
                <StravaIcon />
                Strava
              </span>
            ) : null}
            {isOwner && !isEditingDetails ? (
              <button
                type="button"
                onClick={handleStartEditingDetails}
                className="app-text-muted text-xs font-medium"
              >
                Редактировать
              </button>
            ) : null}
          </div>
        </div>

        {isEditingDetails ? (
          <div className="mt-3 space-y-4">
            <div>
              <label htmlFor="run-name" className="app-text-secondary text-sm font-medium">
                Название
              </label>
              <input
                id="run-name"
                type="text"
                value={editedName}
                onChange={(event) => {
                  setEditedName(event.target.value)
                  setSaveDetailsError('')
                  setSaveDetailsInfoMessage('')
                }}
                placeholder="Введите название"
                disabled={savingDetails}
                className="app-input mt-1 min-h-11 w-full rounded-lg border px-3 py-2"
              />
            </div>

            <div>
              <label htmlFor="run-description" className="app-text-secondary text-sm font-medium">
                Описание
              </label>
              <textarea
                id="run-description"
                value={editedDescription}
                onChange={(event) => {
                  setEditedDescription(event.target.value)
                  setSaveDetailsError('')
                  setSaveDetailsInfoMessage('')
                }}
                placeholder="Добавьте описание"
                disabled={savingDetails}
                className="app-input mt-1 min-h-28 w-full rounded-lg border px-3 py-2"
              />
            </div>

            <div>
              <label htmlFor="run-shoe" className="app-text-secondary text-sm font-medium">
                Кроссовки
              </label>
              <select
                id="run-shoe"
                value={editedShoeId}
                onChange={(event) => {
                  setEditedShoeId(event.target.value)
                  setSaveDetailsError('')
                  setSaveDetailsInfoMessage('')
                }}
                disabled={savingDetails || loadingShoes}
                className="app-input mt-1 min-h-11 w-full rounded-lg border px-3 py-2"
              >
                <option value="">Без кроссовок</option>
                {availableShoes.map((shoe) => (
                  <option key={shoe.id} value={shoe.id}>
                    {shoe.displayName}
                    {shoe.nickname ? ` (${shoe.nickname})` : ''}
                    {!shoe.isActive ? ' • архив' : ''}
                  </option>
                ))}
              </select>
            </div>

            {saveDetailsError ? <p className="text-sm text-red-600">{saveDetailsError}</p> : null}

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelEditingDetails}
                disabled={savingDetails}
                className="app-button-secondary min-h-11 rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void handleSaveDetails()}
                disabled={savingDetails || !hasPendingDetailChanges}
                className="app-button-primary min-h-11 rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingDetails ? 'Сохраняем...' : 'Сохранить'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <h1 className="app-text-primary mt-3 break-words text-base font-medium">{getRunTitle(run)}</h1>
            {currentAssignedShoe ? (
              <p className="app-text-secondary mt-2 text-sm">
                Кроссовки: {currentAssignedShoe.displayName}
                {currentAssignedShoe.nickname ? ` (${currentAssignedShoe.nickname})` : ''}
                {!currentAssignedShoe.isActive ? ' • архив' : ''}
              </p>
            ) : null}
            {runDescription ? (
              <div className="mt-2">
                <p
                  className={`app-text-secondary break-words whitespace-pre-wrap text-sm leading-5 ${
                    descriptionExpanded ? '' : 'line-clamp-2'
                  }`}
                >
                  {runDescription}
                </p>

                <button
                  type="button"
                  onClick={() => setDescriptionExpanded((prev) => !prev)}
                  className="app-text-muted mt-0.5 text-xs font-medium"
                >
                  {descriptionExpanded ? 'Скрыть' : 'Читать'}
                </button>
              </div>
            ) : null}
          </>
        )}

        {saveDetailsInfoMessage ? (
          <div className="mt-3 rounded-xl border border-amber-300/70 bg-amber-100/80 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100">
            {saveDetailsInfoMessage}
          </div>
        ) : null}

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

      {shouldRenderHeartRateChart ? (
        <section className="app-card rounded-2xl border p-4 shadow-sm">
          <h2 className="app-text-primary text-base font-semibold">Пульс</h2>
          <div className="mt-3 h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={heartRateChartData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                accessibilityLayer={false}
                syncId="run-detail-series"
                syncMethod="value"
              >
                <defs>
                  <linearGradient id="heart-rate-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent-strong)" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="var(--accent-strong)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="time"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickCount={6}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                  tickMargin={8}
                  tickFormatter={formatElapsedMinutesLabel}
                  tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  tickFormatter={formatHeartRateTick}
                  tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                  domain={['dataMin - 5', 'dataMax + 5']}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--chart-grid)', strokeDasharray: '3 3' }}
                  formatter={(value) => {
                    const numericValue = typeof value === 'number' ? value : Number(value ?? 0)
                    return [`${Math.round(numericValue)} уд/мин`, 'Пульс']
                  }}
                  labelFormatter={(value) => formatElapsedMinutesLabel(typeof value === 'number' ? value : Number(value ?? 0))}
                />
                <Area
                  type="monotone"
                  dataKey="heartRate"
                  stroke="var(--accent-strong)"
                  strokeWidth={2.5}
                  fill="url(#heart-rate-fill)"
                  fillOpacity={1}
                  dot={false}
                  activeDot={{ r: 4, fill: 'var(--accent-strong)', stroke: 'var(--surface)' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

        {shouldRenderPaceChart ? (
          <section className="app-card rounded-2xl border p-4 shadow-sm">
            <h2 className="app-text-primary text-base font-semibold">Темп</h2>
            <div className="mt-3 h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={paceChartData}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  accessibilityLayer={false}
                  syncId="run-detail-series"
                  syncMethod="value"
                >
                  <defs>
                    <linearGradient id="pace-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-strong)" stopOpacity={0.16} />
                      <stop offset="95%" stopColor="var(--accent-strong)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                  <XAxis
                    dataKey="time"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickCount={6}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                    tickMargin={8}
                    tickFormatter={formatElapsedMinutesLabel}
                    tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    tickFormatter={(value) => {
                      const numericValue = typeof value === 'number' ? value : Number(value ?? 0)
                      return formatPaceTick(Math.abs(numericValue))
                    }}
                    tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                    domain={['dataMin - 10', 'dataMax + 10']}
                  />
                  <Tooltip
                    cursor={{ stroke: 'var(--chart-grid)', strokeDasharray: '3 3' }}
                    formatter={(_value, _name, item) => {
                      const numericValue = Number(item?.payload?.paceSeconds ?? 0)
                      return [formatPaceLabel(numericValue), 'Темп']
                    }}
                    labelFormatter={(value) => formatElapsedMinutesLabel(typeof value === 'number' ? value : Number(value ?? 0))}
                  />
                  <Area
                    type="monotone"
                    dataKey="chartPace"
                    baseValue="dataMin"
                    stroke="var(--accent-strong)"
                    strokeWidth={2.5}
                    fill="url(#pace-fill)"
                    fillOpacity={1}
                    dot={false}
                    activeDot={{ r: 4, fill: 'var(--accent-strong)', stroke: 'var(--surface)' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
        ) : null}

        {formattedBreakdownRows.length > 0 ? (
          <section className="app-card rounded-2xl border p-4 shadow-sm">
            <h2 className="app-text-primary text-base font-semibold">Разбивка</h2>
            <div className="mt-3 overflow-hidden rounded-xl border">
              <div
                className={`grid gap-3 border-b px-3 py-2 text-xs font-medium app-text-secondary ${
                  shouldShowBreakdownHeartRate
                    ? 'grid-cols-[56px_1fr_1fr_1fr_72px]'
                    : 'grid-cols-[56px_1fr_1fr_1fr]'
                }`}
              >
                <span>№</span>
                <span>Км</span>
                <span>Время</span>
                <span>Темп</span>
                {shouldShowBreakdownHeartRate ? <span>Пульс</span> : null}
              </div>
              <div className="divide-y">
                {formattedBreakdownRows.map((row) => (
                  <div
                    key={`${row.index}-${row.distanceMeters}-${row.elapsedTimeSeconds}`}
                    className={`grid gap-3 px-3 py-2.5 text-sm app-text-primary ${
                      shouldShowBreakdownHeartRate
                        ? 'grid-cols-[56px_1fr_1fr_1fr_72px]'
                        : 'grid-cols-[56px_1fr_1fr_1fr]'
                    }`}
                  >
                    <span className="font-medium">{row.index}</span>
                    <span>{row.distanceLabel}</span>
                    <span>{row.durationLabel}</span>
                    <span>{row.paceLabel}</span>
                    {shouldShowBreakdownHeartRate ? <span>{row.averageHeartrateLabel ?? '—'}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {run.map_polyline?.trim() ? (
          <section className="app-card rounded-2xl border p-4 shadow-sm">
            <h2 className="app-text-primary inline-flex items-center gap-2 text-base font-semibold">
              <Map className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              <span>
                Маршрут
                {details.distanceLabel ? ` • ${details.distanceLabel}` : ''}
              </span>
            </h2>
            <div className="mt-3 rounded-2xl p-1 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
              {details.mapPreviewUrl ? (
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
              ) : (
                <RunRouteMapPreview polyline={run.map_polyline} className="h-[210px] w-full overflow-hidden rounded-2xl border" />
              )}
            </div>
          </section>
        ) : null}

        <section className="app-card rounded-2xl border p-4 shadow-sm">
          <div className="app-text-secondary flex items-center gap-6 text-sm">
            <button
              type="button"
              onClick={() => {
                void handleToggleLike()
              }}
              disabled={likeInFlight || isOwner}
              aria-pressed={likedByMe}
              className={`inline-flex min-h-10 items-center gap-2 rounded-full px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                isLikeActive ? 'text-[var(--like-active)]' : 'app-text-secondary'
              }`}
            >
              {likeInFlight ? (
                <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.9} />
              ) : (
                <Heart className="h-4 w-4" strokeWidth={1.9} fill={isLikeActive ? 'currentColor' : 'none'} />
              )}
              <span>{likesCount} лайков</span>
            </button>
            <span>{commentsCount} комментариев</span>
          </div>
        </section>

      <RunCommentsSection
        comments={comments}
        currentUserId={user?.id ?? null}
        error={commentsError}
        pendingLikeCommentIds={pendingLikeCommentIds}
        onSubmitComment={handleCommentSubmit}
        onToggleLikeComment={handleToggleLikeComment}
        onReplyComment={handleReplySubmit}
        onEditComment={handleEditComment}
        onDeleteComment={handleDeleteComment}
      />
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
