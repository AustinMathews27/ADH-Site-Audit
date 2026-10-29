// api/sendAfqc/index.js
// POST /api/sendAfqc
// Body: { category, priority, description, project:{name,number,client},
//         si:{num,title,status,fieldCheck}, by, replyEmail?, appUrl?,
//         photos?: [{ name, contentType, base64 }] }
//
// The subject and HTML body are built HERE from those plain fields (escaped),
// never taken from the client, so the endpoint can't be used to mail
// arbitrary content from the company mailbox.
// Sends an AFQC (Allegheny Field Quality Check) email from the field app
// through Microsoft Graph, as the company mailbox in AFQC_SENDER.
//
// The recipient is FIXED server-side (AFQC_TO, default the AFQC inbox) — the
// endpoint is anonymous like the rest of /api, so it must never accept a
// "to" address from the client or it becomes an open relay.
//
// App settings (Azure Static Web Apps → Configuration):
//   AFQC_TENANT_ID, AFQC_CLIENT_ID, AFQC_CLIENT_SECRET — Entra app registration
//     with the Microsoft Graph *application* permission Mail.Send (admin consent),
//     ideally restricted to the sender mailbox by an Exchange application
//     access policy.
//   AFQC_SENDER — the mailbox it sends as (e.g. siteaudit@alleghenymillwork.com)
//   AFQC_TO     — optional, defaults to afqc@alleghenymillwork.com
// Without them it answers 503 { error: "not_configured" } and the app falls
// back to opening the email in the device's Mail app.

const https = require('https');

const TO_DEFAULT  = 'afqc@alleghenymillwork.com';
const MAX_PHOTOS  = 8;
const MAX_BYTES   = 3 * 1024 * 1024;   // Graph sendMail: whole request must stay under 4 MB
const EMAIL_RE    = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function request(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ method, hostname: u.hostname, path: u.pathname + u.search, headers }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

let _token = null;   // { value, exp } — reused while the function instance is warm
async function graphToken(tenant, clientId, secret) {
  if (_token && _token.exp > Date.now() + 60000) return _token.value;
  const form = new URLSearchParams({
    client_id: clientId, client_secret: secret,
    scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
  }).toString();
  const r = await request('POST', `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) }, form);
  const j = JSON.parse(r.body || '{}');
  if (r.status !== 200 || !j.access_token) throw new Error('token ' + r.status + ' ' + (j.error_description || j.error || '').slice(0, 200));
  _token = { value: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 };
  return _token.value;
}

module.exports = async function (context, req) {
  context.res = { headers: { 'Content-Type': 'application/json' } };
  const env = process.env;
  if (!env.AFQC_TENANT_ID || !env.AFQC_CLIENT_ID || !env.AFQC_CLIENT_SECRET || !env.AFQC_SENDER) {
    context.res.status = 503;
    context.res.body = { ok: false, error: 'not_configured' };
    return;
  }

  const b = req.body || {};
  const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const proj = b.project || {}, si = b.si || {};
  const category    = str(b.category, 40) || 'General';
  const priority    = str(b.priority, 20) === 'Urgent' ? 'Urgent' : 'Normal';
  const description = str(b.description, 4000);
  if (!description || !str(proj.name, 1)) {
    context.res.status = 400;
    context.res.body = { ok: false, error: 'project and description required' };
    return;
  }
  const subject = [priority === 'Urgent' ? 'URGENT' : '', 'AFQC', category,
    [str(proj.number, 30), str(proj.name, 80)].filter(Boolean).join(' '),
    si.num ? [str(si.num, 20), str(si.title, 80)].filter(Boolean).join(' ') : ''].filter(Boolean).join(' – ');
  const row = (k, v) => v ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;color:#0f172a">${esc(v)}</td></tr>` : '';
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#0f172a">
    <div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:${priority === 'Urgent' ? '#dc2626' : '#2563eb'}">ALLEGHENY FIELD QUALITY CHECK${priority === 'Urgent' ? ' · URGENT' : ''}</div>
    <h2 style="margin:6px 0 12px;font-size:18px">${esc(category)} issue — ${esc(str(proj.name, 80))}</h2>
    <table style="border-collapse:collapse;font-size:13px;margin-bottom:14px">
      ${row('Project', [str(proj.number, 30), str(proj.name, 80)].filter(Boolean).join(' · '))}
      ${row('Client', str(proj.client, 80))}
      ${row('Scope item', [str(si.num, 20), str(si.title, 120)].filter(Boolean).join(' — '))}
      ${row('SI status', [str(si.status, 30), str(si.fieldCheck, 60)].filter(Boolean).join(' · '))}
      ${row('Category', category)}
      ${row('Priority', priority)}
      ${row('Reported by', str(b.by, 60))}
      ${row('Reported', new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET')}
    </table>
    <div style="font-weight:700;margin-bottom:4px">Issue</div>
    <div style="white-space:pre-wrap;line-height:1.5;padding:10px 12px;background:#f1f5f9;border-radius:8px">${esc(description)}</div>
    <div style="margin-top:14px;font-size:11px;color:#64748b">Sent from the ADH Site Audit app${(b.photos || []).length ? ' · photos attached' : ''}. Reply to this email to reach the reporter.</div>
  </div>`;

  let total = 0;
  const attachments = [];
  for (const p of (Array.isArray(b.photos) ? b.photos : []).slice(0, MAX_PHOTOS)) {
    const base64 = String(p && p.base64 || '');
    if (!/^[A-Za-z0-9+/=]+$/.test(base64)) continue;
    total += base64.length * 3 / 4;
    if (total > MAX_BYTES) break;
    attachments.push({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: String(p.name || 'photo.jpg').replace(/[^\w.\- ]/g, '_').slice(0, 80),
      contentType: /^image\/(jpeg|png)$/.test(p.contentType) ? p.contentType : 'image/jpeg',
      contentBytes: base64,
    });
  }

  const message = {
    subject,
    body: { contentType: 'HTML', content: html },
    toRecipients: [{ emailAddress: { address: env.AFQC_TO || TO_DEFAULT } }],
    attachments,
  };
  const replyEmail = str(b.replyEmail, 120);
  if (replyEmail && EMAIL_RE.test(replyEmail)) {
    message.replyTo = [{ emailAddress: { address: replyEmail, name: str(b.by, 80) } }];
  }

  try {
    const token = await graphToken(env.AFQC_TENANT_ID, env.AFQC_CLIENT_ID, env.AFQC_CLIENT_SECRET);
    const payload = JSON.stringify({ message, saveToSentItems: true });
    const r = await request('POST', `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.AFQC_SENDER)}/sendMail`,
      { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, payload);
    if (r.status !== 202) {
      context.log.warn('[sendAfqc] Graph', r.status, (r.body || '').slice(0, 300));
      context.res.status = 502;
      context.res.body = { ok: false, error: 'graph_' + r.status };
      return;
    }
    context.log(`[sendAfqc] ✓ "${subject}" · ${attachments.length} photo(s)`);
    context.res.status = 200;
    context.res.body = { ok: true, to: env.AFQC_TO || TO_DEFAULT, photos: attachments.length };
  } catch (e) {
    context.log.error('[sendAfqc]', e.message);
    context.res.status = 502;
    context.res.body = { ok: false, error: 'send_failed' };
  }
};
