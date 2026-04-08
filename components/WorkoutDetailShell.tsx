import type { ReactNode, Ref } from 'react'
import InnerPageHeader from '@/components/InnerPageHeader'

type WorkoutDetailShellProps = {
  title: string
  fallbackHref?: string
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
  headerRightSlot,
  topContent,
  footer,
  children,
  scrollContainerRef,
  scrollContentClassName = '',
}: WorkoutDetailShellProps) {
  const mobileShellHeightClassName =
    'h-[calc(100dvh-(5.75rem+env(safe-area-inset-bottom)))] min-h-[calc(100dvh-(5.75rem+env(safe-area-inset-bottom)))]'
  const scrollLayoutClassName = [
    'min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 [overscroll-behavior-y:contain]',
    footer ? 'pb-5 pt-3' : 'pb-[calc(7rem+env(safe-area-inset-bottom))] pt-5',
    'md:overflow-visible md:px-4 md:pb-5 md:pt-5',
    scrollContentClassName,
  ]
    .filter(Boolean)
    .join(' ')
  const footerWrapperClassName = [
    'shrink-0 px-4 pt-1',
    'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
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
      className={`flex ${mobileShellHeightClassName} min-w-0 flex-col overflow-x-hidden overflow-y-hidden bg-[color:var(--background)] md:h-auto md:min-h-screen md:overflow-visible`}
    >
      <div className="mx-auto flex h-full min-h-0 min-w-0 w-full max-w-xl flex-col overflow-x-hidden md:h-auto md:min-h-screen md:overflow-visible">
        <InnerPageHeader title={title} fallbackHref={fallbackHref} rightSlot={headerRightSlot} />
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
