// api/innergy/index.js
// GET|POST /api/innergy/{*restOfPath}
// Server-side proxy to app.innergy.com — keeps the API key out of the browser.
// Set INNERGY_API_KEY in Azure Static Web Apps → Configuration → Application settings.

const https = require('https');

const INNERGY_BASE_HOST = 'app.innergy.com';
const INNERGY_API_KEY   = process.env.INNERGY_API_KEY || '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS, body: '' };
    return;
  }

  const restOfPath = context.bindingData.restOfPath || '';

  if (restOfPath === 'health') {
    context.res = {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, key: !!INNERGY_API_KEY }),
    };
    return;
  }

  if (!INNERGY_API_KEY) {
    context.res = {
      status: 503,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'INNERGY_API_KEY not set — add it in Azure → Configuration → Application settings' }),
    };
    return;
  }

  const targetPath = '/' + restOfPath;
  const rawQuery   = req.originalUrl ? req.originalUrl.split('?')[1] : '';

  return new Promise((resolve) => {
    const options = {
      hostname: INNERGY_BASE_HOST,
      path:     targetPath + (rawQuery ? '?' + rawQuery : ''),
      method:   req.method,
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
          headers: { ...CORS, 'Content-Type': 'application/json' },
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
            ...CORS,
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
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Innergy request timed out after 10s' }),
      };
      resolve();
    }, 10000);

    proxyReq.on('error', (err) => {
      clearTimeout(timer);
      context.res = {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Proxy error: ' + err.message }),
      };
      resolve();
    });

    proxyReq.end();
  });
};
