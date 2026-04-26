export const RUNS_UPDATED_EVENT = 'runs_updated'
export const RUNS_UPDATED_STORAGE_KEY = 'runs_updated_at'

export function readRunsUpdatedAt() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawValue = window.localStorage.getItem(RUNS_UPDATED_STORAGE_KEY)

    if (!rawValue) {
      return null
    }

    const parsedValue = Number(rawValue)
    return Number.isFinite(parsedValue) ? parsedValue : null
  } catch {
    return null
  }
}

export function dispatchRunsUpdatedEvent() {
  if (typeof window === 'undefined') {
    return
  }

  localStorage.setItem(RUNS_UPDATED_STORAGE_KEY, String(Date.now()))
  window.dispatchEvent(new Event(RUNS_UPDATED_EVENT))
}
