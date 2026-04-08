'use client'

export const RUN_DETAIL_LAST_SOURCE_STORAGE_KEY = 'run-detail:last-source'

type RunDetailSourceSnapshot = {
  href: string
  scrollRestorationKey?: string
  savedAt: number
}

function isRelativeAppHref(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
}

export function getCurrentAppHref() {
  if (typeof window === 'undefined') {
    return '/'
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

export function saveRunDetailSource(input: {
  href: string
  scrollRestorationKey?: string
}) {
  if (typeof window === 'undefined' || !isRelativeAppHref(input.href)) {
    return
  }

  const snapshot: RunDetailSourceSnapshot = {
    href: input.href,
    scrollRestorationKey: input.scrollRestorationKey,
    savedAt: Date.now(),
  }

  window.sessionStorage.setItem(RUN_DETAIL_LAST_SOURCE_STORAGE_KEY, JSON.stringify(snapshot))
}

export function readRunDetailSource() {
  if (typeof window === 'undefined') {
    return null
  }

  const rawValue = window.sessionStorage.getItem(RUN_DETAIL_LAST_SOURCE_STORAGE_KEY)

  if (!rawValue) {
    return null
  }

  try {
    const parsedValue = JSON.parse(rawValue) as Partial<RunDetailSourceSnapshot>

    if (!isRelativeAppHref(parsedValue.href)) {
      return null
    }

    return {
      href: parsedValue.href,
      scrollRestorationKey: typeof parsedValue.scrollRestorationKey === 'string'
        ? parsedValue.scrollRestorationKey
        : undefined,
      savedAt: Number.isFinite(parsedValue.savedAt) ? Number(parsedValue.savedAt) : 0,
    }
  } catch {
    return null
  }
}
