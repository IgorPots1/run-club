import BackNavigationButton from '@/components/BackNavigationButton'
import type { ReactNode } from 'react'

type MobileBackHeaderProps = {
  title: string
  fallbackHref?: string
  className?: string
  sticky?: boolean
  fullBleedOnMobile?: boolean
  minimal?: boolean
  rightSlot?: ReactNode
}

export default function MobileBackHeader({
  title,
  fallbackHref = '/dashboard',
  className = '',
  sticky = true,
  fullBleedOnMobile = true,
  minimal = false,
  rightSlot = null,
}: MobileBackHeaderProps) {
  const headerSurfaceClassName = minimal
    ? 'mb-0 bg-transparent pb-1 pt-[calc(env(safe-area-inset-top)+0.25rem)] shadow-none'
    : 'mb-4 border-b border-black/5 bg-[color:var(--background)]/98 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-[0_1px_0_rgba(17,24,39,0.04)] dark:border-white/10 dark:shadow-[0_1px_0_rgba(255,255,255,0.03)]'
  const desktopClassName = minimal
    ? 'md:mb-1 md:pt-1'
    : 'md:mb-6 md:rounded-2xl md:border md:pt-3'
  const layoutClassName = [
    sticky ? 'sticky top-0 z-30' : 'shrink-0',
    fullBleedOnMobile ? '-mx-4 px-4 md:mx-0 md:px-4' : 'px-4 md:px-4',
    headerSurfaceClassName,
    sticky && !minimal ? 'backdrop-blur' : '',
    desktopClassName,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <header className={layoutClassName}>
      <div className="relative flex min-h-12 items-center gap-3">
        <BackNavigationButton fallbackHref={fallbackHref} variant="icon" />
        <div className="pointer-events-none absolute inset-x-0 flex justify-center px-[5.5rem]">
          <div className="min-w-0">
            <h1 className="app-text-primary truncate text-center text-base font-semibold">
              {title}
            </h1>
          </div>
        </div>
        {rightSlot ? (
          <div className="ml-auto flex min-w-[2.75rem] items-center justify-end">
            {rightSlot}
          </div>
        ) : (
          <div className="ml-auto h-11 w-11 shrink-0" aria-hidden="true" />
        )}
      </div>
    </header>
  )
}
