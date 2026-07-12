const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 5000;
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
  // Forward any query string from the original request
  const origQuery = req.url.split('?')[1];
  if (origQuery) targetUrl.search = '?' + origQuery;

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

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': proxyRes.headers['content-type'] || 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error('[Innergy proxy] Error:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Innergy proxy error', detail: err.message }));
  });

  if (req.method === 'POST') {
    req.pipe(proxyReq, { end: true });
  } else {
    proxyReq.end();
  }
}

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];

  // ── Innergy proxy ──────────────────────────────────────────────────────────
  if (urlPath.startsWith('/innergy/')) {
    const innergyPath = urlPath.replace(/^\/innergy/, '');
    proxyInnergy(req, res, innergyPath);
    return;
  }

  // ── Static file serving ────────────────────────────────────────────────────
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(__dirname, urlPath);

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
