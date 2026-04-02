'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'

const ISOLATED_VIEWPORT_HEIGHT_CSS_VAR = '--chat-app-height'
const DEFAULT_ISOLATED_VIEWPORT_HEIGHT = '100svh'

export function useIsolatedViewportHeight() {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)
  const lastAppliedViewportHeightRef = useRef<number | null>(null)
  const lastKeyboardOpenRef = useRef<boolean | null>(null)
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
      const nextIsKeyboardOpen = isMobileViewport && window.innerHeight - effectiveViewportHeight > 120

      if (lastAppliedViewportHeightRef.current !== effectiveViewportHeight) {
        rootStyle.setProperty(ISOLATED_VIEWPORT_HEIGHT_CSS_VAR, `${effectiveViewportHeight}px`)
        lastAppliedViewportHeightRef.current = effectiveViewportHeight
      }

      if (lastKeyboardOpenRef.current !== nextIsKeyboardOpen) {
        setIsKeyboardOpen(nextIsKeyboardOpen)
        lastKeyboardOpenRef.current = nextIsKeyboardOpen
      }
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
      lastAppliedViewportHeightRef.current = null
      lastKeyboardOpenRef.current = null
      rootStyle.removeProperty(ISOLATED_VIEWPORT_HEIGHT_CSS_VAR)
    }
  }, [])

  return {
    isKeyboardOpen,
    isolatedViewportStyle,
  }
}

export default useIsolatedViewportHeight
