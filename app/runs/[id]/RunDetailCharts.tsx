'use client'

import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { hasRenderableRoutePolyline } from '@/components/RunRouteMapPreview'
import { formatDistanceKm } from '@/lib/format'

type RunDetailsForCharts = {
  distance_km: number | null
  moving_time_seconds?: number | null
  elapsed_time_seconds?: number | null
  duration_seconds?: number | null
  map_polyline?: string | null
  external_source?: string | null
  raw_strava_payload?: Record<string, unknown> | null
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
}

type BreakdownRow = {
  index: number
  distanceMeters: number
  elapsedTimeSeconds: number
  paceSecondsPerKm: number | null
  averageHeartrate: number | null
}

type Props = {
  run: RunDetailsForCharts
  runSeries: RunDetailSeriesRow
  runLaps: RunLapRow[]
}

const CADENCE_STEP_MULTIPLIER = 2

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

function formatCadenceTick(value: number) {
  return `${Math.round(value)}`
}

function formatElevationTick(value: number) {
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

function getChartDurationSeconds(run: RunDetailsForCharts | null) {
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
    return [] as RunDetailSeriesPoint[]
  }

  const maxRawTime = safePoints.reduce((maxTime, point) => Math.max(maxTime, point.time), safePoints[0].time)
  const looksLikeSampleIndex = maxRawTime <= safePoints.length
  const canApproximateAcrossDuration = looksLikeSampleIndex && safePoints.length > 1 && totalDurationSeconds != null

  return safePoints.map((point, index) => {
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
  })
}

function mapDistanceSeriesPointsToDistanceKm(points: RunDetailDistanceSeriesPoint[] | null | undefined) {
  const safePoints = points ?? []

  return safePoints
    .map((point) => ({
      distanceKm: point.distance / 1000,
      value: point.value,
    }))
    .filter((point) => Number.isFinite(point.distanceKm) && point.distanceKm >= 0 && Number.isFinite(point.value))
}

function scaleCadenceValue(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return value * CADENCE_STEP_MULTIPLIER
}

function hasCoordinatePair(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((coordinate) => Number.isFinite(Number(coordinate)))
  )
}

function hasStravaGpsData(payload: Record<string, unknown> | null | undefined) {
  if (!payload) {
    return false
  }

  const mapValue = payload.map
  const mapData = typeof mapValue === 'object' && mapValue !== null
    ? mapValue as { summary_polyline?: unknown; polyline?: unknown }
    : null
  const hasStravaPolyline =
    (typeof mapData?.summary_polyline === 'string' && hasRenderableRoutePolyline(mapData.summary_polyline)) ||
    (typeof mapData?.polyline === 'string' && hasRenderableRoutePolyline(mapData.polyline))

  return hasStravaPolyline || hasCoordinatePair(payload.start_latlng) || hasCoordinatePair(payload.end_latlng)
}

function hasGpsElevationSource(run: RunDetailsForCharts | null) {
  if (!run) {
    return false
  }

  if (typeof run.map_polyline === 'string' && hasRenderableRoutePolyline(run.map_polyline)) {
    return true
  }

  return run.external_source === 'strava' && hasStravaGpsData(run.raw_strava_payload)
}

export default function RunDetailCharts({ run, runSeries, runLaps }: Props) {
  const chartDurationSeconds = useMemo(() => getChartDurationSeconds(run), [run])
  const paceSeriesForChart = useMemo(
    () => mapSeriesPointsToElapsedMinutes(runSeries.pace_points, chartDurationSeconds),
    [chartDurationSeconds, runSeries.pace_points]
  )
  const heartRateSeriesForChart = useMemo(
    () => mapSeriesPointsToElapsedMinutes(runSeries.heartrate_points, chartDurationSeconds),
    [chartDurationSeconds, runSeries.heartrate_points]
  )
  const cadenceSeriesForChart = useMemo(
    () => mapSeriesPointsToElapsedMinutes(runSeries.cadence_points, chartDurationSeconds),
    [chartDurationSeconds, runSeries.cadence_points]
  )
  const altitudeSeriesForChart = useMemo(
    () => mapDistanceSeriesPointsToDistanceKm(runSeries.altitude_points),
    [runSeries.altitude_points]
  )
  const paceChartData = useMemo(
    () =>
      paceSeriesForChart.map((point) => ({
        time: point.time,
        paceSeconds: point.value,
        chartPace: -point.value,
      })),
    [paceSeriesForChart]
  )
  const heartRateChartData = useMemo(
    () =>
      heartRateSeriesForChart.map((point) => ({
        time: point.time,
        heartRate: point.value,
      })),
    [heartRateSeriesForChart]
  )
  const cadenceChartData = useMemo(
    () =>
      cadenceSeriesForChart.map((point) => ({
        time: point.time,
        cadence: scaleCadenceValue(point.value),
      })),
    [cadenceSeriesForChart]
  )
  const altitudeChartData = useMemo(
    () =>
      altitudeSeriesForChart.map((point) => ({
        distanceKm: point.distanceKm,
        altitude: point.value,
      })),
    [altitudeSeriesForChart]
  )
  const altitudeChartBaseline = useMemo(() => {
    if (altitudeChartData.length === 0) {
      return 0
    }

    const minAltitude = altitudeChartData.reduce(
      (currentMin, point) => Math.min(currentMin, point.altitude),
      altitudeChartData[0]?.altitude ?? 0
    )

    return Math.floor(minAltitude - 6)
  }, [altitudeChartData])
  const canRenderElevationProfile = useMemo(() => hasGpsElevationSource(run), [run])
  const shouldRenderPaceChart = (runSeries.pace_points?.length ?? 0) > 1
  const shouldRenderHeartRateChart = (runSeries.heartrate_points?.length ?? 0) > 1
  const shouldRenderCadenceChart = (runSeries.cadence_points?.length ?? 0) > 1
  const shouldRenderAltitudeChart = canRenderElevationProfile && (runSeries.altitude_points?.length ?? 0) > 1
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
      pacePoints: paceSeriesForChart.map((point) => ({
        time: point.time * 60,
        value: point.value,
      })),
      heartratePoints: heartRateSeriesForChart.map((point) => ({
        time: point.time * 60,
        value: point.value,
      })),
      totalDurationSeconds: chartDurationSeconds,
      totalDistanceKm: run.distance_km ?? null,
    })
  }, [
    chartDurationSeconds,
    heartRateSeriesForChart,
    paceSeriesForChart,
    run.distance_km,
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

  if (
    formattedBreakdownRows.length === 0 &&
    !shouldRenderPaceChart &&
    !shouldRenderHeartRateChart &&
    !shouldRenderCadenceChart &&
    !shouldRenderAltitudeChart
  ) {
    return null
  }

  return (
    <>
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

      {shouldRenderPaceChart ? (
        <section className="app-card rounded-2xl border p-4 shadow-sm">
          <h2 className="app-text-primary text-base font-semibold">Темп</h2>
          <div className="mt-3 h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={paceChartData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                accessibilityLayer={false}
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
                  labelFormatter={(value) =>
                    formatElapsedMinutesLabel(typeof value === 'number' ? value : Number(value ?? 0))
                  }
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

      {shouldRenderHeartRateChart ? (
        <section className="app-card rounded-2xl border p-4 shadow-sm">
          <h2 className="app-text-primary text-base font-semibold">Пульс</h2>
          <div className="mt-3 h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={heartRateChartData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                accessibilityLayer={false}
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
                  labelFormatter={(value) =>
                    formatElapsedMinutesLabel(typeof value === 'number' ? value : Number(value ?? 0))
                  }
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

      {shouldRenderCadenceChart ? (
        <section className="app-card rounded-2xl border p-4 shadow-sm">
          <h2 className="app-text-primary text-base font-semibold">Каденс</h2>
          <div className="mt-3 h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={cadenceChartData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                accessibilityLayer={false}
              >
                <defs>
                  <linearGradient id="cadence-fill" x1="0" y1="0" x2="0" y2="1">
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
                  width={36}
                  tickFormatter={formatCadenceTick}
                  tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                  domain={['dataMin - 5', 'dataMax + 5']}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--chart-grid)', strokeDasharray: '3 3' }}
                  formatter={(value) => {
                    const numericValue = typeof value === 'number' ? value : Number(value ?? 0)
                    return [`${Math.round(numericValue)} шаг/мин`, 'Каденс']
                  }}
                  labelFormatter={(value) =>
                    formatElapsedMinutesLabel(typeof value === 'number' ? value : Number(value ?? 0))
                  }
                />
                <Area
                  type="monotone"
                  dataKey="cadence"
                  stroke="var(--accent-strong)"
                  strokeWidth={2.5}
                  fill="url(#cadence-fill)"
                  fillOpacity={1}
                  dot={false}
                  activeDot={{ r: 4, fill: 'var(--accent-strong)', stroke: 'var(--surface)' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      {shouldRenderAltitudeChart ? (
        <section className="app-card rounded-2xl border p-4 shadow-sm">
          <h2 className="app-text-primary text-base font-semibold">Профиль высоты</h2>
          <div className="mt-3 h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={altitudeChartData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                accessibilityLayer={false}
              >
                <defs>
                  <linearGradient id="altitude-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-strong)" stopOpacity={0.22} />
                    <stop offset="55%" stopColor="var(--accent-strong)" stopOpacity={0.12} />
                    <stop offset="100%" stopColor="var(--accent-strong)" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="2 8"
                  vertical={false}
                  stroke="var(--chart-grid)"
                  strokeOpacity={0.16}
                />
                <XAxis
                  dataKey="distanceKm"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickCount={6}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                  tickMargin={8}
                  tickFormatter={formatDistanceKm}
                  tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  tickFormatter={formatElevationTick}
                  tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                  domain={['dataMin - 6', 'dataMax + 6']}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--chart-grid)', strokeDasharray: '3 3' }}
                  formatter={(value) => {
                    const numericValue = typeof value === 'number' ? value : Number(value ?? 0)
                    return [`${Math.round(numericValue)} м`, 'Высота']
                  }}
                  labelFormatter={(value) =>
                    `${formatDistanceKm(typeof value === 'number' ? value : Number(value ?? 0))} км`
                  }
                />
                <Area
                  type="monotone"
                  dataKey="altitude"
                  baseValue={altitudeChartBaseline}
                  stroke="var(--accent-strong)"
                  strokeWidth={2.8}
                  fill="url(#altitude-fill)"
                  fillOpacity={1}
                  dot={false}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  activeDot={{ r: 4, fill: 'var(--accent-strong)', stroke: 'var(--surface)' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}
    </>
  )
}
