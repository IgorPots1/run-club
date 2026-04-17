'use client'

import { useState } from 'react'

type RequestState = 'idle' | 'success' | 'error'

export default function AdminStravaRecoveryButton() {
  const [isLoading, setIsLoading] = useState(false)
  const [state, setState] = useState<RequestState>('idle')
  const [message, setMessage] = useState('')

  async function handleClick() {
    setIsLoading(true)
    setState('idle')
    setMessage('')

    try {
      const response = await fetch('/api/admin/strava/recover-recent', {
        method: 'POST',
      })
      const data = (await response.json().catch(() => null)) as
        | {
            ok?: boolean
            error?: string
            message?: string
            imported?: number
            updated?: number
            skipped?: number
            failed?: number
          }
        | null

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Не удалось запустить восстановление')
      }

      setState('success')
      setMessage(
        data.message ||
          `Готово: импортировано ${data.imported ?? 0}, обновлено ${data.updated ?? 0}, пропущено ${data.skipped ?? 0}, ошибок ${data.failed ?? 0}.`
      )
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : 'Не удалось запустить восстановление')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="mt-4 border-t pt-4">
      <div className="space-y-2">
        <button
          type="button"
          onClick={handleClick}
          disabled={isLoading}
          className="app-button-secondary w-full rounded-2xl border px-4 py-2 text-sm font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? 'Восстанавливаем...' : 'Восстановить тренировки (14 дней)'}
        </button>
        {message ? (
          <p
            className={`text-xs ${
              state === 'error' ? 'text-rose-600 dark:text-rose-300' : 'app-text-secondary'
            }`}
          >
            {message}
          </p>
        ) : null}
      </div>
    </div>
  )
}
