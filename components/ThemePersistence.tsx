'use client'

import { useEffect } from 'react'

const THEME_STORAGE_KEY = 'theme'

type Theme = 'dark' | 'light'

function resolveTheme(): Theme {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (storedTheme === 'dark' || storedTheme === 'light') {
      return storedTheme
    }
  } catch {}

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

function persistTheme(theme: Theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {}
}

export default function ThemePersistence() {
  useEffect(() => {
    const syncTheme = () => {
      const nextTheme = resolveTheme()
      applyTheme(nextTheme)
      persistTheme(nextTheme)
    }

    const persistCurrentTheme = () => {
      persistTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncTheme()
      }
    }

    syncTheme()

    const observer = new MutationObserver(() => {
      persistCurrentTheme()
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    window.addEventListener('pageshow', syncTheme)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      observer.disconnect()
      window.removeEventListener('pageshow', syncTheme)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return null
}
