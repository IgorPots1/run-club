'use client'

import { useEffect } from 'react'

const clearBootBackground = () => {
  document.documentElement.classList.remove('app-booting')
  document.body.classList.remove('app-booting')
}

export default function AppLaunchScreen() {
  useEffect(() => {
    const launchScreen = document.getElementById('launch-screen')

    if (!launchScreen) {
      clearBootBackground()
      return
    }

    const fadeDurationMs = 200
    let removeTimer: number | null = null

    const frameId = window.requestAnimationFrame(() => {
      launchScreen.classList.add('launch-screen--hidden')
      removeTimer = window.setTimeout(() => {
        launchScreen.remove()
        clearBootBackground()
      }, fadeDurationMs)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      if (removeTimer !== null) {
        window.clearTimeout(removeTimer)
      }
      clearBootBackground()
    }
  }, [])

  return null
}
