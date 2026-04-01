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
    'min-h-0 flex-1 overflow-y-auto [WebkitOverflowScrolling:touch] [overscroll-behavior-y:contain]',
    scrollContainerClassName,
  ]
    .filter(Boolean)
    .join(' ')
  const resolvedContentClassName = ['flex min-h-full flex-col gap-3 px-4 pb-4 pt-3', contentClassName]
    .filter(Boolean)
    .join(' ')
  const footerClassName = [
    'shrink-0 border-t border-black/5 bg-[var(--surface)] px-4 pt-3 dark:border-white/10',
    isKeyboardOpen ? 'pb-0' : 'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <main
      data-chat-isolated-route="true"
      className="flex flex-col overflow-hidden bg-[color:var(--background)]"
      style={isolatedViewportStyle}
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
        <InnerPageHeader title={title} fallbackHref={fallbackHref} minimal rightSlot={rightSlot} />
        {headerBottom ? <div className="shrink-0 px-4 pb-2">{headerBottom}</div> : null}
        <div ref={scrollContainerRef} className={resolvedScrollContainerClassName}>
          <div className={resolvedContentClassName}>{children}</div>
        </div>
        {footer ? <div className={footerClassName}>{footer}</div> : null}
      </div>
    </main>
  )
}
