// ADH Field Audit Tool — Service Worker
// Cache version — bump this string to force update
const CACHE_VERSION = 'adh-audit-v8.01';

// Resources to pre-cache on install
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.ico',
];

// CDN origins to cache at runtime
const CDN_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://cdnjs.cloudflare.com',
];

// ── MESSAGE (allow page to trigger skipWaiting or manual flush) ──
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'FLUSH_OPS') {
    event.waitUntil(flushPendingOps());
  }
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

// ══════════════════════════════════════════════════════════════════
// BACKGROUND SYNC — flush pendingOps queue when connectivity returns
// ══════════════════════════════════════════════════════════════════
// Fired by the browser when network comes back, even if the app is closed.
// Reads the pending_ops_v1 queue from the same IndexedDB the page uses,
// POSTs each patch to /api/patchAudit, removes successful ones.
// Idempotent — the page sync flow may run concurrently; the server's
// deep-merge + ETag concurrency makes double-POST safe.

self.addEventListener('sync', event => {
  if (event.tag === 'adh-flush-ops') {
    event.waitUntil(flushPendingOps());
  }
});

// Periodic Sync (only on Chrome with permission; falls back gracefully)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'adh-flush-ops') {
    event.waitUntil(flushPendingOps());
  }
});

// ── Opens the same IndexedDB the page uses ──────────────────────
function _swOpenDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('adh_audit_db', 1);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
    // No onupgradeneeded — the page creates the store; SW only reads/writes
  });
}

function _swIdbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = e => reject(e.target.error);
  });
}

function _swIdbSet(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('kv', 'readwrite');
    const req = tx.objectStore('kv').put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

async function flushPendingOps() {
  try {
    const db = await _swOpenDb();
    const ops = (await _swIdbGet(db, 'pending_ops_v1')) || [];
    if (!ops.length) return;

    const remaining = [];
    for (const op of ops) {
      try {
        const res = await fetch('/api/patchAudit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch: op.patch })
        });
        if (!res.ok) {
          // Server rejected — keep op and stop (will retry next sync event)
          remaining.push(op);
          break;
        }
        // Success — drop this op
      } catch (err) {
        // Network error — keep op and stop
        remaining.push(op);
        break;
      }
    }

    // If any ops were skipped due to early break, keep the rest of the queue too
    if (remaining.length > 0 && remaining.length < ops.length) {
      const failedIdx = ops.indexOf(remaining[0]);
      remaining.push(...ops.slice(failedIdx + 1));
    }

    await _swIdbSet(db, 'pending_ops_v1', remaining);

    // Notify any open clients that ops were flushed so they can refresh
    if (remaining.length < ops.length) {
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      clients.forEach(c => c.postMessage({ type: 'OPS_FLUSHED', flushed: ops.length - remaining.length }));
    }
  } catch (err) {
    console.warn('[SW] flushPendingOps failed:', err.message);
  }
}
