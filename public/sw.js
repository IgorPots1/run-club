self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})

function buildChatThreadTargetUrl(threadId) {
  return typeof threadId === 'string' && threadId.trim()
    ? `/messages/${threadId.trim()}`
    : '/dashboard'
}

function resolveNotificationTargetUrl(targetUrl, threadId) {
  const fallbackUrl = buildChatThreadTargetUrl(threadId)

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
  const threadId = typeof payload.threadId === 'string' ? payload.threadId.trim() : ''
  const threadType = typeof payload.threadType === 'string' ? payload.threadType : undefined
  const targetUrl = resolveNotificationTargetUrl(payload.targetUrl, threadId)

  event.waitUntil(
    (async () => {
      console.log('[sw] show_notification', {
        title,
        body,
      })

      await self.registration.showNotification(title, {
        body,
        data: {
          targetUrl,
          threadId,
          threadType,
        },
      })

      console.log('[sw] show_notification_done')
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const threadId = typeof event.notification.data?.threadId === 'string'
    ? event.notification.data.threadId
    : ''
  const threadType = typeof event.notification.data?.threadType === 'string'
    ? event.notification.data.threadType
    : undefined
  const url = resolveNotificationTargetUrl(event.notification.data?.targetUrl, threadId)
  const navigationKey = `${Date.now()}:${threadId || url}`

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
