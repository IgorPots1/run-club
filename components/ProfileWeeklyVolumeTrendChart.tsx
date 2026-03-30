'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import type { ActivityTrendPoint } from '@/lib/activity'
import { formatDistanceKm } from '@/lib/format'

type ProfileWeeklyVolumeTrendChartProps = {
  data: ActivityTrendPoint[]
}

function WeeklyVolumeTooltip({
  point,
}: {
  point: ActivityTrendPoint | null
}) {
  if (!point) {
    return null
  }

  return (
    <div
      className="app-card pointer-events-none select-none rounded-xl border px-3 py-2 shadow-lg"
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <p className="app-text-secondary text-xs">
        <span className="app-text-primary font-medium">{point.rangeLabel}</span>
      </p>
      <p className="app-text-secondary mt-1 text-xs">
        Пробег <span className="app-text-primary font-medium">{formatDistanceKm(point.distance)} км</span>
      </p>
    </div>
  )
}

export default function ProfileWeeklyVolumeTrendChart({
  data,
}: ProfileWeeklyVolumeTrendChartProps) {
  const chartRootRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const safeSelectedIndex =
    selectedIndex != null && data[selectedIndex] != null ? selectedIndex : null
  const selectedPoint = safeSelectedIndex != null ? data[safeSelectedIndex] ?? null : null
  const monthTicks = useMemo(() => {
    const buckets = new Map<string, { label: string; indices: number[] }>()

    for (const point of data) {
      const existingBucket = buckets.get(point.monthKey)

      if (existingBucket) {
        existingBucket.indices.push(point.index)
        continue
      }

      buckets.set(point.monthKey, {
        label: point.monthLabel,
        indices: [point.index],
      })
    }

    return Array.from(buckets.values()).map((bucket) => ({
      value: bucket.indices.reduce((sum, index) => sum + index, 0) / bucket.indices.length,
      label: bucket.label,
    }))
  }, [data])

  function clampIndex(nextIndex: number) {
    return Math.max(0, Math.min(data.length - 1, nextIndex))
  }

  function updateSelectionFromClientX(clientX: number) {
    const overlayBounds = overlayRef.current?.getBoundingClientRect()

    if (!overlayBounds || overlayBounds.width <= 0 || data.length === 0) {
      return
    }

    const relativeX = Math.max(0, Math.min(overlayBounds.width, clientX - overlayBounds.left))
    const progress = relativeX / overlayBounds.width
    const nextIndex = clampIndex(Math.round(progress * (data.length - 1)))
    setSelectedIndex(nextIndex)
  }

  const interactionStyle = {
    userSelect: 'none' as const,
    WebkitUserSelect: 'none' as const,
    WebkitTouchCallout: 'none' as const,
    WebkitTapHighlightColor: 'transparent',
    outline: 'none',
  }

  useEffect(() => {
    function handleDocumentPointerDown(event: PointerEvent) {
      if (chartRootRef.current?.contains(event.target as Node)) {
        return
      }

      setSelectedIndex(null)
    }

    document.addEventListener('pointerdown', handleDocumentPointerDown)

    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown)
    }
  }, [])

  return (
    <div
      ref={chartRootRef}
      className="profile-chart-root space-y-3 select-none"
      style={interactionStyle}
    >
      <WeeklyVolumeTooltip point={selectedPoint} />
      <div
        className="relative h-[210px] w-full select-none outline-none"
        onDragStart={(event) => {
          event.preventDefault()
        }}
        style={interactionStyle}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 10, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="profile-weekly-volume-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--accent-strong)" stopOpacity={0.18} />
                <stop offset="95%" stopColor="var(--accent-strong)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              type="number"
              dataKey="index"
              domain={[0, Math.max(0, data.length - 1)]}
              ticks={monthTicks.map((tick) => tick.value)}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => {
                const matchingTick = monthTicks.find((tick) => Math.abs(tick.value - Number(value)) < 0.001)
                return matchingTick?.label ?? ''
              }}
              tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
              allowDecimals
            />
            <YAxis hide domain={[0, 'dataMax + 2']} />
            {selectedPoint ? (
              <ReferenceLine
                x={selectedPoint.index}
                stroke="var(--chart-grid)"
                strokeDasharray="3 3"
                strokeOpacity={0.65}
              />
            ) : null}
            <Area
              type="monotone"
              dataKey="distance"
              stroke="var(--accent-strong)"
              strokeWidth={2.5}
              fill="url(#profile-weekly-volume-fill)"
              fillOpacity={1}
              dot={(dotProps) => {
                if (typeof dotProps.cx !== 'number' || typeof dotProps.cy !== 'number') {
                  return null
                }

                const isSelected = safeSelectedIndex != null && dotProps.index === safeSelectedIndex

                return (
                  <circle
                    key={`weekly-dot-${dotProps.index}`}
                    cx={dotProps.cx}
                    cy={dotProps.cy}
                    r={isSelected ? 4.5 : 3}
                    fill="var(--accent-strong)"
                    fillOpacity={isSelected ? 1 : 0.7}
                    stroke="var(--surface)"
                    strokeWidth={isSelected ? 2 : 1.5}
                  />
                )
              }}
              activeDot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
        <div
          ref={overlayRef}
          className={`absolute inset-x-[10px] top-[8px] bottom-[28px] ${
            isScrubbing ? 'cursor-grabbing' : 'cursor-pointer'
          } select-none outline-none`}
          aria-label="Выбор недели на графике"
          onPointerDown={(event) => {
            if (data.length === 0) {
              return
            }

            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            setIsScrubbing(true)
            updateSelectionFromClientX(event.clientX)
          }}
          onPointerMove={(event) => {
            if (!isScrubbing) {
              return
            }

            event.preventDefault()
            updateSelectionFromClientX(event.clientX)
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
            setIsScrubbing(false)
          }}
          onPointerCancel={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
            setIsScrubbing(false)
          }}
          style={{
            ...interactionStyle,
            touchAction: 'none',
          }}
        >
          <span className="sr-only">
            Проведите пальцем по графику, чтобы посмотреть недельный пробег.
          </span>
        </div>
      </div>
      <style jsx global>{`
        .profile-chart-root,
        .profile-chart-root * {
          -webkit-tap-highlight-color: transparent;
        }

        .profile-chart-root svg,
        .profile-chart-root text {
          user-select: none;
          -webkit-user-select: none;
          -webkit-touch-callout: none;
        }
      `}</style>
    </div>
  )
}
