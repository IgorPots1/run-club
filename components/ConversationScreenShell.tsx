'use client'

import type { ReactNode, Ref } from 'react'
import InnerPageHeader from '@/components/InnerPageHeader'
import { useIsolatedViewportHeight } from '@/components/useIsolatedViewportHeight'

type ConversationScreenShellProps = {
  title: string
  fallbackHref?: string
  rightSlot?: ReactNode
  headerBottom?: ReactNode
  footer?: ReactNode
  children: ReactNode
  scrollContainerRef?: Ref<HTMLDivElement>
  scrollContainerClassName?: string
  contentClassName?: string
}

export default function ConversationScreenShell({
  title,
  fallbackHref,
  rightSlot,
  headerBottom,
  footer,
  children,
  scrollContainerRef,
  scrollContainerClassName = '',
  contentClassName = '',
}: ConversationScreenShellProps) {
  const { isKeyboardOpen, isolatedViewportStyle } = useIsolatedViewportHeight()
  const resolvedScrollContainerClassName = [
    'flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable] [WebkitOverflowScrolling:touch] [overscroll-behavior-y:contain]',
    scrollContainerClassName,
  ]
    .filter(Boolean)
    .join(' ')
  const resolvedContentClassName = ['flex min-h-full flex-col gap-3 px-4 pb-4 pt-3', contentClassName]
    .filter(Boolean)
    .join(' ')
  const footerWrapperClassName = [
    'shrink-0 pt-1',
    isKeyboardOpen ? 'pb-0' : 'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
  ]
    .filter(Boolean)
    .join(' ')
  const footerSurfaceClassName = [
    'relative z-10 rounded-[24px] border border-black/[0.06] bg-[color:var(--background)]/90 px-2.5 py-1.5 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-[color:var(--background)]/86',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <main
      data-chat-isolated-route="true"
      className="relative flex flex-col overflow-hidden bg-[color:var(--background)]"
      style={isolatedViewportStyle}
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
        <InnerPageHeader title={title} fallbackHref={fallbackHref} minimal rightSlot={rightSlot} />
        {headerBottom ? <div className="shrink-0 px-4 pb-2">{headerBottom}</div> : null}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollContainerRef}
            data-chat-scroll-container="true"
            className={resolvedScrollContainerClassName}
          >
            <div className={resolvedContentClassName}>{children}</div>
          </div>
          {footer ? (
            <div
              data-keyboard-open={isKeyboardOpen ? 'true' : 'false'}
              className={footerWrapperClassName}
            >
              <div className={footerSurfaceClassName}>{footer}</div>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  )
}
