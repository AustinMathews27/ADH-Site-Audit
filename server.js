const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 5000;
const HOST = '0.0.0.0';

const INNERGY_BASE = 'https://app.innergy.com';
const INNERGY_API_KEY = process.env.INNERGY_API_KEY || '';

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function proxyInnergy(req, res, innergyPath) {
  if (!INNERGY_API_KEY) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'INNERGY_API_KEY not configured' }));
    return;
  }

  const targetUrl = new URL(innergyPath, INNERGY_BASE);

  const options = {
    hostname: targetUrl.hostname,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: {
      'api-key': INNERGY_API_KEY,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  };

  let responded = false;
  function fail(status, msg) {
    if (responded) return;
    responded = true;
    try {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: msg }));
    } catch(e) {}
  }

  // 10-second hard timeout so the modal never hangs forever
  const timer = setTimeout(() => {
    proxyReq.destroy();
    fail(504, 'Innergy request timed out after 10s');
  }, 10000);

  const proxyReq = https.request(options, (proxyRes) => {
    clearTimeout(timer);
    if (responded) return;
    responded = true;
    // If Innergy redirected (e.g. auth failure), return a clear 401
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Innergy auth redirect — check api-key', location: proxyRes.headers.location }));
      proxyRes.resume();
      return;
    }
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': proxyRes.headers['content-type'] || 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    clearTimeout(timer);
    console.error('[Innergy proxy] Error:', err.message);
    fail(502, 'Innergy proxy error: ' + err.message);
  });

  if (req.method === 'POST') {
    req.pipe(proxyReq, { end: true });
  } else {
    proxyReq.end();
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

// Only these Innergy endpoints are proxied, GET only, no query string —
// same list as api/innergy/index.js.
const INNERGY_ALLOWED_PATHS = [
  /^\/api\/projects$/,
  /^\/api\/projects\/[A-Za-z0-9-]{1,64}\/workOrders$/,
];

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];

  // ── Innergy proxy — matches /api/innergy/* (same route as the Azure Function)
  if (urlPath.startsWith('/api/innergy/') || urlPath === '/api/innergy') {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    if (urlPath === '/api/innergy/health') {
      res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, key: !!INNERGY_API_KEY }));
      return;
    }
    const innergyPath = urlPath.replace(/^\/api\/innergy/, '');
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    if (!INNERGY_ALLOWED_PATHS.some(re => re.test(innergyPath))) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    proxyInnergy(req, res, innergyPath);
    return;
  }

  // ── Unknown /api/* routes → 404 so client cloud-sync gracefully skips ────
  // (Azure Functions handle these in production; locally we only proxy /api/innergy/*)
  if (urlPath.startsWith('/api/')) {
    res.writeHead(404, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not available in local dev' }));
    return;
  }

  // ── Static file serving ────────────────────────────────────────────────────
  if (urlPath === '/') urlPath = '/index.html';

  // Decode %20 etc. (resource files have spaces in their names) and stay
  // inside the project folder.
  let decoded = urlPath;
  try { decoded = decodeURIComponent(urlPath); } catch (e) {}
  const filePath = path.join(__dirname, path.normalize(decoded));
  if (!filePath.startsWith(__dirname)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      const indexPath = path.join(__dirname, 'index.html');
      fs.readFile(indexPath, (err2, data) => {
        if (err2) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        res.end(data);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err2, data) => {
      if (err2) {
        res.writeHead(500);
        res.end('Server error');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`ADH Field Audit Tool running at http://${HOST}:${PORT}`);
  console.log(`Innergy proxy: ${INNERGY_API_KEY ? 'ready' : 'NO API KEY — set INNERGY_API_KEY'}`);
});
