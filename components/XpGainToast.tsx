'use client'

import type { PostRunChallengeFeedbackItem } from '@/lib/challenge-ux'
import { formatXpBreakdownLabels, type XpBreakdownItem } from '@/lib/xp'

type XpGainToastProps = {
  xpGained: number
  breakdown?: XpBreakdownItem[]
  challengeMessages?: PostRunChallengeFeedbackItem[]
  offsetClassName?: string
}

export default function XpGainToast({
  xpGained,
  breakdown = [],
  challengeMessages = [],
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
        {challengeMessages.length > 0 ? (
          <div className="mt-2 space-y-2">
            {challengeMessages.map((message) => (
              <div
                key={message.challengeId}
                className="rounded-xl border border-black/[0.06] px-3 py-2 text-left dark:border-white/[0.08]"
              >
                <p className="app-text-primary text-xs font-medium">{message.title}</p>
                <p className="app-text-secondary mt-1 text-xs">{message.todayProgressLabel}</p>
                {message.nearCompletionMessage ? (
                  <p className="app-text-primary mt-1 text-xs font-medium">{message.nearCompletionMessage}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
