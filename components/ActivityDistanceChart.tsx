'use client'

import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import type { AxisInterval } from 'recharts/types/util/types'
import type { ActivityChartPoint, ActivityPeriod } from '@/lib/activity'
import { formatDistanceKm } from '@/lib/format'

type ActivityDistanceChartMode = ActivityPeriod | 'rolling30'

type ActivityDistanceChartProps = {
  data: ActivityChartPoint[]
  mode: ActivityDistanceChartMode
  heightClassName?: string
  compact?: boolean
  showYAxis?: boolean
  showTooltip?: boolean
}

type ActivityChartTooltipProps = {
  point: (ActivityChartPoint & { index: number }) | null
}

type ChartConfig = {
  interval?: AxisInterval
  minTickGap: number
  tickMargin: number
  xPadding: { left: number; right: number }
  yAxisWidth: number
  chartMargin: { top: number; right: number; left: number; bottom: number }
  barCategoryGap: string | number
  barSize?: number
  maxBarSize?: number
}

function formatDistance(value: number) {
  return formatDistanceKm(value)
}

function ActivityChartTooltip({ point }: ActivityChartTooltipProps) {
  if (!point) return null

  return (
    <div className="app-card max-w-[180px] rounded-xl border px-3 py-2 shadow-lg">
      <p className="app-text-secondary text-xs">
        Период: <span className="app-text-primary font-medium">{point.label}</span>
      </p>
      <p className="app-text-secondary mt-1 text-xs">
        Дистанция: <span className="app-text-primary font-medium">{formatDistance(point.distance)} км</span>
      </p>
    </div>
  )
}

export default function ActivityDistanceChart({
  data,
  mode,
  heightClassName = 'h-[220px]',
  compact = false,
  showYAxis = true,
  showTooltip = true,
}: ActivityDistanceChartProps) {
  const [viewportWidth, setViewportWidth] = useState<number | null>(null)
  const [activeBarIndex, setActiveBarIndex] = useState<number | null>(null)

  useEffect(() => {
    function updateViewportState() {
      setViewportWidth(window.innerWidth)
    }

    updateViewportState()
    window.addEventListener('resize', updateViewportState)

    return () => {
      window.removeEventListener('resize', updateViewportState)
    }
  }, [])

  const isVerySmallScreen = viewportWidth !== null && viewportWidth < 390
  const monthTicks =
    mode === 'month'
      ? (() => {
          const totalDays = data.length
          const step = Math.max(1, Math.ceil(totalDays / 6))

          return Array.from(new Set(
            data
              .map((entry, index) => ({ day: Number(entry.label), index }))
              .filter(({ day, index }) => (
                Number.isFinite(day)
                && (day === 1 || day === totalDays || index % step === 0)
              ))
              .map(({ day }) => String(day))
          ))
        })()
      : undefined
  const chartTickFontSize =
    mode === 'year'
      ? viewportWidth !== null && viewportWidth < 360
        ? 9
        : isVerySmallScreen
          ? 10
          : 11
      : isVerySmallScreen
        ? 11
        : 12
  const xAxisHeight = compact ? 24 : mode === 'year' || mode === 'all' ? 40 : 32
  const baseChartConfig: ChartConfig =
    mode === 'week'
      ? {
          interval: 0,
          minTickGap: 10,
          tickMargin: 8,
          xPadding: { left: 6, right: 6 },
          yAxisWidth: 40,
          chartMargin: { top: 4, right: 6, left: 8, bottom: 0 },
          barCategoryGap: '30%',
          barSize: 18,
          maxBarSize: 24,
        }
      : mode === 'month'
        ? {
            minTickGap: isVerySmallScreen ? 16 : 14,
            tickMargin: 8,
            xPadding: { left: 4, right: 4 },
            yAxisWidth: 40,
            chartMargin: { top: 4, right: 6, left: 8, bottom: 0 },
            barCategoryGap: data.length <= 8 ? '26%' : '10%',
            barSize: 8,
            maxBarSize: 12,
          }
        : mode === 'rolling30'
          ? {
              interval: isVerySmallScreen && data.length > 10 ? 1 : 0,
              minTickGap: isVerySmallScreen ? 12 : 10,
              tickMargin: 8,
              xPadding: { left: 4, right: 4 },
              yAxisWidth: 40,
              chartMargin: { top: 4, right: 6, left: 8, bottom: 0 },
              barCategoryGap:
                data.length <= 4 ? '34%' : data.length <= 8 ? '26%' : '18%',
              barSize: data.length <= 4 ? 20 : 14,
              maxBarSize: data.length <= 4 ? 28 : 22,
          }
        : mode === 'year'
          ? {
              interval: 0,
              minTickGap: 0,
              tickMargin: 8,
              xPadding: { left: 4, right: 4 },
              yAxisWidth: 42,
              chartMargin: { top: 4, right: 6, left: 12, bottom: 6 },
              barCategoryGap: '46%',
              barSize: 12,
              maxBarSize: 16,
            }
          : {
              interval: isVerySmallScreen && data.length > 5 ? 1 : 0,
              minTickGap: isVerySmallScreen ? 16 : 12,
              tickMargin: 10,
              xPadding: data.length === 1 ? { left: 32, right: 32 } : { left: 10, right: 10 },
              yAxisWidth: 42,
              chartMargin: { top: 4, right: 6, left: 12, bottom: 6 },
              barCategoryGap: data.length === 1 ? '72%' : '36%',
              barSize: data.length === 1 ? 18 : 14,
              maxBarSize: data.length === 1 ? 24 : 20,
            }
  const chartConfig = showYAxis
    ? baseChartConfig
    : {
        ...baseChartConfig,
        yAxisWidth: 0,
        chartMargin: {
          ...baseChartConfig.chartMargin,
          left: compact ? 4 : 6,
        },
      }
  const activeBar =
    activeBarIndex === null || !data[activeBarIndex]
      ? null
      : { ...data[activeBarIndex], index: activeBarIndex }
  const weekTapTargetsStyle =
    mode === 'week'
      ? {
          top: chartConfig.chartMargin.top,
          right: chartConfig.chartMargin.right + chartConfig.xPadding.right,
          bottom: xAxisHeight,
          left: chartConfig.chartMargin.left + chartConfig.yAxisWidth + chartConfig.xPadding.left,
        }
      : null
  const chartInteractionStyle = {
    userSelect: 'none' as const,
    WebkitUserSelect: 'none' as const,
    WebkitTouchCallout: 'none' as const,
    WebkitTapHighlightColor: 'transparent',
  }

  return (
    <div className={`${heightClassName} w-full`}>
      <div className="relative h-full w-full select-none touch-manipulation" style={chartInteractionStyle}>
        {showTooltip ? (
          <div className="pointer-events-none absolute left-2 top-2 z-10">
            <ActivityChartTooltip point={activeBar} />
          </div>
        ) : null}
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={chartConfig.chartMargin}
            barCategoryGap={chartConfig.barCategoryGap}
            accessibilityLayer={false}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="label"
              ticks={mode === 'month' ? monthTicks : undefined}
              tickLine={false}
              axisLine={false}
              interval={chartConfig.interval}
              minTickGap={chartConfig.minTickGap}
              tickMargin={chartConfig.tickMargin}
              height={xAxisHeight}
              padding={chartConfig.xPadding}
              tick={{ fill: 'var(--chart-tick)', fontSize: chartTickFontSize }}
            />
            <YAxis
              hide={!showYAxis}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--chart-tick)', fontSize: chartTickFontSize }}
              width={chartConfig.yAxisWidth}
            />
            <Bar
              dataKey="distance"
              fill="var(--accent-strong)"
              radius={[8, 8, 0, 0]}
              barSize={chartConfig.barSize}
              maxBarSize={chartConfig.maxBarSize}
              onMouseEnter={(_, index) => {
                if (data[index]?.distance > 0) {
                  setActiveBarIndex(index)
                }
              }}
              onMouseLeave={() => {
                setActiveBarIndex(null)
              }}
              onClick={(_, index) => {
                if (data[index]?.distance > 0) {
                  setActiveBarIndex((current) => (current === index ? null : index))
                }
              }}
            >
              {data.map((entry, index) => (
                <Cell
                  key={`${entry.label}-${index}`}
                  cursor={entry.distance > 0 ? 'pointer' : 'default'}
                  fillOpacity={activeBarIndex === index ? 0.82 : 1}
                  pointerEvents={entry.distance > 0 ? 'auto' : 'none'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {mode === 'week' && weekTapTargetsStyle ? (
          <div className="absolute z-10 grid h-full w-full grid-cols-7" style={weekTapTargetsStyle}>
            {data.map((entry, index) => (
              <button
                key={`${entry.label}-tap-${index}`}
                type="button"
                className="h-full min-h-0 w-full appearance-none bg-transparent p-0"
                aria-label={`Показать активность за ${entry.label}: ${formatDistance(entry.distance)} км`}
                onClick={() => {
                  setActiveBarIndex((current) => (current === index ? null : index))
                }}
                style={chartInteractionStyle}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
