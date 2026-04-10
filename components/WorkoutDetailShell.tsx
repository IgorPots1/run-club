import type { ReactNode, Ref } from 'react'
import InnerPageHeader from '@/components/InnerPageHeader'

type WorkoutDetailShellProps = {
  title: string
  fallbackHref?: string
  enableSourceRestore?: boolean
  headerRightSlot?: ReactNode
  topContent?: ReactNode
  footer?: ReactNode
  children: ReactNode
  scrollContainerRef?: Ref<HTMLDivElement>
  scrollContentClassName?: string
}

export default function WorkoutDetailShell({
  title,
  fallbackHref,
  enableSourceRestore = false,
  headerRightSlot,
  topContent,
  footer,
  children,
  scrollContainerRef,
  scrollContentClassName = '',
}: WorkoutDetailShellProps) {
  const scrollLayoutClassName = [
    'min-w-0 overflow-x-hidden px-4',
    footer ? 'pb-5 pt-3' : 'pb-[calc(7rem+env(safe-area-inset-bottom))] pt-5',
    scrollContentClassName,
  ]
    .filter(Boolean)
    .join(' ')
  const footerWrapperClassName = [
    'shrink-0 px-4 pt-1',
    'pb-[calc(5.75rem+max(0.75rem,env(safe-area-inset-bottom)))]',
    'md:px-4 md:pb-5',
  ]
    .filter(Boolean)
    .join(' ')
  const footerSurfaceClassName = [
    'relative z-10 rounded-[24px] border border-black/[0.06] bg-[color:var(--background)]/90 px-3 py-2 shadow-sm backdrop-blur-sm',
    'dark:border-white/10 dark:bg-[color:var(--background)]/86',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <main
      className="min-h-[100svh] min-w-0 bg-[color:var(--background)] md:min-h-screen"
    >
      <div className="mx-auto flex min-h-[100svh] min-w-0 w-full max-w-xl flex-col overflow-x-hidden md:min-h-screen">
        <InnerPageHeader
          title={title}
          fallbackHref={fallbackHref}
          enableSourceRestore={enableSourceRestore}
          rightSlot={headerRightSlot}
        />
        {topContent ? (
          <div className="min-w-0 shrink-0 px-4 pb-3 pt-3 md:pt-4">
            {topContent}
          </div>
        ) : null}
        <div ref={scrollContainerRef} className={scrollLayoutClassName}>
          {children}
        </div>
        {footer ? (
          <div className={footerWrapperClassName}>
            <div className={footerSurfaceClassName}>{footer}</div>
          </div>
        ) : null}
      </div>
    </main>
  )
}
