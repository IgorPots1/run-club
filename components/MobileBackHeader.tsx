import BackNavigationButton from '@/components/BackNavigationButton'
import type { ReactNode } from 'react'

type MobileBackHeaderProps = {
  title: string
  fallbackHref?: string
  enableSourceRestore?: boolean
  className?: string
  sticky?: boolean
  fullBleedOnMobile?: boolean
  minimal?: boolean
  rightSlot?: ReactNode
}

export default function MobileBackHeader({
  title,
  fallbackHref = '/dashboard',
  enableSourceRestore = false,
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
    fullBleedOnMobile
      ? '-mx-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:mx-0 md:px-4'
      : 'pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:px-4',
    headerSurfaceClassName,
    sticky && !minimal ? 'backdrop-blur' : '',
    desktopClassName,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <header className={layoutClassName}>
      <div className="grid min-h-12 grid-cols-[5rem_minmax(0,1fr)_5rem] items-center gap-2 sm:grid-cols-[5.5rem_minmax(0,1fr)_5.5rem]">
        <div className="flex items-center justify-start">
          <BackNavigationButton
            fallbackHref={fallbackHref}
            enableSourceRestore={enableSourceRestore}
            variant="icon"
          />
        </div>
        <div className="min-w-0">
          <h1 className="app-text-primary truncate text-center text-base font-semibold">
            {title}
          </h1>
        </div>
        {rightSlot ? (
          <div className="flex min-w-0 items-center justify-end overflow-hidden">
            {rightSlot}
          </div>
        ) : (
          <div className="h-11" aria-hidden="true" />
        )}
      </div>
    </header>
  )
}
