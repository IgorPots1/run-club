'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import InnerPageHeader from '@/components/InnerPageHeader'
import { getBootstrapUser } from '@/lib/auth'
import {
  loadPushPreferences,
  updatePushPreferences,
} from '@/lib/notifications/settingsClient'
import type {
  PushPreferenceKey,
  PushPreferences,
} from '@/lib/notifications/preferences'
import {
  getPushSubscriptionState,
  subscribeToPush,
  unsubscribeFromPush,
} from '@/lib/push/subscribeToPush'

const notificationPreferenceItems: Array<{
  key: PushPreferenceKey
  title: string
  description: string
}> = [
  {
    key: 'push_enabled',
    title: 'Все push-уведомления',
    description: 'Главный переключатель доставки уведомлений на аккаунт.',
  },
  {
    key: 'chat_enabled',
    title: 'Сообщения в чатах',
    description: 'Обычные уведомления о новых сообщениях.',
  },
  {
    key: 'chat_important_enabled',
    title: 'Важные сообщения',
    description: 'Отдельно сохраняет уведомления для важных сообщений.',
  },
  {
    key: 'run_like_enabled',
    title: 'Лайки пробежек',
    description: 'Когда вашу пробежку кто-то отметил.',
  },
  {
    key: 'run_comment_enabled',
    title: 'Комментарии к пробежкам',
    description: 'Когда под вашей пробежкой появляется комментарий.',
  },
  {
    key: 'challenge_completed_enabled',
    title: 'Завершение челленджей',
    description: 'Когда вы завершаете челлендж и получаете результат.',
  },
]

function SettingsSwitch({
  checked,
  disabled = false,
  label,
  onCheckedChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className={`relative inline-flex shrink-0 items-center ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
        disabled={disabled}
        aria-label={label}
        role="switch"
      />
      <span className="h-7 w-12 rounded-full bg-[var(--surface-interactive)] transition-colors duration-200 peer-checked:bg-[var(--accent-strong)] peer-disabled:bg-[var(--surface-interactive)]" />
      <span className="pointer-events-none absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 peer-checked:translate-x-5" />
    </label>
  )
}

function getPushActionErrorMessage(error: unknown) {
  const errorCode = error instanceof Error ? error.message : ''

  switch (errorCode) {
    case 'push_not_supported':
    case 'notifications_not_supported':
    case 'service_worker_not_supported':
      return 'Push-уведомления недоступны на этом устройстве.'
    case 'notification_permission_denied':
      return 'Разрешение на уведомления заблокировано в браузере.'
    case 'notification_permission_not_granted':
      return 'Разрешите уведомления в браузере, чтобы включить push.'
    case 'missing_vapid_public_key':
      return 'Push-уведомления временно недоступны. Попробуйте позже.'
    default:
      return 'Не удалось обновить push-уведомления.'
  }
}

function getDeviceStatusDescription({
  pushStatusLoading,
  notificationsSupported,
  isNotificationsEnabled,
  notificationPermission,
}: {
  pushStatusLoading: boolean
  notificationsSupported: boolean
  isNotificationsEnabled: boolean
  notificationPermission: NotificationPermission
}) {
  if (pushStatusLoading) {
    return 'Проверяем поддержку и статус push-уведомлений...'
  }

  if (!notificationsSupported) {
    return 'На этом устройстве push-уведомления недоступны.'
  }

  if (isNotificationsEnabled) {
    return 'Push-уведомления включены в браузере на этом устройстве.'
  }

  if (notificationPermission === 'denied') {
    return 'Браузер заблокировал разрешение на уведомления.'
  }

  return 'Push-уведомления сейчас выключены на этом устройстве.'
}

export default function NotificationsPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [pushStatusLoading, setPushStatusLoading] = useState(true)
  const [preferencesLoading, setPreferencesLoading] = useState(true)
  const [pushActionLoading, setPushActionLoading] = useState(false)
  const [savingPreferenceKey, setSavingPreferenceKey] = useState<PushPreferenceKey | null>(null)
  const [notificationsSupported, setNotificationsSupported] = useState(false)
  const [isNotificationsEnabled, setNotificationsEnabled] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default')
  const [preferences, setPreferences] = useState<PushPreferences | null>(null)
  const [pageError, setPageError] = useState('')

  const loadPushStatus = useCallback(async (shouldUpdate: () => boolean = () => true) => {
    setPushStatusLoading(true)

    try {
      const nextPushState = await getPushSubscriptionState()

      if (!shouldUpdate()) return

      setNotificationsSupported(nextPushState.supported)
      setNotificationsEnabled(nextPushState.subscribed)
      setNotificationPermission(
        typeof window !== 'undefined' && 'Notification' in window
          ? Notification.permission
          : 'default'
      )
    } catch {
      if (!shouldUpdate()) return

      setNotificationsSupported(false)
      setNotificationsEnabled(false)
      setNotificationPermission(
        typeof window !== 'undefined' && 'Notification' in window
          ? Notification.permission
          : 'default'
      )
      setPageError('Не удалось загрузить статус push-уведомлений')
    } finally {
      if (shouldUpdate()) {
        setPushStatusLoading(false)
      }
    }
  }, [])

  const loadNotificationPreferences = useCallback(async (shouldUpdate: () => boolean = () => true) => {
    setPreferencesLoading(true)

    try {
      const nextPreferences = await loadPushPreferences()

      if (!shouldUpdate()) return

      setPreferences(nextPreferences)
    } catch {
      if (!shouldUpdate()) return
      setPageError('Не удалось загрузить настройки уведомлений')
    } finally {
      if (shouldUpdate()) {
        setPreferencesLoading(false)
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

    void Promise.all([
      loadPushStatus(shouldUpdate),
      loadNotificationPreferences(shouldUpdate),
    ])

    return () => {
      isMounted = false
    }
  }, [loadNotificationPreferences, loadPushStatus, user])

  async function handleDevicePushToggle() {
    if (pushActionLoading) {
      return
    }

    setPageError('')
    setPushActionLoading(true)

    try {
      if (isNotificationsEnabled) {
        await unsubscribeFromPush()
      } else {
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
          const permission = await Notification.requestPermission()

          if (permission !== 'granted') {
            throw new Error(
              permission === 'denied'
                ? 'notification_permission_denied'
                : 'notification_permission_not_granted'
            )
          }
        }

        await subscribeToPush()
      }

      await loadPushStatus()
    } catch (error) {
      setPageError(getPushActionErrorMessage(error))
    } finally {
      setPushActionLoading(false)
    }
  }

  async function handlePreferenceToggle(key: PushPreferenceKey, checked: boolean) {
    if (!preferences || savingPreferenceKey) {
      return
    }

    setPageError('')
    setSavingPreferenceKey(key)

    try {
      const updatedPreferences = await updatePushPreferences({
        [key]: checked,
      } as Pick<PushPreferences, typeof key>)

      setPreferences(updatedPreferences)
    } catch {
      setPageError('Не удалось обновить настройки уведомлений')
    } finally {
      setSavingPreferenceKey(null)
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

  const deviceStatusDescription = getDeviceStatusDescription({
    pushStatusLoading,
    notificationsSupported,
    isNotificationsEnabled,
    notificationPermission,
  })
  const deviceActionLabel = pushActionLoading
    ? isNotificationsEnabled
      ? 'Отключаем...'
      : 'Включаем...'
    : isNotificationsEnabled
      ? 'Отключить push'
      : 'Включить push'
  const showDeviceAction = notificationsSupported
  const preferencesBusy = preferencesLoading || savingPreferenceKey !== null

  if (pushStatusLoading && preferencesLoading && !preferences) {
    return (
      <main className="min-h-screen">
        <div className="pointer-events-none fixed inset-x-0 top-0 z-30">
          <div className="pointer-events-auto mx-auto max-w-xl px-4 md:px-4">
            <InnerPageHeader title="Уведомления" fallbackHref="/profile" />
          </div>
        </div>
        <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
          <div aria-hidden="true" className="invisible">
            <InnerPageHeader title="Уведомления" fallbackHref="/profile" />
          </div>
          <div className="mt-4">
            <h1 className="app-text-primary mb-4 text-2xl font-bold">Уведомления</h1>
            <div className="app-card mb-4 space-y-3 rounded-2xl border p-4 shadow-sm">
              <div className="skeleton-line h-6 w-40" />
              <div className="skeleton-line h-4 w-full" />
              <div className="skeleton-line h-11 w-36" />
            </div>
            <div className="app-card space-y-4 rounded-2xl border p-4 shadow-sm">
              <div className="skeleton-line h-6 w-36" />
              <div className="skeleton-line h-16 w-full" />
              <div className="skeleton-line h-16 w-full" />
              <div className="skeleton-line h-16 w-full" />
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
          <InnerPageHeader title="Уведомления" fallbackHref="/profile" />
        </div>
      </div>
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <div aria-hidden="true" className="invisible">
          <InnerPageHeader title="Уведомления" fallbackHref="/profile" />
        </div>
        <div className="mt-4">
          <h1 className="app-text-primary mb-2 text-2xl font-bold">Уведомления</h1>
          <p className="app-text-secondary mb-4 text-sm">
            Управляйте push-уведомлениями на этом устройстве и настройками доставки для аккаунта.
          </p>
          {pageError ? <p className="mb-4 text-sm text-red-600">{pageError}</p> : null}

          <section className="app-card mb-4 rounded-2xl border p-4 shadow-sm">
            <div className="mb-3">
              <h2 className="app-text-primary text-lg font-semibold">Устройство и браузер</h2>
              <p className="app-text-secondary mt-1 text-sm">{deviceStatusDescription}</p>
            </div>
            {showDeviceAction ? (
              <button
                type="button"
                onClick={() => {
                  void handleDevicePushToggle()
                }}
                disabled={pushActionLoading || pushStatusLoading}
                className="app-button-secondary min-h-11 rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deviceActionLabel}
              </button>
            ) : (
              <p className="app-text-secondary text-sm">
                Откройте приложение на устройстве с поддержкой push, чтобы включить уведомления.
              </p>
            )}
          </section>

          <section className="app-card rounded-2xl border p-4 shadow-sm">
            <div className="mb-3">
              <h2 className="app-text-primary text-lg font-semibold">Что присылать</h2>
              <p className="app-text-secondary mt-1 text-sm">
                Эти настройки сохраняются для аккаунта и влияют на доставку уведомлений.
              </p>
            </div>

            {preferences ? (
              <div className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
                {notificationPreferenceItems.map((item) => {
                  const isSavingCurrentItem = savingPreferenceKey === item.key

                  return (
                    <div key={item.key} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="app-text-primary text-sm font-medium">{item.title}</p>
                        <p className="app-text-secondary mt-1 text-xs">
                          {isSavingCurrentItem ? 'Сохраняем...' : item.description}
                        </p>
                      </div>
                      <SettingsSwitch
                        checked={preferences[item.key]}
                        disabled={preferencesBusy}
                        label={item.title}
                        onCheckedChange={(checked) => {
                          void handlePreferenceToggle(item.key, checked)
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="app-text-secondary text-sm">Настройки уведомлений пока недоступны.</p>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
