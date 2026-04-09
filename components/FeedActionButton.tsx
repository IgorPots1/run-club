'use client'

import type { ReactNode } from 'react'

type FeedActionButtonProps = {
  count: number
  icon: ReactNode
  onClick: () => void
  onCountClick?: () => void
  active?: boolean
  disabled?: boolean
  actionDisabled?: boolean
}

export default function FeedActionButton({
  count,
  icon,
  onClick,
  onCountClick,
  active = false,
  disabled = false,
  actionDisabled = false,
}: FeedActionButtonProps) {
  const isActionBlocked = disabled || actionDisabled

  return (
    <div
      className={`inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-full px-1 py-1 text-sm leading-none ${
        active ? 'text-[var(--like-active)]' : 'text-[var(--text-secondary)]'
      }`}
    >
      <button
        type="button"
        onClick={() => {
          if (isActionBlocked) {
            return
          }

          onClick()
        }}
        disabled={disabled}
        aria-disabled={isActionBlocked ? true : undefined}
        className={`inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-full px-2 transition-colors active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${
          actionDisabled && !disabled ? 'cursor-not-allowed' : ''
        }`}
      >
        <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
          {icon}
        </span>
      </button>
      <button
        type="button"
        onClick={onCountClick ?? onClick}
        disabled={disabled}
        className="inline-flex min-h-9 min-w-0 items-center justify-center rounded-full px-2 text-sm font-semibold transition-colors active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {count}
      </button>
    </div>
  )
}
