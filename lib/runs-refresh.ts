export const RUNS_UPDATED_EVENT = 'runs_updated'
export const RUNS_UPDATED_STORAGE_KEY = 'runs_updated_at'

export function dispatchRunsUpdatedEvent() {
  if (typeof window === 'undefined') {
    return
  }

  localStorage.setItem(RUNS_UPDATED_STORAGE_KEY, String(Date.now()))
  window.dispatchEvent(new Event(RUNS_UPDATED_EVENT))
}
