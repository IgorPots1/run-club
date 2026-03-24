import BackNavigationButton from '@/components/BackNavigationButton'

type MobileBackHeaderProps = {
  title: string
  fallbackHref?: string
  className?: string
}

export default function MobileBackHeader({
  title,
  fallbackHref = '/dashboard',
  className = '',
}: MobileBackHeaderProps) {
  return (
    <header
      className={`sticky top-0 z-30 -mx-4 mb-4 border-b border-black/5 bg-[color:var(--background)]/95 px-4 pb-3 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur dark:border-white/10 md:mx-0 md:mb-6 md:rounded-2xl md:border md:px-4 md:pt-3 ${className}`.trim()}
    >
      <div className="grid min-h-11 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-3">
        <BackNavigationButton fallbackHref={fallbackHref} variant="icon" />
        <h1 className="app-text-primary truncate text-center text-base font-semibold">
          {title}
        </h1>
        <div className="h-11 w-11" aria-hidden="true" />
      </div>
    </header>
  )
}
