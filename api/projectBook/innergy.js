// api/projectBook/innergy.js
// Server-side Innergy client for the Master Project Book sync.
// Same auth as api/innergy/index.js (api-key header against app.innergy.com),
// but called from inside the Function so the sync can run on a schedule
// with nobody in the browser.

const https = require('https');

const HOST    = 'app.innergy.com';
const API_KEY = process.env.INNERGY_API_KEY || '';
// Per-request cap. Kept well under the 45 s Static Web Apps request limit so a
// slow Innergy call can't take the whole sync down with it.
const TIMEOUT_MS = 12000;
// Same browser User-Agent the /api/innergy proxy (and server.js) send — that
// header is what's been proven to work against app.innergy.com with this key.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function getJSON(path) {
  if (!API_KEY) return Promise.reject(new Error('INNERGY_API_KEY not set'));
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: HOST,
      path,
      method: 'GET',
      headers: {
        'api-key':      API_KEY,
        'Accept':       'application/json',
        'Content-Type': 'application/json',
        'User-Agent':   USER_AGENT,
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        return reject(new Error('Innergy auth redirect — check INNERGY_API_KEY'));
      }
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Innergy HTTP ${res.statusCode} on ${path}`));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Innergy returned non-JSON on ${path}`)); }
      });
    });
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error(`Innergy timed out after ${TIMEOUT_MS / 1000}s on ${path}`));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Innergy wraps lists in { Items: [...] }; tolerate a bare array too. */
function items(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.Items)) return data.Items;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

async function listProjects() {
  return items(await getJSON('/api/projects'));
}

async function listWorkOrders(projectId) {
  return items(await getJSON(`/api/projects/${encodeURIComponent(projectId)}/workOrders`));
}

/** Run `fn` over `list` with at most `limit` in flight — Innergy has ~25
 *  projects today, so this is polite rather than necessary. */
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const idx = i++;
      out[idx] = await fn(list[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

module.exports = { getJSON, items, listProjects, listWorkOrders, mapLimit, hasKey: () => !!API_KEY };
