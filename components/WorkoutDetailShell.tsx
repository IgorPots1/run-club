import type { ReactNode, Ref } from 'react'
import InnerPageHeader from '@/components/InnerPageHeader'

type WorkoutDetailShellProps = {
  title: string
  fallbackHref?: string
  topContent?: ReactNode
  footer?: ReactNode
  children: ReactNode
  scrollContainerRef?: Ref<HTMLDivElement>
  scrollContentClassName?: string
}

export default function WorkoutDetailShell({
  title,
  fallbackHref,
  topContent,
  footer,
  children,
  scrollContainerRef,
  scrollContentClassName = '',
}: WorkoutDetailShellProps) {
  const mobileShellHeightClassName =
    'h-[calc(100dvh-(5.75rem+env(safe-area-inset-bottom)))] min-h-[calc(100dvh-(5.75rem+env(safe-area-inset-bottom)))]'
  const scrollLayoutClassName = [
    'min-h-0 flex-1 overflow-y-auto px-4 [overscroll-behavior-y:contain]',
    footer ? 'pb-5 pt-3' : 'pb-[calc(7rem+env(safe-area-inset-bottom))] pt-5',
    'md:overflow-visible md:px-4 md:pb-5 md:pt-5',
    scrollContentClassName,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <main
      className={`flex ${mobileShellHeightClassName} flex-col overflow-hidden bg-[color:var(--background)] md:h-auto md:min-h-screen md:overflow-visible`}
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-xl flex-col md:h-auto md:min-h-screen">
        <InnerPageHeader title={title} fallbackHref={fallbackHref} />
        {topContent ? (
          <div className="shrink-0 px-4 pb-3 pt-3 md:pt-4">
            {topContent}
          </div>
        ) : null}
        <div ref={scrollContainerRef} className={scrollLayoutClassName}>
          {children}
        </div>
        {footer}
      </div>
    </main>
  )
}
