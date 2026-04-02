'use client'

import { useLayoutEffect, useMemo, useState } from 'react'

const ISOLATED_VIEWPORT_HEIGHT_CSS_VAR = '--chat-app-height'
const DEFAULT_ISOLATED_VIEWPORT_HEIGHT = '100svh'

export function useIsolatedViewportHeight() {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)
  const isolatedViewportStyle = useMemo(
    () => ({
      height: `var(${ISOLATED_VIEWPORT_HEIGHT_CSS_VAR}, ${DEFAULT_ISOLATED_VIEWPORT_HEIGHT})`,
      minHeight: `var(${ISOLATED_VIEWPORT_HEIGHT_CSS_VAR}, ${DEFAULT_ISOLATED_VIEWPORT_HEIGHT})`,
    }),
    []
  )

  useLayoutEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    document.documentElement.dataset.chatIsolatedRoute = 'true'
    document.body.dataset.chatIsolatedRoute = 'true'

    return () => {
      delete document.documentElement.dataset.chatIsolatedRoute
      delete document.body.dataset.chatIsolatedRoute
    }
  }, [])

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }

    const rootStyle = document.documentElement.style
    let frameId: number | null = null
    let nestedFrameId: number | null = null
    let timeoutId: number | null = null

    function applyViewportHeight() {
      const visualViewport = window.visualViewport
      const viewportHeight = visualViewport?.height ?? window.innerHeight
      const viewportOffsetTop = visualViewport?.offsetTop ?? 0
      const isMobileViewport = window.innerWidth < 768
      const effectiveViewportHeight = Math.round(viewportHeight + viewportOffsetTop)

      rootStyle.setProperty(ISOLATED_VIEWPORT_HEIGHT_CSS_VAR, `${effectiveViewportHeight}px`)
      setIsKeyboardOpen(isMobileViewport && window.innerHeight - effectiveViewportHeight > 120)
    }

    function clearScheduledViewportSync() {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
        frameId = null
      }

      if (nestedFrameId !== null) {
        window.cancelAnimationFrame(nestedFrameId)
        nestedFrameId = null
      }

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    function syncViewportHeight() {
      applyViewportHeight()
      clearScheduledViewportSync()

      frameId = window.requestAnimationFrame(() => {
        nestedFrameId = window.requestAnimationFrame(() => {
          applyViewportHeight()
        })
      })

      timeoutId = window.setTimeout(() => {
        applyViewportHeight()
      }, 80)
    }

    syncViewportHeight()

    window.visualViewport?.addEventListener('resize', syncViewportHeight)
    window.visualViewport?.addEventListener('scroll', syncViewportHeight)
    window.addEventListener('resize', syncViewportHeight)

    return () => {
      clearScheduledViewportSync()
      window.visualViewport?.removeEventListener('resize', syncViewportHeight)
      window.visualViewport?.removeEventListener('scroll', syncViewportHeight)
      window.removeEventListener('resize', syncViewportHeight)
      rootStyle.removeProperty(ISOLATED_VIEWPORT_HEIGHT_CSS_VAR)
    }
  }, [])

  return {
    isKeyboardOpen,
    isolatedViewportStyle,
  }
}

export default useIsolatedViewportHeight
