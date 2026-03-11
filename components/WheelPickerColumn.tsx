'use client'

import { useEffect, useRef } from 'react'

type WheelPickerColumnProps = {
  label: string
  value: number
  options: number[]
  onChange: (value: number) => void
  formatter?: (value: number) => string
  isOptionDisabled?: (value: number) => boolean
}

const ITEM_HEIGHT = 44
const PICKER_HEIGHT = 236
const PICKER_PADDING = (PICKER_HEIGHT - ITEM_HEIGHT) / 2

export default function WheelPickerColumn({
  label,
  value,
  options,
  onChange,
  formatter = (option) => String(option),
  isOptionDisabled = () => false,
}: WheelPickerColumnProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const selectedIndex = Math.max(options.indexOf(value), 0)
    const nextScrollTop = selectedIndex * ITEM_HEIGHT

    if (Math.abs(container.scrollTop - nextScrollTop) < 1) return

    container.scrollTo({
      top: nextScrollTop,
      behavior: 'smooth',
    })
  }, [options, value])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  function getClosestEnabledOption(option: number) {
    if (!options.length) return option
    if (!isOptionDisabled(option)) return option

    const currentIndex = options.indexOf(option)

    for (let offset = 1; offset < options.length; offset += 1) {
      const previousOption = options[currentIndex - offset]
      if (previousOption !== undefined && !isOptionDisabled(previousOption)) {
        return previousOption
      }

      const nextOption = options[currentIndex + offset]
      if (nextOption !== undefined && !isOptionDisabled(nextOption)) {
        return nextOption
      }
    }

    return option
  }

  function handleScroll() {
    const container = scrollRef.current
    if (!container) return

    const nextIndex = Math.max(0, Math.min(options.length - 1, Math.round(container.scrollTop / ITEM_HEIGHT)))
    const nextValue = getClosestEnabledOption(options[nextIndex])

    if (nextValue !== value) {
      onChange(nextValue)
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      const activeContainer = scrollRef.current
      if (!activeContainer) return

      const alignedIndex = Math.max(options.indexOf(nextValue), 0)
      activeContainer.scrollTo({
        top: alignedIndex * ITEM_HEIGHT,
        behavior: 'smooth',
      })
    }, 80)
  }

  function handleSelect(option: number) {
    if (isOptionDisabled(option)) return
    onChange(option)

    const container = scrollRef.current
    if (!container) return

    const optionIndex = Math.max(options.indexOf(option), 0)
    container.scrollTo({
      top: optionIndex * ITEM_HEIGHT,
      behavior: 'smooth',
    })
  }

  return (
    <div className="min-w-0">
      <p className="app-text-secondary text-center text-xs font-medium uppercase tracking-wide">{label}</p>
      <div className="app-card relative mt-2 h-[236px] overflow-hidden rounded-xl border shadow-sm">
        <div className="app-surface-muted pointer-events-none absolute inset-x-2 top-1/2 z-0 h-11 -translate-y-1/2 rounded-lg ring-1 ring-black/5 dark:ring-white/10" />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-16 bg-gradient-to-b from-white via-white/85 to-transparent dark:from-gray-900 dark:via-gray-900/85" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-16 bg-gradient-to-t from-white via-white/85 to-transparent dark:from-gray-900 dark:via-gray-900/85" />
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="relative z-10 h-full snap-y snap-mandatory overflow-y-auto overscroll-contain px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ paddingTop: PICKER_PADDING, paddingBottom: PICKER_PADDING }}
        >
          {options.map((option) => {
            const isActive = option === value
            const isDisabled = isOptionDisabled(option)

            return (
              <button
                key={option}
                type="button"
                disabled={isDisabled}
                onClick={() => handleSelect(option)}
                className={`flex h-11 w-full snap-center items-center justify-center rounded-lg text-base transition-colors ${
                  isDisabled
                    ? 'cursor-not-allowed text-gray-300 dark:text-gray-600'
                    : isActive
                      ? 'app-text-primary font-semibold'
                      : 'app-text-secondary'
                }`}
              >
                {formatter(option)}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
