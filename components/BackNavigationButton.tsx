'use client'

import { useRouter } from 'next/navigation'

type BackNavigationButtonProps = {
  fallbackHref?: string
  className?: string
}

export default function BackNavigationButton({
  fallbackHref = '/dashboard',
  className = '',
}: BackNavigationButtonProps) {
  const router = useRouter()

  function handleBackNavigation() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }

    router.push(fallbackHref)
  }

  return (
    <button
      type="button"
      onClick={handleBackNavigation}
      className={`app-text-secondary inline-flex items-center text-sm font-medium ${className}`.trim()}
      aria-label="Назад"
    >
      ← Назад
    </button>
  )
}
