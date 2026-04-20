'use client'

import type { ReactNode } from 'react'

type FeedActionButtonProps = {
  count: number
  icon: ReactNode
  onClick: () => void
  onCountClick?: () => void
  onInteractionStart?: () => void
  active?: boolean
  disabled?: boolean
  actionDisabled?: boolean
  disableTransitions?: boolean
}

export default function FeedActionButton({
  count,
  icon,
  onClick,
  onCountClick,
  onInteractionStart,
  active = false,
  disabled = false,
  actionDisabled = false,
  disableTransitions = false,
}: FeedActionButtonProps) {
  const isActionBlocked = disabled || actionDisabled

  return (
    <div
      onClick={(event) => {
        event.stopPropagation()
      }}
      onMouseEnter={() => onInteractionStart?.()}
      onFocus={() => onInteractionStart?.()}
      onTouchStart={() => onInteractionStart?.()}
      className={`-m-1 inline-flex min-h-12 min-w-0 items-center gap-0.5 rounded-full p-1 text-sm leading-none ${
        active ? 'text-[var(--like-active)]' : 'text-[var(--text-secondary)]'
      }`}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()

          if (isActionBlocked) {
            return
          }

          onClick()
        }}
        disabled={disabled}
        aria-disabled={isActionBlocked ? true : undefined}
        className={`inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-full px-2.5 disabled:cursor-not-allowed disabled:opacity-60 ${
          disableTransitions ? 'transition-none' : 'transition-colors active:scale-[0.98]'
        } ${
          actionDisabled && !disabled ? 'cursor-not-allowed' : ''
        }`}
      >
        <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
          {icon}
        </span>
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          ;(onCountClick ?? onClick)()
        }}
        disabled={disabled}
        className={`inline-flex min-h-10 min-w-[2.25rem] items-center justify-center rounded-full px-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
          disableTransitions ? 'transition-none' : 'transition-colors active:scale-[0.98]'
        }`}
      >
        {count}
      </button>
    </div>
  )
}
