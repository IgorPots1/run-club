'use client'

import Link from 'next/link'
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
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => onSelect('')}
          disabled={disabled}
          aria-pressed={selectedShoeId === ''}
          className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            selectedShoeId === ''
              ? 'app-button-primary shadow-sm'
              : 'app-card'
          }`}
        >
          <p className="text-sm font-semibold">Без кроссовок</p>
          <p className={`mt-1 text-xs ${selectedShoeId === '' ? 'text-white/85' : 'app-text-secondary'}`}>
            Тренировка будет сохранена без пары
          </p>
        </button>

        {loading ? (
          <div className="app-surface-muted rounded-2xl border border-dashed p-4 text-sm app-text-secondary">
            Загружаем ваши пары...
          </div>
        ) : shoes.length === 0 ? (
          <div className="app-surface-muted rounded-2xl border border-dashed p-4 text-sm app-text-secondary">
            Пока нет добавленных кроссовок.
          </div>
        ) : (
          shoes.map((shoe) => {
            const isSelected = selectedShoeId === shoe.id
            const metaLabel = getMetaLabel(shoe)

            return (
              <button
                key={shoe.id}
                type="button"
                onClick={() => onSelect(shoe.id)}
                disabled={disabled}
                aria-pressed={isSelected}
                className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  isSelected
                    ? 'app-button-primary shadow-sm'
                    : 'app-card'
                }`}
              >
                <p className="text-sm font-semibold">{shoe.displayName}</p>
                {metaLabel ? (
                  <p className={`mt-1 text-xs ${isSelected ? 'text-white/85' : 'app-text-secondary'}`}>
                    {metaLabel}
                  </p>
                ) : null}
              </button>
            )
          })
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2">
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
