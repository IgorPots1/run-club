import type { ReactNode, Ref } from 'react'
import MobileBackHeader from '@/components/MobileBackHeader'

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
  const scrollLayoutClassName = [
    'min-h-0 flex-1 overflow-y-auto px-4 [overscroll-behavior-y:contain]',
    footer ? 'pb-4 pt-2' : 'pb-[calc(96px+env(safe-area-inset-bottom))] pt-4',
    'md:overflow-visible md:px-4 md:pb-4 md:pt-4',
    scrollContentClassName,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <main className="flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden md:h-auto md:min-h-screen md:overflow-visible">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-xl flex-col md:h-auto md:min-h-screen">
        <MobileBackHeader
          title={title}
          fallbackHref={fallbackHref}
          sticky={false}
          fullBleedOnMobile={false}
          className="mb-0 md:mt-4"
        />
        {topContent ? (
          <div className="shrink-0 px-4 pb-3 pt-4">
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
