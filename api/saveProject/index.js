// api/saveProject/index.js
// POST /api/saveProject
// Body: { project: { id, name, sections, items, schedule, ... } }
//
// Saves one project as its own independent Cosmos document.
// Document ID: "adh-proj-{project.id}"
//
// Concurrent edits to DIFFERENT projects never conflict — they hit
// completely separate documents with separate ETags.
//
// Concurrent edits to the SAME project are handled with:
//   - ETag optimistic concurrency (up to 5 retries on 412)
//   - Item-level merge: two supers editing different SI items both survive
//   - Dirty-flag guard: items flagged _dirty on the server are not overwritten
//     by stale incoming data (last-modified-wins per item)

const { CosmosClient } = require("@azure/cosmos");
const https = require("https");

// Enforce TCP connection reuse to prevent socket exhaustion
const keepAliveAgent = new https.Agent({ keepAlive: true });

const client    = new CosmosClient({
  connectionString: process.env.COSMOS_DB_CONNECTION_STRING,
  agent: keepAliveAgent
});
// COSMOS_DB_DATABASE lets a staging environment point at its own database (Auditdata-dev)
const database  = client.database(process.env.COSMOS_DB_DATABASE || "Auditdata");
const container = database.container("Audits");
const MAX_RETRIES = 5;

// Tombstoned scope items are garbage-collected from project docs after this.
// 60 days is far beyond any realistic device-offline window.
const ITEM_TOMBSTONE_TTL_MS = 60 * 24 * 60 * 60 * 1000;

// Cosmos DB hard limit: 2 MB per document. Measured against this API on
// 2026-09-12: a project saves up to ~1,024 typical scope items (~2 KB each:
// notes, 3 photo URLs, timestamps) or ~488 photo-heavy items (~4 KB each);
// the 2,097,152-byte mark is exact. Checked BEFORE the upsert so the client
// gets a clear 413 + byte count instead of Cosmos's generic "Request size is
// too large" wrapped in a 500.
const COSMOS_DOC_LIMIT = 2 * 1024 * 1024;

// Photo tombstones are keyed by the blob FILENAME ("<ts>-<rand>.jpg"), not the
// full URL: the filename alone is unique and ~25 bytes instead of ~130. In the
// largest real project the tombstone map was half the document (159 KB).
// Readers accept either form (older clients still write full URLs); the union
// below collapses old keys to the short form on every merge.
const tombKey = u => { const s = String(u || ''); return s.slice(s.lastIndexOf('/') + 1) || s; };
const tombHit = (tomb, u) => !!(tomb && u && (tomb[u] || tomb[tombKey(u)]));

// Human-readable identity at the TOP of every project document. Cosmos keeps
// property order, so opening a doc in Data Explorer shows the label first —
// and `SELECT c.id, c.label FROM c WHERE c.docType = 'project'` lists them.
function labelFor(doc) {
  const name  = String(doc.name || '(unnamed)').trim();
  if (doc._deleted) return `DELETED · ${name}`;
  const live  = (doc.items || []).filter(i => !i._deleted).length;
  const parts = [name];
  if (doc.client && doc.client !== '—') parts.push(String(doc.client).trim());
  parts.push(`${live} SI`);
  return parts.join(' · ');
}
function withLabel(doc) {
  const { docType: _d, label: _l, ...rest } = doc;
  return { docType: doc._deleted ? 'project-deleted' : 'project', label: labelFor(doc), ...rest };
}

// ── Per-field timestamp merge ─────────────────────────────────────────────────
// If both sides have a _fieldTs for a key, the newer timestamp wins.
// Falls back to "incoming wins" when timestamps are absent.
function mergeFields(current, incoming) {
  const cTs = current._fieldTs  || {};
  const iTs = incoming._fieldTs || {};
  const result = Object.assign({}, current);

  Object.keys(incoming).forEach(k => {
    if (k === "_fieldTs") return;
    const cTime = cTs[k];
    const iTime = iTs[k];
    if (cTime !== undefined && iTime !== undefined && cTime > iTime) {
      // Current is newer on this field — keep it
      return;
    }
    result[k] = incoming[k];
  });

  // Merge fieldTs maps — keep the max per field
  if (iTs && Object.keys(iTs).length) {
    const merged = Object.assign({}, cTs);
    Object.keys(iTs).forEach(k => {
      if (merged[k] === undefined || iTs[k] > merged[k]) merged[k] = iTs[k];
    });
    result._fieldTs = merged;
  }

  return result;
}

// ── Item-level merge ──────────────────────────────────────────────────────────
// Merges incoming items into the current item list.
// For items that exist on both sides, field-level timestamps resolve conflicts.
// Items only on the current side are kept (created by another device offline).
// Items only on the incoming side are added.
// Photos are NEVER stored in Cosmos — always strip them from incoming.
function mergeItems(currentItems, incomingItems) {
  const currentMap  = new Map((currentItems  || []).map(i => [i.id, i]));
  const incomingMap = new Map((incomingItems || []).map(i => [i.id, i]));

  // Process incoming items
  incomingMap.forEach((incoming, id) => {
    const cur = currentMap.get(id);

    // Photo tombstones (url → deletedAt): union of both sides, newest wins,
    // GC'd with the same TTL as item tombstones. A tombstoned URL is excluded
    // from BOTH photo lists below — without this, the keep-cloud-photos
    // safety net resurrects deliberately deleted photos on every push.
    // Keys are normalised to the short filename form here (see tombKey).
    const tomb = {};
    [(cur && cur.photoTombstones) || {}, incoming.photoTombstones || {}].forEach(m =>
      Object.entries(m).forEach(([u, ts]) => {
        const k = tombKey(u);
        if (!tomb[k] || ts > tomb[k]) tomb[k] = ts;
      }));
    const tombCutoff = Date.now() - ITEM_TOMBSTONE_TTL_MS;
    Object.keys(tomb).forEach(u => { if (tomb[u] < tombCutoff) delete tomb[u]; });

    // Always strip photos from what gets written to Cosmos —
    // photos live in IndexedDB on the client, Azure Blob for URLs.
    const incomingClean = Object.assign({}, incoming, {
      photos: (incoming.photos || [])
        .filter(p => p.url && !tombHit(tomb, p.url))
        .map(p => ({ url: p.url, caption: p.caption || "", takenAt: p.takenAt || "" })),
      attachments: (incoming.attachments || [])
        .map(a => ({
          id: a.id, name: a.name, type: a.type, ext: a.ext,
          icon: a.icon, size: a.size, addedAt: a.addedAt, addedBy: a.addedBy
        }))
    });
    if (Object.keys(tomb).length) incomingClean.photoTombstones = tomb;
    else delete incomingClean.photoTombstones;

    if (cur) {
      // Merge field by field — field timestamps resolve conflicts
      const merged = mergeFields(cur, incomingClean);
      // Preserve any cloud-URL photos already on the current side
      // that the client didn't send back (it strips base64, keeps URLs)
      const currentUrlPhotos = (cur.photos || []).filter(p => p.url && !tombHit(tomb, p.url));
      const incomingUrls = new Set((incomingClean.photos || []).map(p => p.url));
      const extraPhotos = currentUrlPhotos.filter(p => !incomingUrls.has(p.url));
      merged.photos = [...(incomingClean.photos || []), ...extraPhotos];
      if (Object.keys(tomb).length) merged.photoTombstones = tomb;
      else delete merged.photoTombstones;
      currentMap.set(id, merged);
    } else {
      // New item — just add it
      currentMap.set(id, incomingClean);
    }
  });

  // Output follows the INCOMING array's order (drag-reorder on the pushing
  // device must propagate — Map insertion order would freeze the old cloud
  // order forever); items only on the current side (created by another
  // device) are appended after.
  const out = [];
  const emitted = new Set();
  (incomingItems || []).forEach(i => {
    const m = currentMap.get(i.id);
    if (m && !emitted.has(i.id)) { out.push(m); emitted.add(i.id); }
  });
  currentMap.forEach((v, id) => { if (!emitted.has(id)) out.push(v); });
  return out;
}

// Environmental screenshots are stored as base64 on the device only — never
// let them into Cosmos (a couple of phone screenshots exceed the 2MB doc
// limit and permanently break the project's sync).
function stripEnvScreens(env) {
  if (!env || !Array.isArray(env.screenshots)) return env;
  return Object.assign({}, env, {
    screenshots: env.screenshots.map(sc => {
      const c = Object.assign({}, sc);
      delete c.data;
      return c;
    })
  });
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (req.method === "OPTIONS") {
    context.res = { status: 204, body: "" };
    return;
  }

  if (!req.body || !req.body.project) {
    context.res.status = 400;
    context.res.body   = { ok: false, error: "Body must contain { project: { id, ... } }" };
    return;
  }

  const incoming = req.body.project;

  if (!incoming.id || typeof incoming.id !== "string") {
    context.res.status = 400;
    context.res.body   = { ok: false, error: "project.id is required" };
    return;
  }

  // Sanitize project ID
  if (!/^[a-zA-Z0-9_-]+$/.test(incoming.id)) {
    context.res.status = 400;
    context.res.body   = { ok: false, error: "Invalid project ID format" };
    return;
  }

  const docId = "adh-proj-" + incoming.id;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // ── 1. Read current document + ETag ────────────────────────────────────
      let current, etag;
      try {
        const { resource } = await container.item(docId, docId).read();
        if (!resource) { current = null; etag = null; }
        else           { current = resource; etag = resource._etag; }
      } catch (e) {
        if (e.code === 404) { current = null; etag = null; }
        else throw e;
      }

      // ── 2. Build the document to write ─────────────────────────────────────
      let docToWrite;

      // Deletion is monotonic: once a project doc is tombstoned it can never
      // be resurrected by a stale push from a device that missed the delete.
      // Return ok so the pusher clears its dirty flag and moves on.
      if (current && current._deleted) {
        context.log(`[saveProject] ${incoming.id} is tombstoned — ignoring push`);
        context.res.status = 200;
        context.res.body   = { ok: true, _ts: current._ts, _savedAt: current._savedAt, tombstone: true };
        return;
      }

      // Incoming deletion — replace the doc with a minimal tombstone.
      // Items/schedule/photos are dropped: every device that polls or pulls
      // sees _deleted and tombstones its local copy; the index tombstone
      // (saveIndex) removes the ID from projectIds so it is never fetched
      // on startup again.
      if (incoming._deleted) {
        // Treat a missing incoming.ownedBy as a mismatch — otherwise omitting
        // the field bypasses the guard entirely.
        if (current && current.ownedBy && incoming.ownedBy !== current.ownedBy) {
          context.log.warn(`[saveProject] Delete rejected on ${incoming.id}: owner=${current.ownedBy} requester=${incoming.ownedBy}`);
          context.res.status = 403;
          context.res.body   = { ok: false, error: "Forbidden — you do not own this project." };
          return;
        }
        const deletedAt = incoming._deletedAt || Date.now();
        docToWrite = {
          id:         docId,
          projectId:  incoming.id,
          ownedBy:    (current && current.ownedBy) || incoming.ownedBy || '',
          name:       incoming.name || (current && current.name) || '',
          _deleted:   true,
          _deletedAt: deletedAt,
          _fieldTs:   { _deleted: deletedAt },
          _savedAt:   incoming._savedAt || Date.now()
        };
      } else if (!current) {
        // Brand new project — write it directly (strip photos from items)
        docToWrite = Object.assign({}, incoming, {
          id:        docId,        // Cosmos document ID
          projectId: incoming.id,  // Original app-level ID preserved here
          ownedBy:   incoming.ownedBy || '',  // User identity — never overwritten
          items: mergeItems([], incoming.items || []),
          // Cover photos sync as Blob-storage URLs; only base64 stays out of Cosmos
          coverPhoto: (incoming.coverPhoto && !String(incoming.coverPhoto).startsWith('data:'))
            ? incoming.coverPhoto : null,
          envData: stripEnvScreens(incoming.envData),
          floorPlan: incoming.floorPlan
            ? Object.assign({}, incoming.floorPlan, { imageData: null })
            : undefined,
          _savedAt: incoming._savedAt || Date.now()
        });
      } else {
        // Existing project — merge carefully.
        // ownedBy is immutable once set — never let incoming overwrite it
        // unless the current doc has no owner yet (legacy migration).
        const ownedBy = current.ownedBy || incoming.ownedBy || '';

        // Safety guard: if the project already has an owner and the incoming
        // request is from a different user, reject the write.
        // Missing incoming.ownedBy counts as a mismatch — see delete guard.
        if (current.ownedBy && incoming.ownedBy !== current.ownedBy) {
          context.log.warn(`[saveProject] Ownership mismatch on ${incoming.id}: owner=${current.ownedBy} requester=${incoming.ownedBy}`);
          context.res.status = 403;
          context.res.body   = { ok: false, error: "Forbidden — you do not own this project." };
          return;
        }

        docToWrite = Object.assign({}, current, incoming, {
          id:        docId,
          projectId: incoming.id,
          ownedBy:   ownedBy,  // Preserve original owner
          items:     mergeItems(current.items || [], incoming.items || []),
          // Preserve blob-URL covers (the client uploads then pushes the URL);
          // base64 never enters Cosmos, and a data: push keeps the stored URL.
          coverPhoto: (incoming.coverPhoto && !String(incoming.coverPhoto).startsWith('data:'))
            ? incoming.coverPhoto
            : (incoming.coverPhoto === null ? null : (current.coverPhoto || null)),
          envData: incoming.envData ? stripEnvScreens(incoming.envData) : (current.envData || undefined),
          floorPlan: incoming.floorPlan
            ? Object.assign({}, incoming.floorPlan, { imageData: null })
            : (current.floorPlan || undefined),
          _savedAt: incoming._savedAt || Date.now()
        });
      }

      // ── 2b. GC scope-item tombstones ────────────────────────────────────────
      // Deleted items ride along as {_deleted:true} so removal syncs to other
      // devices. After the TTL every device has seen the tombstone — drop it
      // so project docs don't grow forever.
      if (!docToWrite._deleted && Array.isArray(docToWrite.items)) {
        const itemCutoff = Date.now() - ITEM_TOMBSTONE_TTL_MS;
        docToWrite.items = docToWrite.items.filter(i => {
          if (!i._deleted) return true;
          const ts = i._deletedAt || (i._fieldTs && i._fieldTs._deleted) || 0;
          return ts > itemCutoff;
        });
      }

      // ── 2c. Label + size guard ──────────────────────────────────────────────
      docToWrite = withLabel(docToWrite);
      const bytes = Buffer.byteLength(JSON.stringify(docToWrite));
      if (bytes > COSMOS_DOC_LIMIT) {
        context.log.warn(`[saveProject] ${incoming.id} (${incoming.name || "?"}) too large: ${bytes} > ${COSMOS_DOC_LIMIT}`);
        context.res.status = 413;
        context.res.body   = { ok: false, error: "too_large", bytes, limit: COSMOS_DOC_LIMIT,
          message: `Project document is ${(bytes / 1048576).toFixed(2)} MB — Cosmos DB allows 2 MB` };
        return;
      }

      // ── 3. Write with ETag guard ────────────────────────────────────────────
      const upsertOptions = etag
        ? { accessCondition: { type: "IfMatch", condition: etag } }
        : {};

      const { resource: saved } = await container.items.upsert(docToWrite, upsertOptions);

      context.log(`[saveProject] ✓ ${incoming.id} (${incoming.name || "?"}) attempt=${attempt} ${(bytes / 1024).toFixed(0)}KB`);
      context.res.status = 200;
      // Return the merged document so the pushing device can adopt whatever
      // the merge preserved from other devices (restored photos, newer
      // fields). Without this, the pusher records the new _ts as "seen"
      // without ever downloading the merged state — freezing it on its own
      // stale view until some other device happens to write.
      context.res.body   = { ok: true, _ts: saved._ts, _savedAt: saved._savedAt, bytes, limit: COSMOS_DOC_LIMIT, project: saved };
      return;

    } catch (err) {
      if (err.code === 412 && attempt < MAX_RETRIES) {
        context.log.warn(`[saveProject] ETag conflict on ${incoming.id}, retry ${attempt}/${MAX_RETRIES}`);
        await new Promise(r => setTimeout(r, 80 * attempt));
        continue;
      }
      if (err.code === 413) {
        // Belt and braces: the pre-check above should catch this first.
        context.log.warn(`[saveProject] Cosmos rejected ${incoming.id} as too large`);
        context.res.status = 413;
        context.res.body   = { ok: false, error: "too_large", bytes: 0, limit: COSMOS_DOC_LIMIT, message: err.message };
        return;
      }
      context.log.error(`[saveProject] Error on ${incoming.id}:`, err.message);
      context.res.status = err.code === 412 ? 409 : 500;
      context.res.body   = { ok: false, error: err.message };
      return;
    }
  }
};
