self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})

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
  const targetUrl = typeof payload.targetUrl === 'string' && payload.targetUrl.trim()
    ? payload.targetUrl.trim()
    : '/dashboard'

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
        },
      })

      console.log('[sw] show_notification_done')
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = typeof event.notification.data?.targetUrl === 'string'
    ? event.notification.data.targetUrl
    : '/dashboard'
  const url = new URL(targetUrl || '/dashboard', self.location.origin).toString()

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
      const isReusableClient = (client) =>
        client.focused === true || client.visibilityState === 'visible'
      const exactMatchClient = clientsArr.find(
        (client) => client.url === url && isReusableClient(client)
      )
      const sameOriginClient = clientsArr.find(
        (client) => client.url.startsWith(self.location.origin) && isReusableClient(client)
      )
      const bestClient = exactMatchClient ?? sameOriginClient

      if (bestClient && 'focus' in bestClient) {
        await bestClient.navigate(url)
        await bestClient.focus()
        bestClient.postMessage({
          type: 'NAVIGATE',
          url,
        })
        console.log('[sw] focused_existing_client', {
          targetUrl: url,
          matchedExactly: bestClient.url === url,
        })
        return
      }

      const openedClient = await self.clients.openWindow(url)
      if (openedClient) {
        if ('focus' in openedClient) {
          await openedClient.focus()
        }
        openedClient.postMessage({
          type: 'NAVIGATE',
          url,
        })
      }
      console.log('[sw] opened_new_window', {
        targetUrl: url,
      })
    })()
  )
})
