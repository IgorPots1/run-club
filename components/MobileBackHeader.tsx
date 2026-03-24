import BackNavigationButton from '@/components/BackNavigationButton'

type MobileBackHeaderProps = {
  title: string
  fallbackHref?: string
  className?: string
  sticky?: boolean
  fullBleedOnMobile?: boolean
}

export default function MobileBackHeader({
  title,
  fallbackHref = '/dashboard',
  className = '',
  sticky = true,
  fullBleedOnMobile = true,
}: MobileBackHeaderProps) {
  const layoutClassName = [
    sticky ? 'sticky top-0 z-30' : 'shrink-0',
    fullBleedOnMobile ? '-mx-4 px-4 md:mx-0 md:px-4' : 'px-4 md:px-4',
    'mb-4 border-b border-black/5 bg-[color:var(--background)]/95 pb-3 pt-[max(0.5rem,env(safe-area-inset-top))] dark:border-white/10',
    sticky ? 'backdrop-blur' : '',
    'md:mb-6 md:rounded-2xl md:border md:pt-3',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <header className={layoutClassName}>
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
