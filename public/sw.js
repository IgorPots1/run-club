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
  const payload = (() => {
    try {
      return event.data ? event.data.json() : {}
    } catch {
      return {}
    }
  })()

  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.trim()
    : 'Run Club'
  const body = typeof payload.body === 'string' ? payload.body : ''

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
    })
  )
})
