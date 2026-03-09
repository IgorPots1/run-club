'use client'

import { useEffect, useRef } from 'react'

type WheelPickerColumnProps = {
  label: string
  value: number
  options: number[]
  onChange: (value: number) => void
  formatter?: (value: number) => string
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

  function handleScroll() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      const container = scrollRef.current
      if (!container) return

      const nextIndex = Math.max(0, Math.min(options.length - 1, Math.round(container.scrollTop / ITEM_HEIGHT)))
      const nextValue = options[nextIndex]

      if (nextValue !== value) {
        onChange(nextValue)
      } else {
        container.scrollTo({
          top: nextIndex * ITEM_HEIGHT,
          behavior: 'smooth',
        })
      }
    }, 80)
  }

  function handleSelect(option: number) {
    onChange(option)
  }

  return (
    <div className="min-w-0">
      <p className="text-center text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <div className="relative mt-2 h-[236px] overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="pointer-events-none absolute inset-x-2 top-1/2 z-0 h-11 -translate-y-1/2 rounded-lg bg-gray-50 ring-1 ring-black/5" />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-16 bg-gradient-to-b from-white via-white/85 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-16 bg-gradient-to-t from-white via-white/85 to-transparent" />
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="relative z-10 h-full snap-y snap-mandatory overflow-y-auto overscroll-contain px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ paddingTop: PICKER_PADDING, paddingBottom: PICKER_PADDING }}
        >
          {options.map((option) => {
            const isActive = option === value

            return (
              <button
                key={option}
                type="button"
                onClick={() => handleSelect(option)}
                className={`flex h-11 w-full snap-center items-center justify-center rounded-lg text-base transition-colors ${
                  isActive ? 'font-semibold text-gray-900' : 'text-gray-500'
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
