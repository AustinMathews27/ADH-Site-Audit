// api/innergy/index.js
// GET /api/innergy/{*restOfPath}
// Server-side proxy to app.innergy.com — keeps the API key out of the browser.
// Only the read-only Innergy endpoints the app uses are proxied (ALLOWED_PATHS),
// GET only, without a query string; anything else gets 404/405 and never
// reaches Innergy. Same-origin only: no CORS headers.
// Set INNERGY_API_KEY in Azure Static Web Apps → Configuration → Application settings.

const { requireUser } = require('../_shared/auth');
const https = require('https');

const INNERGY_BASE_HOST = 'app.innergy.com';
const INNERGY_API_KEY   = process.env.INNERGY_API_KEY || '';

// Innergy project ids are GUIDs: letters, digits and dashes only.
const INNERGY_ID = '[A-Za-z0-9-]{1,64}';
// Only these Innergy endpoints are proxied (index.html _innergyFetch callers):
//   api/projects                   project list (import picker)
//   api/projects/<id>/workOrders   one project's work orders (import, drift check)
const ALLOWED_PATHS = [
  new RegExp('^api/projects$'),
  new RegExp('^api/projects/' + INNERGY_ID + '/workOrders$'),
];

const JSON_HEADERS = { 'Content-Type': 'application/json' };

module.exports = async function (context, req) {
  // Sign-in is enforced at the edge; this parses the caller and applies the
  // optional ALLOWED_EMAIL_DOMAINS allow-list (see api/_shared/auth.js).
  if (!requireUser(context, req)) return;

  if (req.method !== 'GET') {
    context.res = {
      status: 405,
      headers: { ...JSON_HEADERS, 'Allow': 'GET' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
    return;
  }

  const restOfPath = String(context.bindingData.restOfPath || '');

  if (restOfPath === 'health') {
    context.res = {
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: true, key: !!INNERGY_API_KEY }),
    };
    return;
  }

  if (!ALLOWED_PATHS.some(re => re.test(restOfPath))) {
    context.res = {
      status: 404,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'Not found' }),
    };
    return;
  }

  if (!INNERGY_API_KEY) {
    context.res = {
      status: 503,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'INNERGY_API_KEY not set — add it in Azure → Configuration → Application settings' }),
    };
    return;
  }

  const targetPath = '/' + restOfPath;

  return new Promise((resolve) => {
    const options = {
      hostname: INNERGY_BASE_HOST,
      path:     targetPath,
      method:   'GET',
      headers:  {
        'api-key':      INNERGY_API_KEY,
        'Accept':       'application/json',
        'Content-Type': 'application/json',
        'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    };

    let timer;

    const proxyReq = https.request(options, (proxyRes) => {
      clearTimeout(timer);

      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400) {
        context.res = {
          status: 401,
          headers: JSON_HEADERS,
          body: JSON.stringify({ error: 'Innergy auth redirect — check INNERGY_API_KEY value' }),
        };
        proxyRes.resume();
        resolve();
        return;
      }

      let data = '';
      proxyRes.on('data', chunk => { data += chunk; });
      proxyRes.on('end', () => {
        context.res = {
          status: proxyRes.statusCode,
          headers: {
            'Content-Type': proxyRes.headers['content-type'] || 'application/json',
          },
          body: data,
        };
        resolve();
      });
    });

    timer = setTimeout(() => {
      proxyReq.destroy();
      context.res = {
        status: 504,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'Innergy request timed out after 10s' }),
      };
      resolve();
    }, 10000);

    proxyReq.on('error', (err) => {
      clearTimeout(timer);
      context.res = {
        status: 502,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'Proxy error: ' + err.message }),
      };
      resolve();
    });

    proxyReq.end();
  });
};
