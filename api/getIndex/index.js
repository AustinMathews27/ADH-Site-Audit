// api/getIndex/index.js
// GET /api/getIndex?userId={userId}
//
// Returns the per-user index document: folders, contacts, settings, projectIds[].
// Each user gets their own isolated document — adh-index-{userId}.
// Falls back to adh-index-v1 for legacy data if the user index doesn't exist yet.

const { CosmosClient } = require("@azure/cosmos");

const client    = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database  = client.database("Auditdata");
const container = database.container("Audits");

// Presence heartbeats are stored beside the index, in adh-presence-{userId}
// (see saveIndex), so they don't rewrite the index every few minutes. Fold
// them back into `devices` whenever the full index is returned: per device,
// the newest lastSeen wins and fields only the older copy has (v, host) stay.
async function withPresence(resource, userId) {
  const presId = userId ? `adh-presence-${userId}` : 'adh-presence-v1';
  let pres = null;
  try { pres = (await container.item(presId, presId).read()).resource; }
  catch (e) { /* none yet, or transient — the index's own devices still go out */ }
  if (!pres || !pres.devices) return resource;
  const devices = Object.assign({}, resource.devices || {});
  Object.entries(pres.devices).forEach(([id, d]) => {
    const cur = devices[id];
    devices[id] = !cur ? d
      : ((d.lastSeen || 0) >= (cur.lastSeen || 0) ? Object.assign({}, cur, d) : Object.assign({}, d, cur));
  });
  return Object.assign({}, resource, { devices });
}

module.exports = async function (context, req) {
  const userId  = (req.query.userId || '').trim();
  const indexId = userId ? `adh-index-${userId}` : 'adh-index-v1';

  try {
    let resource;

    // Try user-specific index first
    try {
      const result = await container.item(indexId, indexId).read();
      resource = result.resource;
    } catch (e) {
      if (e.code !== 404) throw e;
      resource = null;
    }

    // First-time user: try migrating from the legacy shared index
    if (!resource && userId) {
      try {
        const legacy = await container.item('adh-index-v1', 'adh-index-v1').read();
        if (legacy.resource) {
          // Return legacy data so client can bootstrap — client will save it
          // under the user-scoped key on next saveIndex call
          context.res = {
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: { ...legacy.resource, id: indexId, _migratedFromLegacy: true }
          };
          return;
        }
      } catch (legacyErr) { /* no legacy data either — fresh start */ }
    }

    if (!resource) {
      context.res = {
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: { error: "Index not found" }
      };
      return;
    }

    // Conditional fetch: ?ifEtag=<_etag of the last merged copy> (or the older
    // ?ifTs=<last merged _ts>) lets the 15s poll skip re-downloading an
    // unchanged index (only when the user doc exists — the 404/legacy-migration
    // branches above are untouched). _etag catches two saves in one second.
    const ifEtag = req.query.ifEtag;
    const ifTs = Number(req.query.ifTs);
    if (ifEtag ? resource._etag === ifEtag
               : (Number.isFinite(ifTs) && ifTs > 0 && (resource._ts || 0) <= ifTs)) {
      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: { notModified: true, _ts: resource._ts }
      };
      return;
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: await withPresence(resource, userId)
    };

  } catch (error) {
    context.log.error("[getIndex] Error:", error.message);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { error: error.message }
    };
  }
};
