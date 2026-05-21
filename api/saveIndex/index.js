// api/saveIndex/index.js
// POST /api/saveIndex
// Body: { folders, contacts, settings, projectIds, _savedAt }
//
// Saves the shared index document with ETag-based optimistic concurrency.
// Merges by ID so concurrent saves from different devices both survive.
// Up to 5 retries on ETag conflict (412).

const { CosmosClient } = require("@azure/cosmos");

const client    = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database  = client.database("Auditdata");
const container = database.container("Audits");
const INDEX_ID  = "adh-index-v1";
const MAX_RETRIES = 5;

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (req.method === "OPTIONS") {
    context.res = { status: 204, body: "" };
    return;
  }

  if (!req.body) {
    context.res.status = 400;
    context.res.body = { ok: false, error: "Request body required" };
    return;
  }

  const incoming = req.body;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // ── 1. Read current index + ETag ──────────────────────────────────────
      let current, etag;
      try {
        const { resource } = await container.item(INDEX_ID, INDEX_ID).read();
        if (!resource) { current = { id: INDEX_ID }; etag = null; }
        else           { current = resource;          etag = resource._etag; }
      } catch (e) {
        if (e.code === 404) { current = { id: INDEX_ID }; etag = null; }
        else throw e;
      }

      // ── 2. Merge folders by ID (union of both sides) ──────────────────────
      // Incoming wins for IDs that exist on both sides.
      // IDs that only exist on current are kept (created by other devices).
      const folderMap = new Map((current.folders || []).map(f => [f.id, f]));
      (incoming.folders || []).forEach(f => folderMap.set(f.id, f));

      // ── 3. Merge contacts by ID with tombstone respect ────────────────────
      const contactMap = new Map((current.contacts || []).map(c => [c.id, c]));
      (incoming.contacts || []).forEach(c => {
        const existing = contactMap.get(c.id);
        if (existing) {
          // Tombstone wins — deleted beats any update
          if (existing._deleted && !c._deleted) {
            // Keep the tombstone unless incoming has a newer _fieldTs._deleted
            const existTs = (existing._fieldTs && existing._fieldTs._deleted) || existing._deletedAt || 0;
            const incTs   = (c._fieldTs && c._fieldTs._deleted) || 0;
            if (incTs > existTs) contactMap.set(c.id, c); // newer explicit delete wins
            // else keep existing tombstone
          } else {
            contactMap.set(c.id, c); // normal update wins
          }
        } else {
          contactMap.set(c.id, c);
        }
      });

      // ── 4. Merge projectIds (union) ───────────────────────────────────────
      const allProjectIds = new Set([
        ...(current.projectIds || []),
        ...(incoming.projectIds || [])
      ]);

      // ── 5. Settings: incoming wins (last writer) ──────────────────────────
      const mergedSettings = Object.assign({}, current.settings || {}, incoming.settings || {});

      const updated = {
        id:         INDEX_ID,
        folders:    [...folderMap.values()],
        contacts:   [...contactMap.values()],
        settings:   mergedSettings,
        projectIds: [...allProjectIds],
        _savedAt:   incoming._savedAt || Date.now()
      };

      // ── 6. Write with ETag guard ──────────────────────────────────────────
      const upsertOptions = etag
        ? { accessCondition: { type: "IfMatch", condition: etag } }
        : {};

      const { resource: saved } = await container.items.upsert(updated, upsertOptions);

      context.log(`[saveIndex] ✓ Saved (attempt ${attempt}). folders:${updated.folders.length} contacts:${updated.contacts.length} projects:${updated.projectIds.length}`);
      context.res.status = 200;
      context.res.body   = { ok: true, _ts: saved._ts, _savedAt: saved._savedAt };
      return;

    } catch (err) {
      if (err.code === 412 && attempt < MAX_RETRIES) {
        context.log.warn(`[saveIndex] ETag conflict, retrying (${attempt}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, 80 * attempt));
        continue;
      }
      context.log.error("[saveIndex] Error:", err.message);
      context.res.status = err.code === 412 ? 409 : 500;
      context.res.body   = { ok: false, error: err.message };
      return;
    }
  }
};
