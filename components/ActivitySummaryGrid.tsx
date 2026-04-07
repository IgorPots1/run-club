'use client'

type ActivitySummaryMetric = {
  id: string
  label: string
  value: string
}

type ActivitySummaryGridProps = {
  title?: string
  subtitle?: string
  metrics: ActivitySummaryMetric[]
  compact?: boolean
  secondaryMetricLabel?: string
  secondaryMetricValue?: string
}

export default function ActivitySummaryGrid({
  title,
  subtitle,
  metrics,
  compact = false,
  secondaryMetricLabel,
  secondaryMetricValue,
}: ActivitySummaryGridProps) {
  return (
    <section className="app-card rounded-2xl p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 md:p-5">
      {title ? (
        <div>
          <h2 className="app-text-primary text-base font-semibold">{title}</h2>
          {subtitle ? (
            <p className="app-text-secondary mt-1 text-sm">{subtitle}</p>
          ) : null}
        </div>
      ) : null}
      <div className={`${title ? 'mt-4' : ''} grid grid-cols-2 gap-3 md:grid-cols-4`}>
        {metrics.map((metric) => (
          <div
            key={metric.id}
            className={`app-surface-muted flex min-h-[92px] flex-col justify-between rounded-2xl px-3 py-3 ring-1 ring-black/5 dark:ring-white/10 ${
              compact ? 'sm:min-h-[88px]' : 'sm:min-h-[100px]'
            }`}
          >
            <p className="app-text-secondary text-sm">{metric.label}</p>
            <p
              className={`app-text-primary mt-3 break-words font-semibold leading-tight ${
                compact ? 'text-lg sm:text-[1.15rem]' : 'text-[1.45rem] sm:text-[1.7rem]'
              }`}
            >
              {metric.value}
            </p>
          </div>
        ))}
      </div>
      {secondaryMetricLabel && secondaryMetricValue ? (
        <div className="app-text-secondary mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span>{secondaryMetricLabel}:</span>
          <span className="app-text-primary font-medium">{secondaryMetricValue}</span>
        </div>
      ) : null}
    </section>
  )
}
