'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import InnerPageHeader from '@/components/InnerPageHeader'
import { getBootstrapUser } from '@/lib/auth'
import type { StravaInitialSyncFailureStep } from '@/lib/strava/strava-types'

type StravaConnectionState = 'connected' | 'reconnect_required' | 'disconnected'

type StravaStatusResponse =
  | {
      ok: true
      state: StravaConnectionState
      connected: boolean
      hasImportedRuns: boolean
    }
  | {
      ok: false
      step?: string
      error?: string
    }

type StravaSyncResponse =
  | {
      ok: true
      step: 'initial_sync_complete'
      imported: number
      skipped: number
      failed: number
      totalRunsFetched: number
    }
  | {
      ok: false
      step?: StravaInitialSyncFailureStep | 'auth_required' | 'initial_sync_failed'
      error?: string
    }

type StravaDisconnectResponse =
  | {
      ok: true
    }
  | {
      ok: false
      step?: string
      error?: string
    }

function StravaIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="block h-[18px] w-[18px] shrink-0 text-[#FC4C02]"
    >
      <path d="M15.386 1 9.999 11.56h3.178L15.386 7l2.209 4.56h3.177L15.386 1Z" />
      <path d="M9.999 14.077 7.354 19.41h2.41L9.999 18.9l.235.51h2.41l-2.645-5.333Z" />
    </svg>
  )
}

function getStatusDescription({
  statusLoading,
  connectionState,
  hasImportedRuns,
}: {
  statusLoading: boolean
  connectionState: StravaConnectionState
  hasImportedRuns: boolean
}) {
  if (statusLoading) {
    return 'Проверяем подключение Strava...'
  }

  if (connectionState === 'connected') {
    return hasImportedRuns
      ? 'Strava подключена. Можно снова запустить синхронизацию.'
      : 'Strava подключена. Можно выполнить первую синхронизацию.'
  }

  if (connectionState === 'reconnect_required') {
    return 'Нужно переподключить аккаунт Strava, чтобы продолжить синхронизацию.'
  }

  return hasImportedRuns
    ? 'Strava сейчас отключена. Импортированные пробежки останутся в приложении.'
    : 'Подключение Strava пока не настроено.'
}

function getSyncErrorMessage(step?: string) {
  if (step === 'reconnect_required') {
    return 'Нужно переподключить Strava, чтобы продолжить синхронизацию.'
  }

  return 'Не удалось синхронизировать данные из Strava.'
}

export default function StravaPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusLoading, setStatusLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [connectionState, setConnectionState] = useState<StravaConnectionState>('disconnected')
  const [hasImportedRuns, setHasImportedRuns] = useState(false)
  const [pageError, setPageError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const handledStravaParamRef = useRef(false)

  const loadStravaStatus = useCallback(async (shouldUpdate: () => boolean = () => true) => {
    setStatusLoading(true)
    setPageError('')

    try {
      const response = await fetch('/api/strava/status', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'include',
      })

      const payload = (await response.json().catch(() => null)) as StravaStatusResponse | null

      if (!shouldUpdate()) return

      if (!response.ok || !payload?.ok) {
        setConnectionState('disconnected')
        setHasImportedRuns(false)
        setPageError('Не удалось загрузить статус Strava')
        return
      }

      setConnectionState(payload.state)
      setHasImportedRuns(payload.hasImportedRuns)
    } catch {
      if (!shouldUpdate()) return

      setConnectionState('disconnected')
      setHasImportedRuns(false)
      setPageError('Не удалось загрузить статус Strava')
    } finally {
      if (shouldUpdate()) {
        setStatusLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadUser() {
      try {
        if (!isMounted) return

        const nextUser = await getBootstrapUser()
        setUser(nextUser)

        if (!nextUser) {
          router.replace('/login')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    void loadUser()

    return () => {
      isMounted = false
    }
  }, [router])

  useEffect(() => {
    if (!user) return

    let isMounted = true
    const shouldUpdate = () => isMounted

    void loadStravaStatus(shouldUpdate)

    return () => {
      isMounted = false
    }
  }, [loadStravaStatus, user])

  useEffect(() => {
    if (!user) return

    const stravaStatus = searchParams.get('strava')

    if (!stravaStatus || handledStravaParamRef.current) {
      return
    }

    handledStravaParamRef.current = true
    setPageError('')
    setSuccessMessage('')

    if (stravaStatus === 'connected') {
      setSuccessMessage('Strava успешно подключена.')
      void loadStravaStatus()
    } else if (stravaStatus === 'error') {
      setPageError('Не удалось подключить Strava.')
    }

    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.delete('strava')
    const nextUrl = nextParams.toString() ? `${pathname}?${nextParams.toString()}` : pathname
    router.replace(nextUrl, { scroll: false })
  }, [loadStravaStatus, pathname, router, searchParams, user])

  async function handleSync() {
    if (syncing || disconnecting) {
      return
    }

    setPageError('')
    setSuccessMessage('')
    setSyncing(true)

    try {
      const response = await fetch('/api/strava/sync', {
        method: 'POST',
        credentials: 'include',
      })
      const payload = (await response.json().catch(() => null)) as StravaSyncResponse | null

      if (!response.ok || !payload?.ok) {
        if (payload?.step === 'reconnect_required') {
          setConnectionState('reconnect_required')
        }

        setPageError(getSyncErrorMessage(payload?.step))
        await loadStravaStatus()
        return
      }

      await loadStravaStatus()

      if (payload.imported > 0) {
        setSuccessMessage(`Синхронизация завершена. Импортировано новых пробежек: ${payload.imported}.`)
      } else {
        setSuccessMessage('Синхронизация завершена. Новых пробежек не найдено.')
      }
    } catch {
      setPageError('Не удалось синхронизировать данные из Strava.')
    } finally {
      setSyncing(false)
    }
  }

  async function handleDisconnect() {
    if (disconnecting || syncing) {
      return
    }

    const confirmed = window.confirm('Отключить Strava?')

    if (!confirmed) {
      return
    }

    setPageError('')
    setSuccessMessage('')
    setDisconnecting(true)

    try {
      const response = await fetch('/api/strava/disconnect', {
        method: 'DELETE',
        credentials: 'include',
      })
      const payload = (await response.json().catch(() => null)) as StravaDisconnectResponse | null

      if (!response.ok || !payload?.ok) {
        setPageError('Не удалось отключить Strava.')
        return
      }

      await loadStravaStatus()
      setSuccessMessage('Strava отключена.')
    } catch {
      setPageError('Не удалось отключить Strava.')
    } finally {
      setDisconnecting(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        Загрузка...
      </main>
    )
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))]">
        <Link href="/login" className="text-sm underline">Открыть вход</Link>
      </main>
    )
  }

  const statusDescription = getStatusDescription({
    statusLoading,
    connectionState,
    hasImportedRuns,
  })
  const connectLabel = connectionState === 'reconnect_required' ? 'Переподключить Strava' : 'Подключить Strava'

  if (statusLoading && !successMessage && !pageError) {
    return (
      <main className="min-h-screen">
        <div className="pointer-events-none fixed inset-x-0 top-0 z-30">
          <div className="pointer-events-auto mx-auto max-w-xl px-4 md:px-4">
            <InnerPageHeader title="Strava" fallbackHref="/profile" />
          </div>
        </div>
        <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
          <div aria-hidden="true" className="invisible">
            <InnerPageHeader title="Strava" fallbackHref="/profile" />
          </div>
          <div className="mt-4">
            <h1 className="app-text-primary mb-4 text-2xl font-bold">Strava</h1>
            <div className="app-card mb-4 space-y-3 rounded-2xl border p-4 shadow-sm">
              <div className="skeleton-line h-6 w-24" />
              <div className="skeleton-line h-4 w-full" />
              <div className="skeleton-line h-11 w-40" />
            </div>
            <div className="app-card space-y-3 rounded-2xl border p-4 shadow-sm">
              <div className="skeleton-line h-6 w-32" />
              <div className="skeleton-line h-11 w-full" />
              <div className="skeleton-line h-11 w-full" />
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30">
        <div className="pointer-events-auto mx-auto max-w-xl px-4 md:px-4">
          <InnerPageHeader title="Strava" fallbackHref="/profile" />
        </div>
      </div>
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <div aria-hidden="true" className="invisible">
          <InnerPageHeader title="Strava" fallbackHref="/profile" />
        </div>
        <div className="mt-4">
          <div className="mb-4 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/5 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03]"
            >
              <StravaIcon />
            </span>
            <div>
              <h1 className="app-text-primary text-2xl font-bold">Strava</h1>
              <p className="app-text-secondary mt-1 text-sm">
                Подключение аккаунта и ручная синхронизация пробежек.
              </p>
            </div>
          </div>

          {pageError ? <p className="mb-4 text-sm text-red-600">{pageError}</p> : null}
          {successMessage ? <p className="mb-4 text-sm text-green-700">{successMessage}</p> : null}

          <section className="app-card mb-4 rounded-2xl border p-4 shadow-sm">
            <div className="mb-3">
              <h2 className="app-text-primary text-lg font-semibold">Статус подключения</h2>
              <p className="app-text-secondary mt-1 text-sm">{statusDescription}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="app-text-secondary inline-flex rounded-full border border-black/5 bg-black/[0.02] px-3 py-1.5 text-xs font-medium dark:border-white/10 dark:bg-white/[0.03]">
                {connectionState === 'connected'
                  ? 'Подключено'
                  : connectionState === 'reconnect_required'
                    ? 'Нужно переподключить'
                    : 'Не подключено'}
              </span>
              {hasImportedRuns ? (
                <span className="app-text-secondary inline-flex rounded-full border border-black/5 bg-black/[0.02] px-3 py-1.5 text-xs font-medium dark:border-white/10 dark:bg-white/[0.03]">
                  Есть импортированные пробежки
                </span>
              ) : null}
            </div>
          </section>

          <section className="app-card rounded-2xl border p-4 shadow-sm">
            <div className="mb-3">
              <h2 className="app-text-primary text-lg font-semibold">Действия</h2>
              <p className="app-text-secondary mt-1 text-sm">
                Используются текущие endpoint&apos;ы подключения, синхронизации и отключения.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {connectionState !== 'connected' ? (
                <a
                  href="/api/strava/connect?next=/profile/strava"
                  className="app-button-primary inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-medium"
                >
                  {connectLabel}
                </a>
              ) : null}

              {connectionState === 'connected' ? (
                <button
                  type="button"
                  onClick={() => {
                    void handleSync()
                  }}
                  disabled={syncing || disconnecting}
                  className="app-button-secondary min-h-11 rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {syncing ? 'Синхронизируем...' : 'Синхронизировать сейчас'}
                </button>
              ) : null}

              {connectionState !== 'disconnected' ? (
                <button
                  type="button"
                  onClick={() => {
                    void handleDisconnect()
                  }}
                  disabled={disconnecting || syncing}
                  className="min-h-11 rounded-lg border border-red-500/20 px-4 py-2 text-sm font-medium text-red-600 transition-colors disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/25"
                >
                  {disconnecting ? 'Отключаем...' : 'Отключить Strava'}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
