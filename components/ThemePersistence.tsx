'use client'

import { useEffect, useState } from 'react'

import {
  applyTheme,
  getThemePreference,
  THEME_PREFERENCE_CHANGE_EVENT,
  type ThemePreference,
} from '@/lib/theme-client'

export default function ThemePersistence() {
  const [themePreference, setThemePreference] = useState<ThemePreference>('system')

  useEffect(() => {
    const syncTheme = () => {
      const nextPreference = getThemePreference()
      setThemePreference(nextPreference)
      applyTheme(nextPreference)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncTheme()
      }
    }

    syncTheme()

    window.addEventListener('pageshow', syncTheme)
    window.addEventListener('focus', syncTheme)
    window.addEventListener(THEME_PREFERENCE_CHANGE_EVENT, syncTheme)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('pageshow', syncTheme)
      window.removeEventListener('focus', syncTheme)
      window.removeEventListener(THEME_PREFERENCE_CHANGE_EVENT, syncTheme)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (themePreference !== 'system' || typeof window === 'undefined') {
      return
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemThemeChange = () => {
      applyTheme(getThemePreference())
    }

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleSystemThemeChange)
    } else {
      mediaQuery.addListener(handleSystemThemeChange)
    }

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleSystemThemeChange)
      } else {
        mediaQuery.removeListener(handleSystemThemeChange)
      }
    }
  }, [themePreference])

  return null
}
