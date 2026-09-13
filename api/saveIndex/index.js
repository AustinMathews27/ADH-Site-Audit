// api/saveIndex/index.js
// POST /api/saveIndex
// Body: { userId, folders, contacts, settings, projectIds, projectTombstones, folderTombstones, _savedAt }
//
// Saves the per-user index document — adh-index-{userId}.
// ETag-based optimistic concurrency with up to 5 retries.
// Two users can never conflict because they write to separate documents.
//
// projectTombstones: { projectId: deletedAtEpochMs }
// Deletion is tracked with tombstones so projectIds can be merged as a union
// without deleted (or orphaned) IDs re-entering the index forever. Tombstones
// are GC'd after TOMBSTONE_TTL_MS — by then every device has synced them.

const { requireUser } = require('../_shared/auth');
const { CosmosClient } = require("@azure/cosmos");

const client      = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
// COSMOS_DB_DATABASE lets a staging environment point at its own database (Auditdata-dev)
const database    = client.database(process.env.COSMOS_DB_DATABASE || "Auditdata");
const container   = database.container("Audits");
const MAX_RETRIES = 5;

// Project/contact tombstones older than this are garbage-collected.
// 90 days is far beyond any realistic device-offline window.
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Max project docs read per save to catch deleted docs whose index tombstone
// is missing (see step 5b).
const MAX_DOC_CHECKS = 40;

module.exports = async function (context, req) {
  // Sign-in is enforced at the edge; this parses the caller and applies the
  // optional ALLOWED_EMAIL_DOMAINS allow-list (see api/_shared/auth.js).
  if (!requireUser(context, req)) return;

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

      // ── 2a. Merge folder tombstones (newest timestamp wins), then GC ──────
      // Folders are merged as a map on both sides, so — exactly like
      // projectIds — a tombstone is the ONLY way a folder ever leaves the
      // cloud index. Without this, deleting a folder can never propagate.
      const folderTombstones = Object.assign({}, current.folderTombstones || {});
      Object.entries(incoming.folderTombstones || {}).forEach(([id, ts]) => {
        if (!folderTombstones[id] || ts > folderTombstones[id]) folderTombstones[id] = ts;
      });
      const gcCutoff = Date.now() - TOMBSTONE_TTL_MS;
      Object.keys(folderTombstones).forEach(id => {
        if (folderTombstones[id] < gcCutoff) delete folderTombstones[id];
      });

      // ── 2b. Merge folders by ID — per-folder newest-wins via _modified ────
      // (legacy folders without a stamp keep the old incoming-wins behavior),
      // then drop tombstoned folders.
      const folderMap = new Map((current.folders || []).map(f => [f.id, f]));
      (incoming.folders || []).forEach(f => {
        const cur = folderMap.get(f.id);
        if (!cur || (f._modified || 0) >= (cur._modified || 0)) folderMap.set(f.id, f);
      });
      Object.keys(folderTombstones).forEach(id => folderMap.delete(id));

      // ── 3. Merge contacts with tombstone respect ──────────────────────────
      const contactMap = new Map((current.contacts || []).map(c => [c.id, c]));
      (incoming.contacts || []).forEach(c => {
        const existing = contactMap.get(c.id);
        if (existing && existing._deleted && !c._deleted) {
          const existTs = (existing._fieldTs && existing._fieldTs._deleted) || existing._deletedAt || 0;
          const incTs   = (c._fieldTs && c._fieldTs._deleted) || 0;
          if (incTs > existTs) contactMap.set(c.id, c);
        } else if (existing && !existing._deleted && !c._deleted) {
          // Per-contact newest-wins via _modified (same as folders) so a
          // stale device's copy can't overwrite a fresh edit; unstamped
          // legacy contacts keep the old incoming-wins behavior.
          if ((c._modified || 0) >= (existing._modified || 0)) contactMap.set(c.id, c);
        } else {
          contactMap.set(c.id, c);
        }
      });

      // ── 4. Merge project tombstones (newest timestamp wins) ───────────────
      const tombstones = Object.assign({}, current.projectTombstones || {});
      Object.entries(incoming.projectTombstones || {}).forEach(([id, ts]) => {
        if (!tombstones[id] || ts > tombstones[id]) tombstones[id] = ts;
      });

      // ── 5. Merge projectIds (union of both sides, minus tombstoned) ───────
      // The union means an ID can never drop out through a stale save from an
      // out-of-date device; the tombstone filter is the only removal path.
      const allProjectIds = new Set([
        ...(current.projectIds  || []),
        ...(incoming.projectIds || [])
      ]);

      // 5a. GC old tombstones — but NEVER while the id is still on either side.
      // Before v8.54 a tombstone expired after 90 days no matter what, so an id
      // kept alive by a stale device sat in the union forever once its
      // tombstone was gone, and every device fetched the dead doc on startup.
      const tombstoneCutoff = Date.now() - TOMBSTONE_TTL_MS;
      Object.keys(tombstones).forEach(id => {
        if (tombstones[id] < tombstoneCutoff && !allProjectIds.has(id)) delete tombstones[id];
      });

      // 5b. Ids the pushing device does NOT list as live and that carry no
      // tombstone: ask the project doc itself. A `_deleted` doc means the
      // delete happened but its index tombstone never existed (pre-tombstone-
      // era deletes) or expired — mint one now so the id finally leaves the
      // union. Reads are bounded per save; normally there are 0–1 such ids
      // (a project just created on another device). A 404 is left alone —
      // the client's orphan self-heal owns that case.
      const incomingIds = new Set(incoming.projectIds || []);
      const suspects = [...allProjectIds].filter(id => !incomingIds.has(id) && !tombstones[id]);
      if (suspects.length) {
        const start = Math.floor(Math.random() * suspects.length);   // rotate so repeated saves cover all
        const batch = suspects.slice(start).concat(suspects.slice(0, start)).slice(0, MAX_DOC_CHECKS);
        await Promise.all(batch.map(async id => {
          try {
            const { resource: doc } = await container.item('adh-proj-' + id, 'adh-proj-' + id).read();
            if (doc && doc._deleted) {
              tombstones[id] = Date.now();   // fresh stamp: 90 more days of protection against stale pushes
              context.log(`[saveIndex] ${id} doc is deleted — tombstoned in index`);
            }
          } catch (e) { /* 404 or transient — leave the id alone */ }
        }));
      }
      Object.keys(tombstones).forEach(id => allProjectIds.delete(id));

      // ── 6. GC old contact tombstones (same TTL as project tombstones) ─────
      const liveContacts = [...contactMap.values()].filter(c => {
        if (!c._deleted) return true;
        const ts = (c._fieldTs && c._fieldTs._deleted) || c._deletedAt || 0;
        return ts > tombstoneCutoff;
      });

      // ── 6b. Merge device presence — per-device newest lastSeen wins ───────
      // devices: { deviceId: { user, label, lastSeen } } — heartbeats from
      // each install. GC devices silent for 90 days.
      const devices = Object.assign({}, current.devices || {});
      Object.entries(incoming.devices || {}).forEach(([id, d]) => {
        const cur = devices[id];
        if (!cur || (d.lastSeen || 0) >= (cur.lastSeen || 0)) devices[id] = d;
      });
      Object.keys(devices).forEach(id => {
        if ((devices[id].lastSeen || 0) < tombstoneCutoff) delete devices[id];
      });

      // ── 6c. Merge notifications by id — read state is monotonic ───────────
      // notifications: [{ id, to, toName, msg, from, createdAt, readAt, readBy }]
      // GC: read >7 days ago, or unread but >30 days old.
      const NOTIF_READ_TTL   = 7  * 24 * 60 * 60 * 1000;
      const NOTIF_UNREAD_TTL = 30 * 24 * 60 * 60 * 1000;
      const notifMap = new Map((current.notifications || []).map(n => [n.id, n]));
      (incoming.notifications || []).forEach(n => {
        const cur = notifMap.get(n.id);
        if (!cur) { notifMap.set(n.id, n); return; }
        // Once read, stays read (keep the earliest read receipt)
        if (cur.readAt && !n.readAt) return;
        if (n.readAt && !cur.readAt) { notifMap.set(n.id, n); return; }
        notifMap.set(n.id, n);
      });
      const notifNow = Date.now();
      const notifications = [...notifMap.values()].filter(n =>
        n.readAt ? (notifNow - n.readAt) < NOTIF_READ_TTL
                 : (notifNow - (n.createdAt || 0)) < NOTIF_UNREAD_TTL);

      // ── 7. Settings: incoming wins ────────────────────────────────────────
      const mergedSettings = Object.assign({}, current.settings || {}, incoming.settings || {});

      const updated = {
        // Readable identity first — Cosmos keeps property order, so this is
        // the first thing shown when the doc is opened in Data Explorer.
        docType:           'index',
        label:             `INDEX · shared workspace · ${[...allProjectIds].length} projects · ${folderMap.size} folders · ${liveContacts.length} contacts`,
        id:                INDEX_ID,
        userId:            userId,
        folders:           [...folderMap.values()],
        contacts:          liveContacts,
        settings:          mergedSettings,
        projectIds:        [...allProjectIds],
        projectTombstones: tombstones,
        folderTombstones:  folderTombstones,
        devices:           devices,
        notifications:     notifications,
        _savedAt:          incoming._savedAt || Date.now()
      };

      // ── 8. Write with ETag guard ──────────────────────────────────────────
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
