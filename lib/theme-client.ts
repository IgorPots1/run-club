export type ThemePreference = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'theme'
export const THEME_PREFERENCE_CHANGE_EVENT = 'theme-preference-change'

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function getThemePreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'system'
  }

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)

    if (isThemePreference(storedTheme)) {
      return storedTheme
    }
  } catch {}

  return 'system'
}

export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'light' || pref === 'dark') {
    return pref
  }

  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark'
  }

  return 'light'
}

export function applyTheme(pref: ThemePreference) {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.classList.toggle('dark', resolveTheme(pref) === 'dark')
}

export function setThemePreference(pref: ThemePreference) {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, pref)
    } catch {}

    window.dispatchEvent(new Event(THEME_PREFERENCE_CHANGE_EVENT))
  }

  applyTheme(pref)
}
