'use client'

type ActivitySummaryMetric = {
  id: string
  label: string
  value: string
  subtext?: string
  tone?: 'positive' | 'negative'
}

type ActivitySummaryGridProps = {
  title?: string
  subtitle?: string
  metrics: ActivitySummaryMetric[]
  compact?: boolean
  secondaryMetricLabel?: string
  secondaryMetricValue?: string
  className?: string
  metricClassName?: string
  valueClassName?: string
}

export default function ActivitySummaryGrid({
  title,
  subtitle,
  metrics,
  compact = false,
  secondaryMetricLabel,
  secondaryMetricValue,
  className,
  metricClassName,
  valueClassName,
}: ActivitySummaryGridProps) {
  return (
    <section className={`app-card rounded-2xl p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 md:p-5 ${className ?? ''}`.trim()}>
      {title ? (
        <div>
          <h2 className="app-text-primary text-base font-semibold">{title}</h2>
          {subtitle ? (
            <p className="app-text-secondary mt-1 text-sm">{subtitle}</p>
          ) : null}
        </div>
      ) : null}
      <div className={`${title ? 'mt-3' : ''} grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3`}>
        {metrics.map((metric) => (
          <div
            key={metric.id}
            className={`min-w-0 rounded-xl border-l-2 border-black/8 bg-black/[0.02] px-3 py-2.5 dark:border-white/12 dark:bg-white/[0.03] ${
              compact ? 'sm:min-h-[82px]' : 'sm:min-h-[88px]'
            } ${metricClassName ?? ''}`.trim()}
          >
            <p className="app-text-secondary text-[11px] font-medium sm:text-xs">{metric.label}</p>
            <p
              className={`app-text-primary mt-3 break-words font-semibold leading-tight ${
                metric.tone === 'positive'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : metric.tone === 'negative'
                    ? 'text-red-600 dark:text-red-400'
                    : compact
                      ? 'text-base sm:text-[1.05rem]'
                      : 'text-base sm:text-lg'
              } ${valueClassName ?? ''}`.trim()}
            >
              {metric.value}
            </p>
            {metric.subtext ? (
              <p className="app-text-secondary mt-1 text-[11px] leading-tight sm:text-xs">
                {metric.subtext}
              </p>
            ) : null}
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
