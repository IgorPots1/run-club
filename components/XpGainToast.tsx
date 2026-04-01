'use client'

import { formatXpBreakdownLabels, type XpBreakdownItem } from '@/lib/xp'

type XpGainToastProps = {
  xpGained: number
  breakdown?: XpBreakdownItem[]
  offsetClassName?: string
}

export default function XpGainToast({
  xpGained,
  breakdown = [],
  offsetClassName = 'top-4',
}: XpGainToastProps) {
  const breakdownLabel = formatXpBreakdownLabels(breakdown)

  return (
    <div className={`pointer-events-none fixed inset-x-4 ${offsetClassName} z-50 flex justify-center`}>
      <div className="app-card w-full max-w-sm rounded-2xl border px-4 py-3 text-center shadow-lg ring-1 ring-black/5 dark:ring-white/10">
        <p className="app-text-primary text-sm font-medium">{`+${xpGained} XP`}</p>
        {breakdownLabel ? (
          <p className="app-text-secondary mt-1 text-xs">{breakdownLabel}</p>
        ) : null}
      </div>
    </div>
  )
}
