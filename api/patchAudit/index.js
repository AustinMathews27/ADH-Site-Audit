// api/patchAudit/index.js
// POST /api/patchAudit
// Body: { patch: { ...fields to deep-merge into the store } }
//
// This is the KEY fix for the "users overwrite each other" bug.
// Instead of replacing the whole document, we:
//   1. Read current document from Cosmos (with its ETag)
//   2. Deep-merge ONLY the fields sent in the request
//   3. Write back using optimistic concurrency (ETag check)
//   4. Retry up to 5x if two users saved at the exact same moment
//
// This means User A changing project status and User B changing notes
// will BOTH survive — neither overwrites the other.

const { CosmosClient } = require("@azure/cosmos");

const client    = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database  = client.database("Auditdata");
const container = database.container("Audits");

const DOC_ID = "adh-store-v1";

function deepMerge(target, patch) {
  for (const key of Object.keys(patch)) {
    const pVal = patch[key];
    const tVal = target[key];
    if (pVal !== null && typeof pVal === "object" && !Array.isArray(pVal) &&
        tVal !== null && typeof tVal === "object" && !Array.isArray(tVal)) {
      deepMerge(tVal, pVal);
    } else {
      target[key] = pVal;
    }
  }
  return target;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!req.body || !req.body.patch) {
    context.res.status = 400;
    context.res.body   = { ok: false, error: "Body must contain { patch: {...} }" };
    return;
  }

  const incoming = req.body.patch;
  const MAX_RETRIES = 5;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      let current, etag;
      try {
        const { resource } = await container.item(DOC_ID, DOC_ID).read();
        current = resource;
        etag    = resource._etag;
      } catch (readErr) {
        if (readErr.code === 404) {
          current = { id: DOC_ID };
          etag    = null;
        } else {
          throw readErr;
        }
      }

      const updated = deepMerge(JSON.parse(JSON.stringify(current)), incoming);
      updated._savedAt = Date.now();

      const writeOpts = etag
        ? { accessCondition: { type: "IfMatch", condition: etag } }
        : {};

      const { resource: saved } = await container.items.upsert(updated, writeOpts);

      context.res.status = 200;
      context.res.body   = { ok: true, _savedAt: saved._savedAt, _ts: saved._ts };
      return;

    } catch (err) {
      if (err.code === 412 && attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 60 * attempt));
        continue;
      }
      context.log.error("[patchAudit] Error:", err.message);
      context.res.status = err.code === 412 ? 409 : 500;
      context.res.body   = { ok: false, error: err.message };
      return;
    }
  }
};
