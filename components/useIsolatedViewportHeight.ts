'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'

const ISOLATED_VIEWPORT_HEIGHT_CSS_VAR = '--chat-app-height'
const DEFAULT_ISOLATED_VIEWPORT_HEIGHT = '100svh'
const CHAT_OPEN_DEBUG = true
const CHAT_OPEN_DEBUG_PREFIX = '[chat-open-debug]'

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

    function logViewportDebug(source: string, details: {
      visualViewportHeight: number
      visualViewportOffsetTop: number
      effectiveViewportHeight: number
      cssVarChanged: boolean
      nextIsKeyboardOpen: boolean
    }) {
      if (!CHAT_OPEN_DEBUG) {
        return
      }

      console.log(CHAT_OPEN_DEBUG_PREFIX, {
        now: Math.round(performance.now()),
        scope: 'viewport',
        source,
        threadId: null,
        scrollTop: null,
        scrollHeight: null,
        clientHeight: null,
        distanceFromBottom: null,
        pendingInitialScroll: null,
        isInitialBottomLockActive: null,
        showScrollToBottomButton: null,
        messageCount: null,
        innerHeight: window.innerHeight,
        visualViewportHeight: details.visualViewportHeight,
        visualViewportOffsetTop: details.visualViewportOffsetTop,
        effectiveViewportHeight: details.effectiveViewportHeight,
        cssVarChanged: details.cssVarChanged,
        isKeyboardOpen: details.nextIsKeyboardOpen,
      })
    }

    function applyViewportHeight(source: string) {
      const visualViewport = window.visualViewport
      const viewportHeight = visualViewport?.height ?? window.innerHeight
      const viewportOffsetTop = visualViewport?.offsetTop ?? 0
      const isMobileViewport = window.innerWidth < 768
      const effectiveViewportHeight = Math.round(viewportHeight + viewportOffsetTop)
      const nextIsKeyboardOpen = isMobileViewport && window.innerHeight - effectiveViewportHeight > 120
      const cssVarChanged = lastAppliedViewportHeightRef.current !== effectiveViewportHeight

      if (cssVarChanged) {
        rootStyle.setProperty(ISOLATED_VIEWPORT_HEIGHT_CSS_VAR, `${effectiveViewportHeight}px`)
        lastAppliedViewportHeightRef.current = effectiveViewportHeight
      }

      if (lastKeyboardOpenRef.current !== nextIsKeyboardOpen) {
        setIsKeyboardOpen(nextIsKeyboardOpen)
        lastKeyboardOpenRef.current = nextIsKeyboardOpen
      }

      logViewportDebug(source, {
        visualViewportHeight: viewportHeight,
        visualViewportOffsetTop: viewportOffsetTop,
        effectiveViewportHeight,
        cssVarChanged,
        nextIsKeyboardOpen,
      })
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

    function syncViewportHeight(source: string) {
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
