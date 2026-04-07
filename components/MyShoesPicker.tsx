'use client'

import { Check } from 'lucide-react'
import Link from 'next/link'
import { getShoeWearUi } from '@/lib/shoe-wear-ui'
import type { UserShoeRecord } from '@/lib/shoes-client'

type MyShoesPickerProps = {
  shoes: UserShoeRecord[]
  selectedShoeId: string
  onSelect: (shoeId: string) => void
  disabled?: boolean
  loading?: boolean
  addPairHref?: string
  hint?: string
  className?: string
}

function getMetaLabel(shoe: UserShoeRecord) {
  const parts: string[] = []

  if (shoe.nickname) {
    parts.push(shoe.nickname)
  }

  if (!shoe.isActive) {
    parts.push('Архив')
  }

  return parts.join(' • ')
}

function getRemainingDistanceLabel(shoe: UserShoeRecord) {
  const wearUi = getShoeWearUi({
    currentDistanceMeters: shoe.currentDistanceMeters,
    maxDistanceMeters: shoe.maxDistanceMeters,
  })

  if (wearUi.usagePercent > 100) {
    return 'Пробег превысил ресурс'
  }

  return `Осталось ~${Math.max(0, Math.round((wearUi.maxDistanceMeters - wearUi.currentDistanceMeters) / 1000))} км`
}

function getWearDotClassName(status: 'fresh' | 'warning' | 'critical') {
  if (status === 'critical') {
    return 'bg-rose-500'
  }

  if (status === 'warning') {
    return 'bg-amber-500'
  }

  return 'bg-emerald-500'
}

export default function MyShoesPicker({
  shoes,
  selectedShoeId,
  onSelect,
  disabled = false,
  loading = false,
  addPairHref = '/activity/shoes',
  hint = '',
  className = '',
}: MyShoesPickerProps) {
  const wrapperClassName = className.trim()

  return (
    <div className={wrapperClassName}>
      <div className="overflow-hidden rounded-2xl border border-black/[0.05] dark:border-white/[0.08]">
        <button
          type="button"
          onClick={() => onSelect('')}
          disabled={disabled}
          aria-pressed={selectedShoeId === ''}
          className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            selectedShoeId === ''
              ? 'bg-[var(--accent-soft)]/70'
              : 'bg-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.03]'
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="app-text-primary text-sm font-semibold">Без кроссовок</p>
            <p className="app-text-secondary mt-1 text-xs">Тренировка будет сохранена без пары</p>
          </div>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
            {selectedShoeId === '' ? (
              <Check className="h-4 w-4 text-[var(--accent-strong)]" strokeWidth={2.2} />
            ) : null}
          </span>
        </button>

        {loading ? (
          <div className="app-surface-muted border-t border-dashed p-4 text-sm app-text-secondary">
            Загружаем ваши пары...
          </div>
        ) : shoes.length === 0 ? (
          <div className="app-surface-muted border-t border-dashed p-4 text-sm app-text-secondary">
            Пока нет добавленных кроссовок.
          </div>
        ) : (
          shoes.map((shoe) => {
            const isSelected = selectedShoeId === shoe.id
            const metaLabel = getMetaLabel(shoe)
            const wearUi = getShoeWearUi({
              currentDistanceMeters: shoe.currentDistanceMeters,
              maxDistanceMeters: shoe.maxDistanceMeters,
            })
            const remainingDistanceLabel = getRemainingDistanceLabel(shoe)

            return (
              <button
                key={shoe.id}
                type="button"
                onClick={() => onSelect(shoe.id)}
                disabled={disabled}
                aria-pressed={isSelected}
                className={`flex w-full items-start justify-between gap-3 border-t border-black/[0.05] px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.08] ${
                  isSelected
                    ? 'bg-[var(--accent-soft)]/70'
                    : 'bg-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.03]'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="app-text-primary text-sm font-semibold">{shoe.displayName}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <p className="app-text-secondary">{remainingDistanceLabel}</p>
                    <span className="app-text-muted">•</span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${getWearDotClassName(wearUi.status)}`}
                        aria-hidden="true"
                      />
                      <span className="app-text-secondary">{wearUi.label}</span>
                    </div>
                    {metaLabel ? (
                      <>
                        <span className="app-text-muted">•</span>
                        <span className="app-text-secondary">{metaLabel}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {isSelected ? (
                    <Check className="h-4 w-4 text-[var(--accent-strong)]" strokeWidth={2.2} />
                  ) : null}
                </span>
              </button>
            )
          })
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2 border-t border-black/[0.05] pt-3 dark:border-white/[0.08]">
        {hint ? <p className="app-text-secondary text-xs">{hint}</p> : null}
        <Link
          href={addPairHref}
          className="app-button-secondary inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium"
        >
          Добавить новую пару
        </Link>
      </div>
    </div>
  )
}
