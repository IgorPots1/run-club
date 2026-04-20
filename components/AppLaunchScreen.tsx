'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import splashImage from '../ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png'

const MIN_VISIBLE_MS = 500
const MAX_VISIBLE_MS = 1800
const FADE_OUT_MS = 200

const clearBootBackground = () => {
  document.documentElement.classList.remove('app-booting')
  document.body.classList.remove('app-booting')
}

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
      clearBootBackground()
      setIsVisible(false)
    }, FADE_OUT_MS)
  }

  useEffect(() => {
    document.documentElement.classList.add('app-booting')
    document.body.classList.add('app-booting')
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

      clearBootBackground()
    }
  }, [])

  if (!isVisible) {
    return null
  }

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-[100] bg-black transition-opacity duration-200 ease-out ${
        isFadingOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="flex h-full w-full items-center justify-center px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <Image
          src={splashImage}
          alt=""
          priority
          unoptimized
          sizes="(max-width: 768px) 80vw, 420px"
          className="h-auto w-[80vw] max-w-[420px] object-contain select-none"
        />
      </div>
    </div>
  )
}
