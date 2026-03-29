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
  const threadId = typeof payload.threadId === 'string' ? payload.threadId : ''
  const threadType = payload.threadType === 'club' || payload.threadType === 'direct_coach'
    ? payload.threadType
    : undefined

  event.waitUntil(
    (async () => {
      console.log('[sw] show_notification', {
        title,
        body,
      })

      await self.registration.showNotification(title, {
        body,
        data: {
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
  const targetUrl = threadId ? `/messages/${threadId}` : '/messages'

  console.log('[sw] notification_click')
  console.log('[sw] target_url', {
    targetUrl,
  })

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })

      for (const client of windowClients) {
        if (!('focus' in client) || !client.url.startsWith(self.location.origin)) {
          continue
        }

        await client.navigate(targetUrl)
        await client.focus()
        console.log('[sw] focused_existing_client', {
          targetUrl,
        })
        return
      }

      await self.clients.openWindow(targetUrl)
      console.log('[sw] opened_new_window', {
        targetUrl,
      })
    })()
  )
})
