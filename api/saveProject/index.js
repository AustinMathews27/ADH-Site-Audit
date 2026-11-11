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
//   - Per-field timestamps (_fieldTs): a stamped field is only replaced by a
//     push carrying a stamp at least as new (see mergeFields)
//   - Project-level fields (sections, Look Ahead, labor log, activity log…)
//     merge key by key and entry by entry (see mergeProjLevel)
//   - _rev counts writes, so a client can tell which of two copies is newer
//     even when both carry the same whole-second _ts

const { requireUser } = require('../_shared/auth');
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

// Photo delete / restore records ({ filename: epochMs }): one pair per scope
// item (photoTombstones / photoRestores) and one for the project cover
// (coverTombstones / coverRestores). Each map is the union of both sides,
// newest per file, dropped after ITEM_TOMBSTONE_TTL_MS. A restore (Admin →
// Recovery) beats an older delete of the same file and a later delete beats
// the restore; only the winning record is kept.
function mergePhotoStamps(curTomb, incTomb, curRest, incRest) {
  const cutoff = Date.now() - ITEM_TOMBSTONE_TTL_MS;
  const union = (a, b) => {
    const out = {};
    [a || {}, b || {}].forEach(m => Object.entries(m).forEach(([u, ts]) => {
      const k = tombKey(u);
      if (!out[k] || ts > out[k]) out[k] = ts;
    }));
    Object.keys(out).forEach(k => { if (out[k] < cutoff) delete out[k]; });
    return out;
  };
  const tomb = union(curTomb, incTomb), rest = union(curRest, incRest);
  Object.keys(rest).forEach(k => { if (tomb[k] > rest[k]) delete rest[k]; else delete tomb[k]; });
  return { tomb, rest };
}
const setStamps = (obj, key, map) => { if (Object.keys(map).length) obj[key] = map; else delete obj[key]; };

// Human-readable identity at the TOP of every project document. Cosmos keeps
// property order, so opening a doc in Data Explorer shows the label first —
// and `SELECT c.id, c.label FROM c WHERE c.docType = 'project'` lists them.
function labelFor(doc) {
  const name  = String(doc.name || '(unnamed)').trim();
  // Company code first (AMI · …) so Data Explorer sorts/groups by company.
  const co    = doc.companyId ? String(doc.companyId).toUpperCase() + ' · ' : '';
  if (doc._deleted) return `DELETED · ${co}${name}`;
  const live  = (doc.items || []).filter(i => !i._deleted).length;
  const parts = [co + name];
  if (doc.client && doc.client !== '—') parts.push(String(doc.client).trim());
  parts.push(`${live} SI`);
  return parts.join(' · ');
}
function withLabel(doc) {
  const { docType: _d, label: _l, ...rest } = doc;
  return { docType: doc._deleted ? 'project-deleted' : 'project', label: labelFor(doc), ...rest };
}

// ── Per-field timestamp merge ─────────────────────────────────────────────────
// A stamped field keeps the stored value unless the incoming copy carries a
// stamp at least as new. An incoming copy with NO stamp for a field the stored
// doc has stamped is a stale device that never saw that edit (stamp maps ride
// along on every pull) — it used to win and wipe text typed on another device.
// Fields stamped on neither side: incoming wins, as before. Labor entries,
// tower rooms and attachments then merge entry by entry (mergeEntryLists).
function mergeFields(current, incoming) {
  const cTs = current._fieldTs  || {};
  const iTs = incoming._fieldTs || {};
  const result = Object.assign({}, current);

  Object.keys(incoming).forEach(k => {
    if (k === "_fieldTs") return;
    const cTime = cTs[k];
    const iTime = iTs[k];
    if (cTime !== undefined && (iTime === undefined || cTime > iTime)) {
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

  // Who-edited-last metadata has no stamp of its own: it follows the copy
  // with the newer _updatedAt, so an older copy never relabels the SI.
  if ((current._updatedAt || 0) > (incoming._updatedAt || 0)) {
    UPDATED_META.forEach(k => { if (k in current) result[k] = current[k]; else delete result[k]; });
  }

  mergeEntryLists(current, incoming, result);
  return result;
}
const UPDATED_META = ["_updatedBy", "_updatedAt", "_updatedByDevice"];

// ── Per-entry list merge ──────────────────────────────────────────────────────
// Labor entries, tower rooms and attachments merge entry by entry (by id), so
// entries added on two devices both survive. A deleted entry leaves an
// id → deletedAt marker in the item's entryTombstones (union of both sides,
// GC'd with the item tombstone TTL) and stays deleted whichever copy arrives
// later. An entry on both sides keeps the copy with the newer `_ts` (tower
// rooms stamp it on each change); equal or missing stamps keep the incoming
// copy. A room's photos are the union of both copies minus photo tombstones.
// Entries without an id follow the incoming copy, as before.
const newerEntry = (c, e) => ((c._ts || 0) > (e._ts || 0) ? c : e);

function mergeById(cur, inc, tomb, pick) {
  const curMap = new Map();
  (Array.isArray(cur) ? cur : []).forEach(e => {
    if (e && e.id != null && !tomb[e.id]) curMap.set(e.id, e);
  });
  const out = [], seen = new Set();
  (Array.isArray(inc) ? inc : []).forEach(e => {
    if (!e || e.id == null) { out.push(e); return; }
    if (tomb[e.id] || seen.has(e.id)) return;
    seen.add(e.id);
    const c = curMap.get(e.id);
    out.push(c ? pick(c, e) : e);
  });
  curMap.forEach((c, id) => { if (!seen.has(id)) out.push(c); });
  return out;
}

function mergeEntryLists(current, incoming, result) {
  const tomb = {};
  [current.entryTombstones || {}, incoming.entryTombstones || {}].forEach(m =>
    Object.entries(m).forEach(([id, ts]) => { if (!(tomb[id] >= ts)) tomb[id] = ts; }));
  const cutoff = Date.now() - ITEM_TOMBSTONE_TTL_MS;
  Object.keys(tomb).forEach(id => { if (!(tomb[id] > cutoff)) delete tomb[id]; });
  if (Object.keys(tomb).length) result.entryTombstones = tomb;
  else delete result.entryTombstones;

  ["laborEntries", "attachments"].forEach(k => {
    if (Array.isArray(current[k]) || Array.isArray(incoming[k])) {
      result[k] = mergeById(current[k], incoming[k], tomb, newerEntry);
    }
  });

  const cRooms = current.towerWork && current.towerWork.rooms;
  const iRooms = incoming.towerWork && incoming.towerWork.rooms;
  if (Array.isArray(cRooms) || Array.isArray(iRooms)) {
    // incoming.photoTombstones is already the union of both sides (mergeItems)
    const photoTomb = incoming.photoTombstones || {};
    const live = p => !(p && p.url && tombHit(photoTomb, p.url));
    const pickRoom = (c, e) => {
      const win = newerEntry(c, e), other = win === c ? e : c;
      const own = (win.photos || []).filter(live);
      const urls = new Set(own.map(p => p && p.url));
      const extra = (other.photos || []).filter(p => p && p.url && live(p) && !urls.has(p.url));
      return (extra.length || own.length !== (win.photos || []).length)
        ? Object.assign({}, win, { photos: [...own, ...extra] }) : win;
    };
    result.towerWork = Object.assign({}, result.towerWork || {}, {
      rooms: mergeById(cRooms, iRooms, tomb, pickRoom)
    });
  }
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
    // A newer restore record (photoRestores) cancels the tombstone.
    const { tomb, rest } = mergePhotoStamps(cur && cur.photoTombstones, incoming.photoTombstones,
                                            cur && cur.photoRestores, incoming.photoRestores);

    // Always strip photos from what gets written to Cosmos —
    // photos live in IndexedDB on the client, Azure Blob for URLs.
    // `day` files a photo under a site-visit day. A device still running an
    // older app version strips it on push — keep the stored day for that URL
    // rather than letting the stale push erase it.
    const curDay = new Map(((cur && cur.photos) || []).filter(p => p.url && p.day).map(p => [p.url, p.day]));
    const incomingClean = Object.assign({}, incoming, {
      photos: (incoming.photos || [])
        .filter(p => p.url && !tombHit(tomb, p.url))
        .map(p => {
          const out = { url: p.url, caption: p.caption || "", takenAt: p.takenAt || "" };
          const day = p.day || curDay.get(p.url);
          if (day) out.day = day;
          return out;
        }),
      attachments: (incoming.attachments || [])
        .map(a => ({
          id: a.id, name: a.name, type: a.type, ext: a.ext,
          icon: a.icon, size: a.size, addedAt: a.addedAt, addedBy: a.addedBy
        }))
    });
    setStamps(incomingClean, 'photoTombstones', tomb);
    setStamps(incomingClean, 'photoRestores', rest);
    // Per-device dirty bookkeeping never belongs in the shared doc (older
    // clients still send it) — see _buildProjectPayload in index.html.
    delete incomingClean._dirty; delete incomingClean._lastModified;

    if (cur) {
      // Merge field by field — field timestamps resolve conflicts
      const merged = mergeFields(cur, incomingClean);
      // Preserve any cloud-URL photos already on the current side
      // that the client didn't send back (it strips base64, keeps URLs)
      const currentUrlPhotos = (cur.photos || []).filter(p => p.url && !tombHit(tomb, p.url));
      const incomingUrls = new Set((incomingClean.photos || []).map(p => p.url));
      const extraPhotos = currentUrlPhotos.filter(p => !incomingUrls.has(p.url));
      merged.photos = [...(incomingClean.photos || []), ...extraPhotos];
      delete merged._dirty; delete merged._lastModified;
      setStamps(merged, 'photoTombstones', tomb);
      setStamps(merged, 'photoRestores', rest);
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

// Per-day site-visit data ({ "YYYY-MM-DD": { note, finishedAt, ts, … } }):
// merged day by day, newest `ts` wins, so devices editing different days'
// notes never overwrite each other. Undefined when neither side has any.
function mergeDays(cur, inc) {
  const out = Object.assign({}, cur || {});
  Object.entries(inc || {}).forEach(([k, v]) => {
    if (!v || typeof v !== "object") return;
    if (!out[k] || (v.ts || 0) >= (out[k].ts || 0)) out[k] = v;
  });
  return Object.keys(out).length ? out : undefined;
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

// ── Project-level merge ───────────────────────────────────────────────────────
// Everything outside `items` used to be replaced wholesale by whichever device
// pushed last, so a device that had not pulled yet sent back its old sections,
// Look Ahead cells, labor log… and erased newer work (a new imported section
// vanished, taking its SIs out of the list). Now:
//   - each project-level key resolves newest-wins on the project's _fieldTs
//     stamp (stamped by the device that changed it), like SI fields; a key
//     stamped on neither side keeps the old rule (`bWinsTie` side wins);
//   - the collections below merge entry by entry; per-entry stamps live in
//     _entryTs[name] (a missing entry with a newer stamp = deleted), and an
//     entry stamped on neither side follows the key-level winner;
//   - append-only logs are unioned (activityLogClearedAt drops older entries).
// index.html runs the same merge (_mergeProjLevel) when it pulls — keep the
// two in step.
const PROJ_LEVEL_SKIP = new Set(['id', 'projectId', 'items', 'days', '_fieldTs', '_entryTs',
  '_deleted', '_deletedAt', '_deletedFrom', '_ts', '_rid', '_self', '_etag', '_attachments', '_rev',
  'docType', 'label', 'ownedBy', '_pushedBy', '_savedAt', '_savedByDevice',
  'activityLog', 'activityLogClearedAt', 'importLog', 'innergyIgnoredWOs']);
const PROJ_COLLS = {
  sections:     { top: 'sections', id: s => s && s.id },
  schedule:     { top: 'schedule' },        // plain maps: entry = key
  laborLog:     { top: 'laborLog' },
  toolboxTalks: { top: 'toolboxTalks' },
  envScreens:   { top: 'envData', sub: 'screenshots', id: s => s && (s.id || s.label) },
  envSensors:   { top: 'envData', sub: 'sensors',
                  id: s => s && [s.name, s.dateRange, (s.temperature || []).length, (s.humidity || []).length].join('|') },
};
const ENTRY_TS_TTL_MS  = 60 * 24 * 60 * 60 * 1000;   // same window as item tombstones
const ACTIVITY_LOG_MAX = 300;                        // the client keeps the newest 300

function mergeProjColl(ca, cb, idOf, bWon, ea, eb) {
  const split = c => {
    const m = new Map(), loose = [];
    if (idOf) c.forEach(e => {
      const id = idOf(e);
      if (id === undefined || id === null || id === '') loose.push(e);
      else if (!m.has(String(id))) m.set(String(id), e);
    });
    else Object.keys(c).forEach(k => m.set(k, c[k]));
    return { m, loose };
  };
  const A = split(ca), B = split(cb), W = bWon ? B : A, L = bWon ? A : B;
  const takeB = id => {
    const ta = ea[id], tb = eb[id];
    if (ta === undefined && tb === undefined) return bWon;
    if (ta === undefined || tb === undefined) return ta === undefined;
    return ta === tb ? bWon : tb > ta;
  };
  const kept = [];
  // Order follows the key-level winner; entries only the other side has go after.
  new Set([...W.m.keys(), ...L.m.keys()]).forEach(id => {
    const src = takeB(id) ? B.m : A.m;
    if (src.has(id)) kept.push([id, src.get(id)]);
  });
  if (!idOf) { const o = {}; kept.forEach(([k, v]) => { o[k] = v; }); return o; }
  return kept.map(x => x[1]).concat(W.loose);
}

// a = stored doc, b = incoming push. Returns the merged project-level keys
// plus the merged _fieldTs / _entryTs maps.
function mergeProjLevel(a, b, bWinsTie) {
  a = a || {}; b = b || {};
  const aTs = a._fieldTs || {}, bTs = b._fieldTs || {};
  const bWins = k => {
    const ta = aTs[k], tb = bTs[k];
    if (ta !== undefined && (tb === undefined || ta > tb)) return false;
    if (tb !== undefined && (ta === undefined || tb > ta)) return true;
    return bWinsTie;
  };
  const out = {};
  new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k => {
    if (PROJ_LEVEL_SKIP.has(k)) return;
    if (!(k in b)) out[k] = a[k];          // a key left out of a push = no opinion
    else if (!(k in a)) out[k] = b[k];
    else out[k] = bWins(k) ? b[k] : a[k];
  });

  const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const cutoff = Date.now() - ENTRY_TS_TTL_MS;
  const aE = a._entryTs || {}, bE = b._entryTs || {}, entryTs = {};
  Object.keys(PROJ_COLLS).forEach(c => {
    const { top, sub, id } = PROJ_COLLS[c];
    const ea = aE[c] || {}, eb = bE[c] || {}, m = {};
    [ea, eb].forEach(src => Object.keys(src).forEach(k => {
      const t = src[k];
      if (typeof t === 'number' && t > cutoff && !(m[k] >= t)) m[k] = t;
    }));
    if (Object.keys(m).length) entryTs[c] = m;
    if (!(top in a) || !(top in b)) return;
    let ca = a[top], cb = b[top];
    if (sub) {
      if (!isMap(ca) || !isMap(cb) || !isMap(out[top])) return;
      ca = ca[sub] === undefined ? [] : ca[sub];
      cb = cb[sub] === undefined ? [] : cb[sub];
    }
    if (id ? !(Array.isArray(ca) && Array.isArray(cb)) : !(isMap(ca) && isMap(cb))) return;
    const merged = mergeProjColl(ca, cb, id, bWins(top), ea, eb);
    out[top] = sub ? Object.assign({}, out[top], { [sub]: merged }) : merged;
  });

  const cleared = Math.max(a.activityLogClearedAt || 0, b.activityLogClearedAt || 0);
  if (cleared) out.activityLogClearedAt = cleared;
  if (Array.isArray(a.activityLog) || Array.isArray(b.activityLog)) {
    const seen = new Set(), log = [];
    [].concat(a.activityLog || [], b.activityLog || []).forEach(e => {
      if (!e || (cleared && (e.at || 0) <= cleared)) return;
      const k = [e.at, e.dev, e.type, e.siId, e.detail].join('|');
      if (!seen.has(k)) { seen.add(k); log.push(e); }
    });
    out.activityLog = log.sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, ACTIVITY_LOG_MAX);
  }
  if (Array.isArray(a.importLog) || Array.isArray(b.importLog)) {
    const seen = new Set();
    out.importLog = [].concat(a.importLog || [], b.importLog || []).filter(e => {
      const k = e && (e.date + '|' + e.source);
      if (!e || seen.has(k)) return false;
      seen.add(k); return true;
    }).sort((x, y) => String(x.date || '').localeCompare(String(y.date || '')));
  }
  if (Array.isArray(a.innergyIgnoredWOs) || Array.isArray(b.innergyIgnoredWOs)) {
    out.innergyIgnoredWOs = [...new Set([].concat(a.innergyIgnoredWOs || [], b.innergyIgnoredWOs || []))];
  }

  const fts = Object.assign({}, aTs);
  Object.keys(bTs).forEach(k => { if (!(fts[k] >= bTs[k])) fts[k] = bTs[k]; });
  if (Object.keys(fts).length) out._fieldTs = fts;
  out._entryTs = Object.keys(entryTs).length ? entryTs : undefined;   // undefined: GC'd away
  return out;
}

module.exports = async function (context, req) {
  // Sign-in is enforced at the edge; this parses the caller and applies the
  // optional ALLOWED_EMAIL_DOMAINS allow-list (see api/_shared/auth.js).
  if (!requireUser(context, req)) return;

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
          _savedAt:   incoming._savedAt || Date.now(),
          _rev:       ((current && current._rev) || 0) + 1
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
          _savedAt: incoming._savedAt || Date.now(),
          _rev:     1
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

        // Project-level keys: stamp-aware, entry-by-entry merge (see
        // mergeProjLevel) — no longer whatever the last push carried.
        const lvl = mergeProjLevel(current, incoming, true);
        docToWrite = Object.assign({}, current, incoming, lvl, {
          id:        docId,
          projectId: incoming.id,
          ownedBy:   ownedBy,  // Preserve original owner
          items:     mergeItems(current.items || [], incoming.items || []),
          days:      mergeDays(current.days, incoming.days),
          // Preserve blob-URL covers (the client uploads then pushes the URL);
          // base64 never enters Cosmos, and a data: push keeps the stored URL.
          // A push that leaves coverPhoto out (upload still pending) keeps it too.
          coverPhoto: (lvl.coverPhoto && !String(lvl.coverPhoto).startsWith('data:'))
            ? lvl.coverPhoto
            : (lvl.coverPhoto === null ? null : (current.coverPhoto || null)),
          envData: lvl.envData ? stripEnvScreens(lvl.envData) : (current.envData || undefined),
          floorPlan: lvl.floorPlan
            ? Object.assign({}, lvl.floorPlan, { imageData: null })
            : (current.floorPlan || undefined),
          _savedAt: incoming._savedAt || Date.now(),
          _rev:     (current._rev || 0) + 1
        });
      }

      // ── 2a. Cover photo delete / restore records ────────────────────────────
      // A replaced or removed cover is deleted from storage and recorded in
      // coverTombstones. A device that missed the change still pushes the old
      // URL: keep the stored cover rather than point at a deleted file.
      if (!docToWrite._deleted) {
        const cover = mergePhotoStamps(current && current.coverTombstones, incoming.coverTombstones,
                                       current && current.coverRestores, incoming.coverRestores);
        setStamps(docToWrite, 'coverTombstones', cover.tomb);
        setStamps(docToWrite, 'coverRestores', cover.rest);
        if (docToWrite.coverPhoto && tombHit(cover.tomb, docToWrite.coverPhoto)) {
          const kept = current && current.coverPhoto;
          docToWrite.coverPhoto = (kept && !tombHit(cover.tomb, kept)) ? kept : null;
        }
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
