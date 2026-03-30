'use client'

import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ActivityTrendPoint } from '@/lib/activity'
import { formatDistanceKm } from '@/lib/format'

type ProfileWeeklyVolumeTrendChartProps = {
  data: ActivityTrendPoint[]
}

function WeeklyVolumeTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload?: ActivityTrendPoint }>
}) {
  const point = payload?.[0]?.payload

  if (!active || !point) {
    return null
  }

  return (
    <div className="app-card rounded-xl border px-3 py-2 shadow-lg">
      <p className="app-text-secondary text-xs">
        Неделя <span className="app-text-primary font-medium">{point.label}</span>
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
  const latestPoint = data[data.length - 1] ?? null

  return (
    <div className="h-[190px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 10, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="profile-weekly-volume-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--accent-strong)" stopOpacity={0.18} />
              <stop offset="95%" stopColor="var(--accent-strong)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
          />
          <YAxis hide domain={[0, 'dataMax + 2']} />
          <Tooltip
            cursor={false}
            content={<WeeklyVolumeTooltip />}
          />
          {latestPoint ? (
            <ReferenceLine
              x={latestPoint.label}
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
              const isLatest = dotProps.index === data.length - 1

              return (
                <circle
                  key={`weekly-dot-${dotProps.index}`}
                  cx={dotProps.cx}
                  cy={dotProps.cy}
                  r={isLatest ? 4.5 : 3}
                  fill="var(--accent-strong)"
                  fillOpacity={isLatest ? 1 : 0.7}
                  stroke="var(--surface)"
                  strokeWidth={isLatest ? 2 : 1.5}
                />
              )
            }}
            activeDot={{ r: 5, fill: 'var(--accent-strong)', stroke: 'var(--surface)', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
