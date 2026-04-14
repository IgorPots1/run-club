'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'

const ISOLATED_VIEWPORT_HEIGHT_CSS_VAR = '--chat-app-height'
const DEFAULT_ISOLATED_VIEWPORT_HEIGHT = '100svh'
const KEYBOARD_OPEN_HEIGHT_DELTA_PX = 80
const KEYBOARD_CLOSE_HEIGHT_DELTA_PX = 40
const KEYBOARD_OPEN_OFFSET_TOP_PX = 10
const KEYBOARD_CLOSE_OFFSET_TOP_PX = 4
type ViewportSyncSource =
  | 'immediate'
  | 'raf1'
  | 'raf2'
  | 'timeout80'
  | 'vv-resize'
  | 'vv-scroll'
  | 'win-resize'

export function useIsolatedViewportHeight() {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)
  const lastAppliedViewportHeightRef = useRef<number | null>(null)
  const lastKeyboardOpenRef = useRef<boolean | null>(null)
  const baselineViewportHeightRef = useRef<number | null>(null)
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

    function applyViewportHeight(source: ViewportSyncSource) {
      const visualViewport = window.visualViewport
      const viewportHeight = visualViewport?.height ?? window.innerHeight
      const viewportOffsetTop = visualViewport?.offsetTop ?? 0
      const isMobileViewport = window.innerWidth < 768
      const effectiveViewportHeight = Math.round(viewportHeight + viewportOffsetTop)
      const baselineViewportHeight = baselineViewportHeightRef.current ?? effectiveViewportHeight
      const viewportHeightDelta = baselineViewportHeight - effectiveViewportHeight
      let nextIsKeyboardOpen = lastKeyboardOpenRef.current ?? false
      const cssVarChanged = lastAppliedViewportHeightRef.current !== effectiveViewportHeight
      const previousIsKeyboardOpen = lastKeyboardOpenRef.current

      if (!isMobileViewport) {
        nextIsKeyboardOpen = false
      } else if (
        viewportHeightDelta >= KEYBOARD_OPEN_HEIGHT_DELTA_PX ||
        viewportOffsetTop >= KEYBOARD_OPEN_OFFSET_TOP_PX
      ) {
        nextIsKeyboardOpen = true
      } else if (
        viewportHeightDelta <= KEYBOARD_CLOSE_HEIGHT_DELTA_PX &&
        viewportOffsetTop <= KEYBOARD_CLOSE_OFFSET_TOP_PX
      ) {
        nextIsKeyboardOpen = false
      }

      if (
        !nextIsKeyboardOpen &&
        (baselineViewportHeightRef.current === null || effectiveViewportHeight > baselineViewportHeightRef.current)
      ) {
        baselineViewportHeightRef.current = effectiveViewportHeight
      }

      const keyboardStateChanged = previousIsKeyboardOpen !== nextIsKeyboardOpen
      const isVisualViewportTransitionSource = source === 'vv-resize' || source === 'vv-scroll'
      const isKeyboardTransitionActive = isMobileViewport && Boolean(visualViewport) && (
        nextIsKeyboardOpen ||
        previousIsKeyboardOpen === true ||
        keyboardStateChanged
      )
      const shouldDeferCssVarWrite = isVisualViewportTransitionSource &&
        cssVarChanged &&
        isKeyboardTransitionActive

      if (cssVarChanged && !shouldDeferCssVarWrite) {
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

    function syncViewportHeight(source: ViewportSyncSource) {
      applyViewportHeight(source)
      clearScheduledViewportSync()

      frameId = window.requestAnimationFrame(() => {
        applyViewportHeight('raf1')
        nestedFrameId = window.requestAnimationFrame(() => {
          applyViewportHeight('raf2')
        })
      })

      timeoutId = window.setTimeout(() => {
        applyViewportHeight('timeout80')
      }, 80)
    }

    syncViewportHeight('immediate')

    const handleVisualViewportResize = () => {
      syncViewportHeight('vv-resize')
    }
    const handleVisualViewportScroll = () => {
      syncViewportHeight('vv-scroll')
    }
    const handleWindowResize = () => {
      baselineViewportHeightRef.current = null
      syncViewportHeight('win-resize')
    }

    window.visualViewport?.addEventListener('resize', handleVisualViewportResize)
    window.visualViewport?.addEventListener('scroll', handleVisualViewportScroll)
    window.addEventListener('resize', handleWindowResize)

    return () => {
      clearScheduledViewportSync()
      window.visualViewport?.removeEventListener('resize', handleVisualViewportResize)
      window.visualViewport?.removeEventListener('scroll', handleVisualViewportScroll)
      window.removeEventListener('resize', handleWindowResize)
      baselineViewportHeightRef.current = null
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
