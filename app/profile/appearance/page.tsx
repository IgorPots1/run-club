'use client'

import { useState } from 'react'

import InnerPageHeader from '@/components/InnerPageHeader'
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from '@/lib/theme-client'

const themeOptions: Array<{
  value: ThemePreference
  title: string
  description: string
}> = [
  {
    value: 'light',
    title: 'Light',
    description: 'Всегда использовать светлую тему.',
  },
  {
    value: 'dark',
    title: 'Dark',
    description: 'Всегда использовать тёмную тему.',
  },
  {
    value: 'system',
    title: 'System',
    description: 'Следовать настройке устройства.',
  },
]

export default function AppearancePage() {
  const [themePreference, setPreference] = useState<ThemePreference>(() => getThemePreference())

  return (
    <main className="min-h-screen">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30">
        <div className="pointer-events-auto mx-auto max-w-xl px-4 md:px-4">
          <InnerPageHeader title="Тема" fallbackHref="/profile" />
        </div>
      </div>
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <div aria-hidden="true" className="invisible">
          <InnerPageHeader title="Тема" fallbackHref="/profile" />
        </div>
        <div className="mt-4">
          <h1 className="app-text-primary mb-2 text-2xl font-bold">Тема</h1>
          <p className="app-text-secondary mb-4 text-sm">
            Выберите, как приложение должно выглядеть на этом устройстве.
          </p>

          <section className="app-card overflow-hidden rounded-2xl border shadow-sm">
            <div className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
              {themeOptions.map((option) => {
                const checked = themePreference === option.value

                return (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 active:bg-black/[0.03] dark:active:bg-white/[0.04]"
                  >
                    <div className="min-w-0">
                      <p className="app-text-primary text-sm font-medium">{option.title}</p>
                      <p className="app-text-secondary mt-1 text-xs">{option.description}</p>
                    </div>
                    <input
                      type="radio"
                      name="theme-preference"
                      value={option.value}
                      checked={checked}
                      onChange={() => {
                        setPreference(option.value)
                        setThemePreference(option.value)
                      }}
                      className="h-4 w-4 shrink-0"
                    />
                  </label>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
