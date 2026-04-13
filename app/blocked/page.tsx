'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { logoutCurrentUser } from '@/lib/auth/logoutClient'

export default function BlockedPage() {
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState('')

  async function handleLogout() {
    if (loggingOut) return

    setLoggingOut(true)
    setError('')

    try {
      await logoutCurrentUser({
        router,
        redirectTo: '/login',
      })
    } catch {
      setError('Не удалось выйти из аккаунта')
      setLoggingOut(false)
    }
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <div className="space-y-4 rounded border p-6">
        <h1 className="text-2xl font-semibold">Доступ к приложению приостановлен</h1>
        <p className="text-sm text-gray-600">Напишите тренеру для уточнения.</p>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="app-button-secondary min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loggingOut ? 'Выходим...' : 'Выйти из аккаунта'}
        </button>
      </div>
    </main>
  )
}
