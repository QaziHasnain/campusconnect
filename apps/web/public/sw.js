self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  const notificationUrl = new URL(
    typeof payload.url === 'string' ? payload.url : '/notifications',
    self.location.origin,
  )
  const safeUrl =
    notificationUrl.origin === self.location.origin
      ? `${notificationUrl.pathname}${notificationUrl.search}${notificationUrl.hash}`
      : '/notifications'

  event.waitUntil(
    self.registration.showNotification(
      typeof payload.title === 'string' ? payload.title : 'CampusConnect',
      {
        body: typeof payload.body === 'string' ? payload.body : 'You have a new notification.',
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: typeof payload.tag === 'string' ? payload.tag : undefined,
        data: { url: safeUrl },
      },
    ),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(
    typeof event.notification.data?.url === 'string'
      ? event.notification.data.url
      : '/notifications',
    self.location.origin,
  )
  const url = target.origin === self.location.origin
    ? target.href
    : new URL('/notifications', self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const current = clients.find((client) => new URL(client.url).origin === self.location.origin)
      if (current) {
        return current.navigate(url).then((client) => client?.focus())
      }
      return self.clients.openWindow(url)
    }),
  )
})
