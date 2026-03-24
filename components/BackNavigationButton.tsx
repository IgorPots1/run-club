'use client'

import { ChevronLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

type BackNavigationButtonProps = {
  fallbackHref?: string
  className?: string
  label?: string
  variant?: 'inline' | 'icon'
}

export default function BackNavigationButton({
  fallbackHref = '/dashboard',
  className = '',
  label = 'Назад',
  variant = 'inline',
}: BackNavigationButtonProps) {
  const router = useRouter()

  function handleBackNavigation() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }

    router.push(fallbackHref)
  }

  const baseClassName =
    variant === 'icon'
      ? 'app-text-primary inline-flex h-11 w-11 items-center justify-center self-center rounded-full border border-black/5 bg-[color:var(--surface)]/96 shadow-sm dark:border-white/10'
      : 'app-text-secondary inline-flex min-h-11 items-center gap-1 rounded-xl px-2 py-2 text-sm font-medium'

  return (
    <button
      type="button"
      onClick={handleBackNavigation}
      className={`${baseClassName} ${className}`.trim()}
      aria-label={label}
    >
      <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden="true" />
      {variant === 'inline' ? <span>{label}</span> : null}
    </button>
  )
}
