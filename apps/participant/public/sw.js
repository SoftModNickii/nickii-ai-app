// Service worker for the participant app: shows push notifications, opens the app on tap,
// and keeps the last loaded app files so it still opens on a bad connection.
//
// Push payloads use the Declarative Web Push format (supabase/functions/send_push/push_logic.ts):
//   { "web_push": 8030, "notification": { title, body, navigate, tag, … }, "mutable": true, "data": { kind, badge } }
// Safari 18.4+ can show these without this file; every other browser (and older iOS) calls `push` below.

const CACHE = 'nickii-shell-v2';
const scope = () => self.registration.scope; // e.g. https://host/ or https://host/nickii-ai-app/

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Network first, cached copy if offline. Only same-origin GETs (never Supabase API calls).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch (err) {
      const cached = await caches.match(req) ?? (req.mode === 'navigate' ? await caches.match(scope()) : undefined);
      if (cached) return cached;
      throw err;
    }
  })());
});

function readPayload(event) {
  try {
    return event.data ? event.data.json() : {};
  } catch {
    return { notification: { body: event.data ? event.data.text() : '' } };
  }
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event);
  const n = payload.notification || {};
  const badge = payload.data && typeof payload.data.badge === 'number' ? payload.data.badge : 1;
  event.waitUntil((async () => {
    if (self.navigator.setAppBadge) await self.navigator.setAppBadge(badge).catch(() => {});
    await self.registration.showNotification(n.title || 'Nickii AI', {
      body: n.body || '',
      tag: n.tag || 'nickii',
      lang: n.lang,
      silent: n.silent === true,
      icon: new URL('icons/icon-192.png', scope()).href,
      data: { navigate: n.navigate || scope() },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.navigate) || scope();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => w.url.startsWith(scope()));
    if (open) {
      await open.focus();
      open.postMessage({ type: 'notification_opened', url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
