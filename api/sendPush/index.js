// api/sendPush/index.js
// POST /api/sendPush
// Body: { id, to, msg, from, fromDeviceId }
//   to: target deviceId, or '*' for every subscribed device
//
// Delivers a Web Push to the target device(s) so the message lands even when
// the PWA is closed — the in-app modal (poll + store.notifications) remains
// the source of truth and read-receipt path; this is the wake-up channel.
//
// Requires app settings: VAPID_PRIVATE_KEY (secret, pairs with the public key
// baked into index.html/sw.js). Optional: VAPID_SUBJECT (mailto: contact).
// Without the private key the endpoint no-ops with ok:false so the client
// stays silent — messages still arrive via the poll when the app is open.
//
// Dead subscriptions (404/410 from the push service — user revoked, iOS
// evicted, PWA uninstalled) are pruned from Cosmos on the spot.

const { CosmosClient } = require("@azure/cosmos");
const webpush = require("web-push");

const client    = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database  = client.database("Auditdata");
const container = database.container("Audits");

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ||
  'BIQ1puaCqO_nwUIVMG5QRg_iHBsZvPY1b8g-R0-Y1Z1YFrWAVFld-K41iEViuRh4uofDPCaJrrR-X7SrzFHjrj8';

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!priv) {
    context.log.warn("[sendPush] VAPID_PRIVATE_KEY not configured — push disabled");
    context.res.status = 200;
    context.res.body   = { ok: false, reason: "push-not-configured" };
    return;
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:mathews.austin27@gmail.com',
    VAPID_PUBLIC_KEY,
    priv
  );

  const body = req.body || {};
  const to   = (body.to || '').trim();
  const msg  = String(body.msg || '').trim().slice(0, 500);
  if (!to || !msg) {
    context.res.status = 400;
    context.res.body   = { ok: false, error: "to and msg required" };
    return;
  }

  try {
    // ── Collect target subscription docs ──────────────────────────────────
    let subs = [];
    if (to === '*') {
      const { resources } = await container.items
        .query({ query: "SELECT * FROM c WHERE c.type = 'push-sub'" })
        .fetchAll();
      // Broadcast shouldn't buzz the admin device that sent it
      subs = resources.filter(d => d.deviceId !== body.fromDeviceId);
    } else {
      try {
        const { resource } = await container.item(`adh-push-${to}`, `adh-push-${to}`).read();
        if (resource) subs = [resource];
      } catch (e) { if (e.code !== 404) throw e; }
    }

    if (!subs.length) {
      context.res.status = 200;
      context.res.body   = { ok: true, sent: 0, reason: "no-subscriptions" };
      return;
    }

    const payload = JSON.stringify({
      title: '📣 ' + (body.from || 'Admin'),
      body:  msg,
      tag:   body.id || undefined,
      url:   '/'
    });

    // ── Send to every target; prune subscriptions the push service rejects ─
    let sent = 0, pruned = 0;
    await Promise.all(subs.map(async doc => {
      try {
        await webpush.sendNotification(doc.subscription, payload, { TTL: 24 * 3600, urgency: 'high' });
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          try { await container.item(doc.id, doc.id).delete(); pruned++; }
          catch (e) { /* already gone */ }
        } else {
          context.log.warn(`[sendPush] ${doc.deviceId}: ${err.statusCode || ''} ${err.message}`);
        }
      }
    }));

    context.log(`[sendPush] ✓ to:${to} sent:${sent} pruned:${pruned}`);
    context.res.status = 200;
    context.res.body   = { ok: true, sent, pruned };

  } catch (error) {
    context.log.error("[sendPush] Error:", error.message);
    context.res.status = 500;
    context.res.body   = { ok: false, error: error.message };
  }
};
