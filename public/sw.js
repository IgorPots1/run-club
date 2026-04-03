self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})

function normalizeThreadId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function normalizeMessageId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function normalizePriority(value) {
  return value === 'important' ? 'important' : 'normal'
}

function normalizeCount(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value)
  }

  if (typeof value === 'string' && value.trim()) {
    const parsedValue = Number(value)

    if (Number.isFinite(parsedValue) && parsedValue >= 0) {
      return Math.round(parsedValue)
    }
  }

  return undefined
}

function normalizeTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value)
  }

  if (typeof value === 'string' && value.trim()) {
    const parsedValue = Date.parse(value)

    if (!Number.isNaN(parsedValue)) {
      return parsedValue
    }
  }

  return undefined
}

function normalizeNotificationTag(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function buildChatThreadTargetUrl(threadId, messageId) {
  const normalizedThreadId = normalizeThreadId(threadId)
  const normalizedMessageId = normalizeMessageId(messageId)

  if (!normalizedThreadId) {
    return '/dashboard'
  }

  const targetUrl = new URL(`/messages/${encodeURIComponent(normalizedThreadId)}`, self.location.origin)

  if (normalizedMessageId) {
    targetUrl.searchParams.set('messageId', normalizedMessageId)
  }

  return `${targetUrl.pathname}${targetUrl.search}`
}

function resolveNotificationTargetUrl(targetUrl, threadId, messageId) {
  const fallbackUrl = buildChatThreadTargetUrl(threadId, messageId)

  if (typeof targetUrl !== 'string' || !targetUrl.trim()) {
    return new URL(fallbackUrl, self.location.origin).toString()
  }

  try {
    const resolvedUrl = new URL(targetUrl.trim(), self.location.origin)

    if (resolvedUrl.origin !== self.location.origin) {
      return new URL(fallbackUrl, self.location.origin).toString()
    }

    return resolvedUrl.toString()
  } catch {
    return new URL(fallbackUrl, self.location.origin).toString()
  }
}

async function focusWindowClient(client) {
  if (client && 'focus' in client) {
    try {
      await client.focus()
    } catch {
      // Ignore focus failures and continue with notification fallback behavior.
    }
  }
}

function postNavigateMessage(client, payload) {
  try {
    client.postMessage(payload)
  } catch {
    // Ignore postMessage failures; direct navigation/openWindow already handled the route.
  }
}

function getThreadIdFromUrl(url) {
  try {
    const nextUrl = new URL(url, self.location.origin)

    if (nextUrl.origin !== self.location.origin) {
      return ''
    }

    const match = nextUrl.pathname.match(/^\/messages\/([^/]+)$/)
    return match && match[1] ? decodeURIComponent(match[1]) : ''
  } catch {
    return ''
  }
}

function isVisibleWindowClient(client) {
  return client.visibilityState === 'visible' || client.focused === true
}

async function resolveSuppressionState(threadId, priority) {
  const clientsArr = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })
  const normalizedThreadId = normalizeThreadId(threadId)
  const hasVisibleClient = clientsArr.some((client) => isVisibleWindowClient(client))
  const hasVisibleSameThreadClient = normalizedThreadId
    ? clientsArr.some((client) => {
        if (!isVisibleWindowClient(client)) {
          return false
        }

        return getThreadIdFromUrl(client.url) === normalizedThreadId
      })
    : false

  if (hasVisibleSameThreadClient) {
    return {
      shouldShowNotification: false,
      suppressionReason: 'active_thread',
      visibleClients: clientsArr.filter((client) => isVisibleWindowClient(client)),
    }
  }

  if (hasVisibleClient && normalizePriority(priority) !== 'important') {
    return {
      shouldShowNotification: false,
      suppressionReason: 'foreground',
      visibleClients: clientsArr.filter((client) => isVisibleWindowClient(client)),
    }
  }

  return {
    shouldShowNotification: true,
    suppressionReason: null,
    visibleClients: clientsArr.filter((client) => isVisibleWindowClient(client)),
  }
}

self.addEventListener('push', (event) => {
  console.log('[sw] push_received')

  const payload = (() => {
    try {
      const nextPayload = event.data ? event.data.json() : {}
      console.log('[sw] push_payload', nextPayload)
      return nextPayload
    } catch (error) {
      console.error('[sw] push_parse_error', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
      return {}
    }
  })()

  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.trim()
    : 'Run Club'
  const body = typeof payload.body === 'string' ? payload.body : ''
  const messageId = normalizeMessageId(payload.messageId)
  const threadId = normalizeThreadId(payload.threadId)
  const threadType = typeof payload.threadType === 'string' ? payload.threadType : undefined
  const priority = normalizePriority(payload.priority)
  const targetUrl = resolveNotificationTargetUrl(payload.targetUrl, threadId, messageId)
  const threadUnreadCount = normalizeCount(payload.threadUnreadCount)
  const badgeCount = normalizeCount(payload.badgeCount)
  const unreadScope = payload.unreadScope === 'thread' ? 'thread' : undefined
  const tag = normalizeNotificationTag(payload.tag)
  const timestamp = normalizeTimestamp(payload.timestamp)

  event.waitUntil(
    (async () => {
      const suppressionState = await resolveSuppressionState(threadId, priority)

      if (!suppressionState.shouldShowNotification) {
        console.log('[sw] suppress_notification', {
          threadId,
          priority,
          reason: suppressionState.suppressionReason,
        })

        suppressionState.visibleClients.forEach((client) => {
          postNavigateMessage(client, {
            type: 'PUSH_SUPPRESSED',
            messageId,
            threadId,
            threadType,
            priority,
            targetUrl,
            reason: suppressionState.suppressionReason,
            source: 'push',
          })
        })

        return
      }

      console.log('[sw] show_notification', {
        title,
        body,
        threadUnreadCount,
        badgeCount,
      })

      await self.registration.showNotification(title, {
        body,
        tag,
        timestamp,
        data: {
          targetUrl,
          messageId,
          threadId,
          threadType,
          priority,
          threadUnreadCount,
          badgeCount,
          unreadScope,
        },
      })

      console.log('[sw] show_notification_done')
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const messageId = normalizeMessageId(event.notification.data?.messageId)
  const threadId = normalizeThreadId(event.notification.data?.threadId)
  const threadType = typeof event.notification.data?.threadType === 'string'
    ? event.notification.data.threadType
    : undefined
  const url = resolveNotificationTargetUrl(event.notification.data?.targetUrl, threadId, messageId)
  const navigationKey = `${Date.now()}:${messageId || threadId || url}`

  console.log('[sw] notification_click')
  console.log('[sw] target_url', {
    targetUrl: url,
  })

  event.waitUntil(
    (async () => {
      const clientsArr = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      const exactMatchClient = clientsArr.find(
        (client) => client.url === url
      )
      const sameOriginClient = clientsArr.find(
        (client) => client.url.startsWith(self.location.origin)
      )
      const bestClient = exactMatchClient ?? sameOriginClient

      if (bestClient) {
        const shouldNavigateClient = bestClient.url !== url && 'navigate' in bestClient

        if (shouldNavigateClient) {
          try {
            const navigatedClient = await bestClient.navigate(url)
            await focusWindowClient(navigatedClient ?? bestClient)
            console.log('[sw] focused_existing_client', {
              targetUrl: url,
              matchedExactly: false,
            })
            return
          } catch {
            // Fall back to router-based in-app navigation below.
          }
        }

        await focusWindowClient(bestClient)
        postNavigateMessage(bestClient, {
          type: 'NAVIGATE',
          url,
          messageId,
          threadId,
          threadType,
          navigationKey,
          source: 'notification-click',
        })
        console.log('[sw] focused_existing_client', {
          targetUrl: url,
          matchedExactly: bestClient.url === url,
        })
        return
      }

      const openedClient = await self.clients.openWindow(url)
      if (openedClient) {
        await focusWindowClient(openedClient)
      }
      console.log('[sw] opened_new_window', {
        targetUrl: url,
      })
    })()
  )
})
