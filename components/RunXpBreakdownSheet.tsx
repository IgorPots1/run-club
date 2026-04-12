'use client'

import { useEffect } from 'react'
import type { RunXpBreakdownRow } from '@/lib/run-xp-presentation'

type RunXpBreakdownSheetProps = {
  open: boolean
  title?: string
  rows: RunXpBreakdownRow[]
  onClose: () => void
}

function formatSignedXp(value: number) {
  const roundedValue = Math.round(Number(value) || 0)
  return `${roundedValue > 0 ? '+' : ''}${roundedValue} XP`
}

export default function RunXpBreakdownSheet({
  open,
  title = 'XP за тренировку',
  rows,
  onClose,
}: RunXpBreakdownSheetProps) {
  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 md:items-center md:justify-center md:p-4">
      <button
        type="button"
        aria-label="Закрыть разбивку XP"
        className="absolute inset-0"
        onClick={onClose}
      />
      <section className="app-card relative w-full rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 shadow-xl md:max-w-md md:rounded-3xl md:pb-4">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200 dark:bg-gray-700 md:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="app-text-primary text-base font-semibold">{title}</h2>
            <p className="app-text-secondary mt-1 text-sm">Показано фактическое начисление после всех ограничений.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="app-text-secondary min-h-11 shrink-0 rounded-xl px-3 py-2 text-sm font-medium"
          >
            Закрыть
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {rows.map((row) => {
            const valueClassName = row.emphasis === 'strong'
              ? 'app-text-primary font-semibold'
              : row.emphasis === 'negative'
                ? 'text-red-600 dark:text-red-400'
                : 'app-text-primary'

            return (
              <div
                key={row.id}
                className={`flex items-center justify-between gap-3 rounded-2xl px-3 py-2 ${
                  row.emphasis === 'strong'
                    ? 'bg-black/[0.04] dark:bg-white/[0.06]'
                    : 'bg-black/[0.02] dark:bg-white/[0.03]'
                }`}
              >
                <p className={`min-w-0 text-sm ${row.emphasis === 'strong' ? 'app-text-primary font-medium' : 'app-text-secondary'}`}>
                  {row.label}
                </p>
                <p className={`shrink-0 text-sm ${valueClassName}`}>
                  {formatSignedXp(row.value)}
                </p>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
