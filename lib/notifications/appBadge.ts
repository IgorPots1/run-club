'use client'

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

function getBadgeNavigator() {
  if (typeof navigator === 'undefined') {
    return null
  }

  return navigator as BadgeNavigator
}

export async function setAppBadgeCount(count: number) {
  const badgeNavigator = getBadgeNavigator()

  if (!badgeNavigator?.setAppBadge) {
    return
  }

  const nextCount = Math.max(0, Math.floor(count))

  try {
    await badgeNavigator.setAppBadge(nextCount)
    console.log(`[badge] set ${nextCount}`)
  } catch {
    // Keep badge updates non-blocking for unsupported or transient browser states.
  }
}

export async function clearAppBadge() {
  const badgeNavigator = getBadgeNavigator()

  if (!badgeNavigator?.clearAppBadge) {
    return
  }

  try {
    await badgeNavigator.clearAppBadge()
    console.log('[badge] clear')
  } catch {
    // Keep badge updates non-blocking for unsupported or transient browser states.
  }
}
