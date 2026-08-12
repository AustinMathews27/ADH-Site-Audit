// api/savePushSub/index.js
// POST /api/savePushSub
// Body: { deviceId, user, label, subscription }  — upsert this device's Web Push subscription
//       { deviceId, remove: true }               — device unsubscribed; delete the doc
//
// One document per device — adh-push-{deviceId} — so concurrent devices can
// never conflict (each writes only its own doc; no ETag dance needed).
// The client re-posts on every launch: iOS silently revokes subscriptions
// (ignored notifications, PWA reinstall), so the doc is kept fresh rather
// than written once.

const { CosmosClient } = require("@azure/cosmos");

const client    = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database  = client.database("Auditdata");
const container = database.container("Audits");

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const body     = req.body || {};
  const deviceId = (body.deviceId || '').trim();
  if (!deviceId || !/^[\w-]{4,64}$/.test(deviceId)) {
    context.res.status = 400;
    context.res.body   = { ok: false, error: "Valid deviceId required" };
    return;
  }
  const docId = `adh-push-${deviceId}`;

  try {
    if (body.remove) {
      try { await container.item(docId, docId).delete(); }
      catch (e) { if (e.code !== 404) throw e; }
      context.res.status = 200;
      context.res.body   = { ok: true, removed: true };
      return;
    }

    const sub = body.subscription;
    if (!sub || !sub.endpoint || !/^https:\/\//.test(sub.endpoint)) {
      context.res.status = 400;
      context.res.body   = { ok: false, error: "Valid subscription required" };
      return;
    }

    await container.items.upsert({
      id:           docId,
      type:         'push-sub',
      deviceId:     deviceId,
      user:         String(body.user  || '').slice(0, 40),
      label:        String(body.label || '').slice(0, 40),
      subscription: { endpoint: sub.endpoint, expirationTime: sub.expirationTime || null, keys: sub.keys || {} },
      updatedAt:    Date.now()
    });

    context.log(`[savePushSub] ✓ ${docId}`);
    context.res.status = 200;
    context.res.body   = { ok: true };

  } catch (error) {
    context.log.error("[savePushSub] Error:", error.message);
    context.res.status = 500;
    context.res.body   = { ok: false, error: error.message };
  }
};
