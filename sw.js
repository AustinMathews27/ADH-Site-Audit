// ADH Field Audit Tool — Service Worker
// Cache version — bump this string to force update
const CACHE_VERSION = 'adh-audit-v8.68';

// Resources to pre-cache on install
const PRECACHE = [
  '/',
  '/index.html',
  '/pdf-export.js',
  '/project-book.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.ico',
  '/logo.png',
  '/logo-white.png',
  '/vendor/jspdf.umd.min.js',
  '/vendor/xlsx.full.min.js',
  '/vendor/pdf-lib.min.js',
  '/vendor/pdfjs.min.js',          // floor plan PDF viewer (lazy-loaded by the app)
  '/vendor/pdfjs.worker.min.js',
  '/resources/manifest.json',      // Resources / Toolbox / Toolbox Log lists
];

// Unversioned caches that survive app updates (activate never deletes them):
// offline copies of documents (resources/*.pdf …) and the push-subscription
// details the page saves for pushsubscriptionchange.
const DOCS_CACHE = 'adh-docs';
const META_CACHE = 'adh-meta';
const PUSH_META_URL = '/__push-meta';
const KEEP_CACHES = [DOCS_CACHE, META_CACHE];
const isDoc = url => url.origin === self.location.origin &&
  url.pathname.startsWith('/resources/') && url.pathname !== '/resources/manifest.json';

// Navigations and app-shell files wait this long for the network, then the
// cached copy is served (the network answer still refreshes the cache).
const SHELL_TIMEOUT_MS = 3000;
const SHELL_PATHS = new Set(PRECACHE);
// For a short while after a navigation, the page's own app-shell files are
// answered the same way the page was (cache or network), so one page load
// never mixes files from two releases.
const SHELL_MODE_MS = 30000;
let shellMode = null, shellModeUntil = 0;

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
  // Refill the app-shell cache (Admin → Force refresh clears it). The reply
  // goes to the MessageChannel port the page passes, if any.
  if (event.data && event.data.type === 'PRECACHE') {
    const port = event.ports && event.ports[0];
    event.waitUntil(
      caches.open(CACHE_VERSION).then(cache => cache.addAll(PRECACHE))
        .then(() => { if (port) port.postMessage({ ok: true }); },
              e => { if (port) port.postMessage({ ok: false, error: String(e && e.message || e) }); })
    );
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
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  // The app root just brings the app forward; any other URL is opened in it.
  const isRoot = target === self.location.origin + '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) {
          return c.focus().then(w => {
            const win = w || c;
            if (!isRoot && win.url !== target && 'navigate' in win) return win.navigate(target);
          }).catch(() => {});
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

// The push service replaced or expired this device's subscription:
// subscribe again and save it under the same deviceId the page uses.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    let meta = null;
    try {
      const res = await (await caches.open(META_CACHE)).match(PUSH_META_URL);
      if (res) meta = await res.json();
    } catch (e) {}
    let sub = event.newSubscription || null;
    if (!sub) {
      const oldKey = event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey;
      const key = oldKey || (meta && meta.key ? b64UrlToUint8(meta.key) : null);
      if (!key) return;
      sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    if (meta && meta.deviceId) {
      await fetch('/api/savePushSub', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: meta.deviceId, user: meta.user || '', label: meta.label || '', subscription: sub.toJSON() }),
      });
    } else {
      // No saved details yet: an open page re-registers on this message
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      list.forEach(c => c.postMessage({ type: 'PUSH_SUB_CHANGED' }));
    }
  })().catch(() => {}));
});

function b64UrlToUint8(s) {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

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
        return caches.keys().then(keys => {
          const old = keys.filter(key => key !== CACHE_VERSION && !KEEP_CACHES.includes(key));
          // Older versions kept documents in the versioned cache — move them
          // to the documents cache before that cache goes.
          return moveDocs(old).then(() => Promise.all(old.map(key => caches.delete(key))));
        });
      })
      .then(() => self.clients.claim())
  );
});

function moveDocs(cacheNames) {
  return caches.open(DOCS_CACHE).then(docs => Promise.all(cacheNames.map(name =>
    caches.open(name).then(old => old.keys().then(reqs => Promise.all(reqs
      .filter(req => isDoc(new URL(req.url)))
      .map(req => docs.match(req).then(have => have ? null
        : old.match(req).then(res => res ? docs.put(req, res) : null)))
    )))
  ))).catch(() => {});
}

// ── FETCH ────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, chrome-extension, and blob/data URL requests
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;
  if (url.protocol === 'blob:' || url.protocol === 'data:') return;

  // Skip Azure API calls and the Static Web Apps auth endpoints — never
  // cache these. /.auth/me answers "who am I" and must always be live; the
  // page keeps its own copy of the identity in IndexedDB for offline starts.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.auth/')) return;

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
    // The cache write finishes in the background; keep the worker alive for it.
    let cacheWritten;
    event.waitUntil(new Promise(r => { cacheWritten = r; }));
    const fromNetwork = fetch(request)
      .then(response => {
        // Only cache successful same-origin basic responses.
        // Skip query-string URLs (e.g. index.html?vercheck=...) — each
        // unique URL would pile another full copy into the cache forever.
        if (!response || response.status !== 200 || response.type !== 'basic' || url.search) { cacheWritten(); return response; }
        const clone = response.clone();
        caches.open(isDoc(url) ? DOCS_CACHE : CACHE_VERSION)
          .then(cache => cache.put(request, clone)).catch(() => {}).then(cacheWritten);
        return response;
      }, err => { cacheWritten(); throw err; });
    const fromCache = () =>
      caches.match(request, { ignoreSearch: url.pathname === '/' || url.pathname === '/index.html' }).then(cached => {
        if (cached) return cached;
        // App-shell fallback is for navigations only; a script/JSON/image
        // request must fail honestly, not receive HTML with a 200.
        if (request.mode === 'navigate') return caches.match('/index.html');
        return null;
      });
    const offline = () => fromCache().then(cached => cached || new Response('', { status: 504, statusText: 'offline' }));

    const isNav = request.mode === 'navigate';
    const isShell = isNav || (!url.search && SHELL_PATHS.has(url.pathname));
    if (!isShell) {
      event.respondWith(fromNetwork.catch(offline));
      return;
    }
    // Shell files of a page that was just served: follow the page
    const mode = !isNav && Date.now() < shellModeUntil ? shellMode : null;
    if (mode === 'network') { event.respondWith(fromNetwork.catch(offline)); return; }
    if (mode === 'cache') {
      // the network answer still refreshes the cache in the background
      event.respondWith(fromCache().then(cached => cached || fromNetwork.catch(offline)));
      return;
    }
    // App shell on a weak signal: after SHELL_TIMEOUT_MS serve the cached
    // copy if there is one; otherwise keep waiting for the network.
    event.respondWith(new Promise(resolve => {
      let settled = false;
      const settle = (res, how) => {
        if (settled || !res) return;
        settled = true;
        if (isNav) { shellMode = how; shellModeUntil = Date.now() + SHELL_MODE_MS; }
        resolve(res);
      };
      const timer = setTimeout(() => fromCache().then(res => settle(res, 'cache')).catch(() => {}), SHELL_TIMEOUT_MS);
      fromNetwork.then(res => { clearTimeout(timer); settle(res, 'network'); },
                       () => { clearTimeout(timer); offline().then(res => settle(res, 'cache')); });
    }));
  }
});

