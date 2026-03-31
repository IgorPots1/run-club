'use client'

import { LoaderCircle } from 'lucide-react'
import { useEffect } from 'react'

type ConfirmActionSheetProps = {
  open: boolean
  title: string
  description?: string
  confirmLabel: string
  cancelLabel: string
  loading?: boolean
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmActionSheet({
  open,
  title,
  description = '',
  confirmLabel,
  cancelLabel,
  loading = false,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmActionSheetProps) {
  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !loading) {
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [loading, onCancel, open])

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 md:items-center md:justify-center md:p-4">
      <button
        type="button"
        aria-label="Закрыть подтверждение"
        className="absolute inset-0"
        onClick={onCancel}
        disabled={loading}
      />
      <section className="app-card relative w-full rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 shadow-xl md:max-w-md md:rounded-3xl md:pb-4">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200 dark:bg-gray-700 md:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="app-text-primary text-base font-semibold">{title}</h2>
            {description ? <p className="app-text-secondary mt-1 text-sm">{description}</p> : null}
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="app-button-secondary inline-flex min-h-11 items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
              destructive
                ? 'border-red-500 bg-red-500 text-white'
                : 'app-button-primary'
            }`}
          >
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </section>
    </div>
  )
}
