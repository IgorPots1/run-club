'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'

const MIN_VISIBLE_MS = 500
const MAX_VISIBLE_MS = 1800
const FADE_OUT_MS = 200

export default function AppLaunchScreen() {
  const [isVisible, setIsVisible] = useState(true)
  const [isFadingOut, setIsFadingOut] = useState(false)

  const bootStartedAtRef = useRef(0)
  const exitStartedRef = useRef(false)
  const fadeOutTimerRef = useRef<number | null>(null)
  const minVisibleTimerRef = useRef<number | null>(null)
  const maxVisibleTimerRef = useRef<number | null>(null)
  const shellReadyFrameOneRef = useRef<number | null>(null)
  const shellReadyFrameTwoRef = useRef<number | null>(null)

  const startExit = () => {
    if (exitStartedRef.current) {
      return
    }

    exitStartedRef.current = true

    if (minVisibleTimerRef.current !== null) {
      window.clearTimeout(minVisibleTimerRef.current)
    }

    if (maxVisibleTimerRef.current !== null) {
      window.clearTimeout(maxVisibleTimerRef.current)
    }

    setIsFadingOut(true)
    fadeOutTimerRef.current = window.setTimeout(() => {
      setIsVisible(false)
    }, FADE_OUT_MS)
  }

  useEffect(() => {
    bootStartedAtRef.current = performance.now()
    maxVisibleTimerRef.current = window.setTimeout(startExit, MAX_VISIBLE_MS)

    // Wait for hydration to complete and the first painted shell frame to land.
    shellReadyFrameOneRef.current = window.requestAnimationFrame(() => {
      shellReadyFrameTwoRef.current = window.requestAnimationFrame(() => {
        const elapsed = performance.now() - bootStartedAtRef.current
        const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed)

        minVisibleTimerRef.current = window.setTimeout(startExit, remaining)
      })
    })

    return () => {
      if (fadeOutTimerRef.current !== null) {
        window.clearTimeout(fadeOutTimerRef.current)
      }

      if (minVisibleTimerRef.current !== null) {
        window.clearTimeout(minVisibleTimerRef.current)
      }

      if (maxVisibleTimerRef.current !== null) {
        window.clearTimeout(maxVisibleTimerRef.current)
      }

      if (shellReadyFrameOneRef.current !== null) {
        window.cancelAnimationFrame(shellReadyFrameOneRef.current)
      }

      if (shellReadyFrameTwoRef.current !== null) {
        window.cancelAnimationFrame(shellReadyFrameTwoRef.current)
      }
    }
  }, [])

  if (!isVisible) {
    return null
  }

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black transition-opacity duration-200 ${
        isFadingOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <Image
        src="/images/xo-runners-splash.jpg"
        alt=""
        width={360}
        height={640}
        priority
        className="h-auto w-[75vw] max-w-[420px] object-contain"
      />
    </div>
  )
}
