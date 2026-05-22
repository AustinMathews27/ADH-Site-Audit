// api/saveIndex/index.js
// POST /api/saveIndex
// Body: { userId, folders, contacts, settings, projectIds, _savedAt }
//
// Saves the per-user index document — adh-index-{userId}.
// ETag-based optimistic concurrency with up to 5 retries.
// Two users can never conflict because they write to separate documents.

const { CosmosClient } = require("@azure/cosmos");

const client      = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database    = client.database("Auditdata");
const container   = database.container("Audits");
const MAX_RETRIES = 5;

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (req.method === "OPTIONS") {
    context.res = { status: 204, body: "" };
    return;
  }

  if (!req.body) {
    context.res.status = 400;
    context.res.body   = { ok: false, error: "Request body required" };
    return;
  }

  const incoming = req.body;
  const userId   = (incoming.userId || '').trim();
  const INDEX_ID = userId ? `adh-index-${userId}` : 'adh-index-v1';

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

      // ── 2. Merge folders by ID — incoming wins on conflict ────────────────
      const folderMap = new Map((current.folders || []).map(f => [f.id, f]));
      (incoming.folders || []).forEach(f => folderMap.set(f.id, f));

      // ── 3. Merge contacts with tombstone respect ──────────────────────────
      const contactMap = new Map((current.contacts || []).map(c => [c.id, c]));
      (incoming.contacts || []).forEach(c => {
        const existing = contactMap.get(c.id);
        if (existing && existing._deleted && !c._deleted) {
          const existTs = (existing._fieldTs && existing._fieldTs._deleted) || existing._deletedAt || 0;
          const incTs   = (c._fieldTs && c._fieldTs._deleted) || 0;
          if (incTs > existTs) contactMap.set(c.id, c);
        } else {
          contactMap.set(c.id, c);
        }
      });

      // ── 4. Merge projectIds (union of both sides) ─────────────────────────
      const allProjectIds = new Set([
        ...(current.projectIds  || []),
        ...(incoming.projectIds || [])
      ]);

      // ── 5. Settings: incoming wins ────────────────────────────────────────
      const mergedSettings = Object.assign({}, current.settings || {}, incoming.settings || {});

      const updated = {
        id:         INDEX_ID,
        userId:     userId,
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

      context.log(`[saveIndex] ✓ ${INDEX_ID} folders:${updated.folders.length} projects:${updated.projectIds.length}`);
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
