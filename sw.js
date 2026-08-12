// ADH Field Audit Tool — Service Worker
// Cache version — bump this string to force update
const CACHE_VERSION = 'adh-audit-v8.40';

// Resources to pre-cache on install
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.ico',
  '/logo.png',
  '/logo-white.png',
  '/vendor/jspdf.umd.min.js',
  '/vendor/xlsx.full.min.js',
];

// CDN origins to cache at runtime
const CDN_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

// ── MESSAGE (allow page to trigger skipWaiting) ──
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── PUSH (Web Push — delivery with the app closed) ───────────────
// iOS wakes this worker for pushes only when the PWA is installed to
// the Home Screen (iOS 16.4+). Payload comes from /api/sendPush.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'ADH Audit', {
      body:  data.body || '',
      icon:  '/icon-192.png',
      badge: '/icon-192.png',
      tag:   data.tag || undefined,
      data:  { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow((event.notification.data && event.notification.data.url) || '/');
    })
  );
});

// ── INSTALL ──────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(err => {
        // Don't fail install if one asset is missing (e.g. subdirectory deploys)
        console.warn('[SW] Precache partial failure:', err.message);
        return self.skipWaiting();
      })
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, chrome-extension, and blob/data URL requests
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;
  if (url.protocol === 'blob:' || url.protocol === 'data:') return;

  // Skip Azure API calls — never cache these
  if (url.pathname.startsWith('/api/')) return;

  // For CDN requests: cache-first, fallback to network
  const isCDN = CDN_ORIGINS.some(o => url.origin === o || request.url.startsWith(o));

  if (isCDN) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (!response || response.status !== 200) return response;
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(request, clone));
          return response;
        }).catch(() => cached || new Response('', { status: 503 }));
      })
    );
    return;
  }

  // For same-origin requests: network-first with offline fallback
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Only cache successful same-origin basic responses
          if (!response || response.status !== 200 || response.type !== 'basic') return response;
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() =>
          caches.match(request).then(cached =>
            cached || caches.match('/index.html')
          )
        )
    );
  }
});

