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
const PICKER_HEIGHT = 220
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
      <div className="relative mt-2 h-[220px] overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="pointer-events-none absolute inset-x-2 top-1/2 z-10 h-11 -translate-y-1/2 rounded-lg bg-gray-50 ring-1 ring-black/5" />
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain px-2 py-[88px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {options.map((option) => {
            const isActive = option === value

            return (
              <button
                key={option}
                type="button"
                onClick={() => handleSelect(option)}
                className={`flex h-11 w-full snap-center items-center justify-center rounded-lg text-base transition-colors ${
                  isActive ? 'font-semibold text-gray-900' : 'text-gray-400'
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
