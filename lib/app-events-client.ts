export const INBOX_UNREAD_UPDATED_EVENT = 'inbox_unread_updated'
export const INBOX_UNREAD_UPDATED_STORAGE_KEY = 'inbox_unread_updated_at'

export function dispatchInboxUnreadUpdated() {
  if (typeof window === 'undefined') {
    return
  }

  localStorage.setItem(INBOX_UNREAD_UPDATED_STORAGE_KEY, String(Date.now()))
  window.dispatchEvent(new Event(INBOX_UNREAD_UPDATED_EVENT))
}

export async function loadInboxUnreadCount(): Promise<number | null> {
  try {
    const response = await fetch('/api/activity/inbox/unread-count', {
      credentials: 'include',
    })
    const payload = await response.json().catch(() => null) as { count?: unknown } | null

    if (response.ok) {
      const count = Number(payload?.count ?? 0)
      return Number.isFinite(count) ? Math.max(0, count) : null
    }
  } catch (error) {
    console.error('[activity inbox] failed to load unread count', error)
  }

  return null
}
