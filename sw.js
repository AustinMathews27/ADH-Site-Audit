// ADH Field Audit Tool — Service Worker
// Cache version — bump this string to force update
const CACHE_VERSION = 'adh-audit-v8.52';

// Resources to pre-cache on install
const PRECACHE = [
  '/',
  '/index.html',
  '/pdf-export.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.ico',
  '/logo.png',
  '/logo-white.png',
  '/vendor/jspdf.umd.min.js',
  '/vendor/xlsx.full.min.js',
  '/vendor/pdf-lib.min.js',
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
  // No skipWaiting here: the new SW waits until the page's update banner
  // posts SKIP_WAITING, so open clients are never reloaded without consent.
  // A failed precache rejects install — the old SW and its cache stay live
  // and the browser retries the install later.
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(PRECACHE))
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    // Only delete old caches once the new cache verifiably holds the app
    // shell — never trade a working offline cache for an empty one.
    caches.open(CACHE_VERSION)
      .then(cache => cache.match('/index.html'))
      .then(shell => {
        if (!shell) return;
        return caches.keys().then(keys =>
          Promise.all(
            keys
              .filter(key => key !== CACHE_VERSION)
              .map(key => caches.delete(key))
          )
        );
      })
      .then(() => self.clients.claim())
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
          // Opaque responses (no-cors stylesheet loads, status 0) are valid
          // cache entries — without them the Google Fonts CSS never caches.
          if (!response || (response.status !== 200 && response.type !== 'opaque')) return response;
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
          // Only cache successful same-origin basic responses.
          // Skip query-string URLs (e.g. index.html?vercheck=...) — each
          // unique URL would pile another full copy into the cache forever.
          if (!response || response.status !== 200 || response.type !== 'basic' || url.search) return response;
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() =>
          caches.match(request, { ignoreSearch: url.pathname === '/' || url.pathname === '/index.html' }).then(cached => {
            if (cached) return cached;
            // App-shell fallback is for navigations only; a script/JSON/image
            // request must fail honestly, not receive HTML with a 200.
            if (request.mode === 'navigate') return caches.match('/index.html');
            return new Response('', { status: 504, statusText: 'offline' });
          })
        )
    );
  }
});

