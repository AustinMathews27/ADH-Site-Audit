#!/usr/bin/env node
// Compares every photo the project documents reference against what is really
// in Blob Storage. Answers two questions:
//   1. MISSING  — photos a project points at whose file is gone / empty / never
//                 uploaded (these render as broken pictures in the app + PDF).
//   2. ORPHANED — files in storage no project references any more (left behind
//                 while api/deleteBlob was broken, fixed in f3ba844).
// Read-only, never deletes. Delete orphans from Admin → Cleanup in the app.
//
// Data source:
//   - default: the site's getIndex/getProject/listBlobs API, no credentials.
//     A site that requires sign-in for /api/* answers with its login page; the
//     script then stops with a message saying so.
//   - direct: when these environment variables are set, Cosmos DB and Blob
//     Storage are read directly instead (the weekly workflow passes them from
//     repository secrets; never commit them):
//       COSMOS_DB_CONNECTION_STRING   a read-only key's connection string is enough
//       AZURE_STORAGE_ACCOUNT         storage account name
//       AZURE_STORAGE_SAS             container SAS with list + read (preferred), or
//       AZURE_STORAGE_KEY             the account key
//       COSMOS_DB_DATABASE            optional, default Auditdata
//       AZURE_BLOB_CONTAINER          optional, default site-photos
//     Needs the Azure SDKs: `npm install --prefix api` (or install
//     @azure/cosmos and @azure/storage-blob next to the repo).
//
// Usage:  node scripts/photo-audit.mjs                 summary
//         node scripts/photo-audit.mjs --out report.json   + full lists as JSON
//         node scripts/photo-audit.mjs --check             exit 1 on a regression: a live picture missing
//                                                          from storage, or spare copies uploaded after the
//                                                          v8.56 single-upload fix (for a scheduled run)
//         node scripts/photo-audit.mjs --check --ci        counts only — no project names or photo URLs.
//                                                          The repo is PUBLIC, so are its Actions logs:
//                                                          the weekly workflow must always pass --ci.
//         BASE=https://gray-stone-03fbce60f.7.azurestaticapps.net node scripts/photo-audit.mjs

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const BASE = process.env.BASE || 'https://adhsiteaudit.com';
const UID  = process.env.ADH_USER_ID || '25a348bbf3bb4e9087aefec8b88424b6';
const OUT  = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const CI   = process.argv.includes('--ci');
const MB   = b => (b / 1048576).toFixed(1);

// ── 0. Data source (see header) ──────────────────────────────────────────────
const env    = process.env;
const DIRECT = !!(env.COSMOS_DB_CONNECTION_STRING && env.AZURE_STORAGE_ACCOUNT && (env.AZURE_STORAGE_SAS || env.AZURE_STORAGE_KEY));

// A signed-in-only site redirects anonymous calls to its login page (HTML).
const LOGIN = /\/\.auth\/login|login\.microsoftonline\.com|login\.live\.com/i;
const loginPage = r => r.status === 401 || r.status === 403
  || (r.status >= 300 && r.status < 400 && LOGIN.test(r.headers.get('location') || ''))
  || (r.redirected && LOGIN.test(r.url))
  || (r.ok && !/json/i.test(r.headers.get('content-type') || ''));
const getJson = async url => {
  // Redirects are not followed blindly: one to the login page is the answer
  let r = await fetch(url, { redirect: 'manual' });
  if (r.status >= 300 && r.status < 400 && !LOGIN.test(r.headers.get('location') || '')) r = await fetch(url);
  if (loginPage(r)) {
    await r.arrayBuffer().catch(() => {}); // release the connection before exiting
    console.log(`✗ ${new URL(url).origin} answered with its sign-in page instead of data (HTTP ${r.status}): the API requires sign-in.\n` +
      '  Set COSMOS_DB_CONNECTION_STRING, AZURE_STORAGE_ACCOUNT and AZURE_STORAGE_SAS (or AZURE_STORAGE_KEY)\n' +
      '  to read Cosmos DB and Blob Storage directly — see the top of scripts/photo-audit.mjs.');
    process.exit(1);
  }
  return { status: r.status, json: r.status === 200 ? await r.json() : null };
};

// Azure SDKs: from the repo's node_modules, else from api/node_modules
const sdk = async name => {
  try { return await import(name); }
  catch { return createRequire(new URL('../api/package.json', import.meta.url))(name); }
};

async function directSource() {
  const cosmos = await sdk('@azure/cosmos'), storage = await sdk('@azure/storage-blob');
  const CosmosClient = cosmos.CosmosClient || cosmos.default.CosmosClient;
  const { BlobServiceClient, StorageSharedKeyCredential } = storage.BlobServiceClient ? storage : storage.default;
  const account = env.AZURE_STORAGE_ACCOUNT, containerName = env.AZURE_BLOB_CONTAINER || 'site-photos';
  const host = `https://${account}.blob.core.windows.net`;
  const service = env.AZURE_STORAGE_SAS
    ? new BlobServiceClient(`${host}?${env.AZURE_STORAGE_SAS.replace(/^\?/, '')}`)
    : new BlobServiceClient(host, new StorageSharedKeyCredential(account, env.AZURE_STORAGE_KEY));
  const blobContainer = service.getContainerClient(containerName);
  const docs = new CosmosClient(env.COSMOS_DB_CONNECTION_STRING)
    .database(env.COSMOS_DB_DATABASE || 'Auditdata').container('Audits');
  const readDoc = async id => {
    try { const { resource } = await docs.item(id, id).read(); return resource || null; }
    catch (e) { if (e.code === 404) return null; throw e; }
  };
  const found = d => ({ status: d ? 200 : 404, json: d });
  // Azure errors can name hosts and accounts: --ci logs are public, so keep them short
  const guard = fn => async (...a) => {
    try { return await fn(...a); }
    catch (e) { console.log(`✗ direct read failed: ${e.code || e.statusCode || e.name || 'error'}${CI ? '' : ' — ' + e.message}`); process.exit(1); }
  };
  const src = {
    // Same shape as api/listBlobs (URL = container URL + blob name)
    async listBlobs() {
      const blobs = [];
      for await (const b of blobContainer.listBlobsFlat()) blobs.push({
        name: b.name, url: `${host}/${containerName}/${b.name}`,
        size: b.properties.contentLength || 0,
        lastModified: b.properties.lastModified || null, createdOn: b.properties.createdOn || null,
        md5: b.properties.contentMD5 ? Buffer.from(b.properties.contentMD5).toString('base64') : null,
      });
      return found({ blobs, truncated: false });
    },
    async getIndex() { return found((await readDoc(`adh-index-${UID}`)) || (await readDoc('adh-index-v1'))); },
    async getProject(pid) { return found(await readDoc('adh-proj-' + pid)); },
  };
  return { listBlobs: guard(src.listBlobs), getIndex: guard(src.getIndex), getProject: guard(src.getProject) };
}

const api = {
  listBlobs:  () => getJson(`${BASE}/api/listBlobs`),
  getIndex:   () => getJson(`${BASE}/api/getIndex?userId=${UID}`),
  getProject: pid => getJson(`${BASE}/api/getProject?id=${encodeURIComponent(pid)}`),
};
const source = DIRECT ? await directSource() : api;
console.log(`source: ${DIRECT ? 'Cosmos DB + Blob Storage (direct)' : BASE + '/api'}`);

// ── 1. Storage listing ───────────────────────────────────────────────────────
const lb = await source.listBlobs();
if (!lb.json) { console.error(`listBlobs HTTP ${lb.status}`); process.exit(1); }
const blobs = lb.json.blobs;
if (lb.json.truncated) console.warn('⚠ listBlobs hit its 20,000 cap — orphan/missing numbers below are incomplete.\n');
const blobByUrl = new Map(blobs.map(b => [b.url, b]));
const blobHost  = blobs.length ? new URL(blobs[0].url).host : '';
// Container URL ("https://<account>.blob.core.windows.net/<container>/"): a
// staging copy seeded from production keeps production URLs, which live in
// another container of the same account and are not ours to judge.
const blobBase  = blobs.length && blobs[0].url.endsWith('/' + blobs[0].name) ? blobs[0].url.slice(0, -blobs[0].name.length) : '';
// Compare on the decoded path without query string — a stored URL may carry an
// old SAS token or percent-encoding the listing doesn't.
const norm = u => { try { const x = new URL(u); return x.host + decodeURIComponent(x.pathname); } catch { return u; } };
const blobByNorm = new Map(blobs.map(b => [norm(b.url), b]));
const findBlob = u => blobByUrl.get(u) || blobByNorm.get(norm(u));

// ── 2. Project documents ─────────────────────────────────────────────────────
const idx = (await source.getIndex()).json;
if (!idx) { console.error('getIndex failed'); process.exit(1); }
const indexIds = new Set(idx.projectIds || []);
// Blob names are <projectId>/<siId>/<file>; a prefix the index no longer lists may
// still have a (tombstoned, trash-restorable) doc — fetch those too.
const prefixIds = new Set(blobs.map(b => b.name.split('/')[0]));
const allIds = new Set([...indexIds, ...prefixIds]);

const live = new Map();        // url -> { pid, where }  photos the app displays
const mentioned = new Set();   // norm(url) of ANY storage URL anywhere in any doc
const tombFiles = new Set();   // "<projectId>/<filename>" the app deliberately deleted (photo + cover tombstones)
const noCloudCopy = [];        // photos with no url at all — never uploaded
const projects = new Map();    // pid -> { name, deleted, status }
const shownTwice = [];         // items listing the same picture (same content) more than once

const deepScan = v => {
  if (typeof v === 'string') { if (blobHost && v.includes(blobHost)) mentioned.add(norm(v)); }
  else if (Array.isArray(v)) v.forEach(deepScan);
  else if (v && typeof v === 'object') Object.values(v).forEach(deepScan);
};
deepScan(idx);

for (const pid of allIds) {
  const { status, json: p } = await source.getProject(pid);
  if (!p) { projects.set(pid, { name: `(no doc — HTTP ${status})`, inIndex: indexIds.has(pid), noDoc: true }); continue; }
  projects.set(pid, { name: p.name || pid, inIndex: indexIds.has(pid), deleted: !!p._deleted });
  deepScan(p);
  const addLive = (url, where) => { if (url && /^https?:/.test(url)) live.set(url, { pid, where }); };
  // Tombstones are scoped to their project: a copied project keeps the
  // original's filenames, so a delete in one must not mark the other's file.
  // Keys from older builds are full URLs and name their own folder.
  const addTomb = k => {
    const clean = k.split('?')[0], parts = clean.split('/');
    const folder = (/^https?:/.test(clean) && parts.length >= 4) ? parts[parts.length - 3] : pid;
    tombFiles.add(folder + '/' + parts[parts.length - 1]);
  };
  Object.keys(p.coverTombstones || {}).forEach(addTomb);
  if (p.coverPhoto && !p.coverPhoto.startsWith('data:')) addLive(p.coverPhoto, 'cover photo');
  for (const it of p.items || []) {
    Object.keys(it.photoTombstones || {}).forEach(addTomb);
    const tag = `${it.num || 'SI'}${it._deleted ? ' (deleted item)' : ''}`;
    const photoSets = [[it.photos || [], tag]];
    ((it.towerWork && it.towerWork.rooms) || []).forEach(r => photoSets.push([r.photos || [], `${tag} room ${r.number ?? ''}`]));
    if (!it._deleted && !p._deleted && indexIds.has(pid)) for (const [list, where] of photoSets) {
      const seen = new Map();
      for (const ph of list) { const b = ph.url && findBlob(ph.url); if (b) { const k = b.md5 || b.size; seen.set(k, (seen.get(k) || 0) + 1); } }
      const extra = [...seen.values()].reduce((n, c) => n + c - 1, 0);
      if (extra) shownTwice.push({ pid, project: p.name, where, extra });
    }
    for (const [list, where] of photoSets) for (const ph of list) {
      if (ph.url && /^https?:/.test(ph.url)) addLive(ph.url, where);
      else noCloudCopy.push({ pid, project: p.name, where, photoId: ph.id || null, hasInlineData: !!ph.data, url: ph.url || null });
    }
  }
}

// ── 3. Compare ───────────────────────────────────────────────────────────────
const missing = [], empty = [];
for (const [url, ref] of live) {
  if (blobHost && !url.includes(blobHost)) continue; // not our storage (external image)
  if (blobBase && !url.startsWith(blobBase)) continue; // another container (e.g. seeded from production)
  const b = findBlob(url);
  if (!b) missing.push({ ...ref, project: projects.get(ref.pid)?.name, url });
  else if (!b.size) empty.push({ ...ref, project: projects.get(ref.pid)?.name, url });
}
const liveNorm = new Set([...live.keys()].map(norm));
const orphans = blobs.filter(b => !liveNorm.has(norm(b.url)));

// "Same picture" = same item folder + same content (md5 when listBlobs provides
// it, else exact byte size — a collision between two different ~300 KB JPEGs in
// one folder is vanishingly unlikely). The upload race fixed in v8.56 stored one
// photo many times, so most orphans are spare copies of a picture still shown.
const picKey = b => b.name.split('/').slice(0, 2).join('/') + '|' + (b.md5 || b.size);
const tombOf = b => { const parts = b.name.split('/'); return parts[0] + '/' + parts[parts.length - 1]; };
const livePics = new Set(blobs.filter(b => liveNorm.has(norm(b.url))).map(picKey));
const tombPics = new Set(blobs.filter(b => tombFiles.has(tombOf(b))).map(picKey));
// duplicate  — spare copy of a picture its item still shows        → safe to delete
// tombstoned — picture (or a copy of one) the user deleted on purpose → safe to delete
// mentioned  — not displayed but a doc still names the URL           → review
// UNSHOWN    — the picture appears in NO item and was never deliberately deleted:
//              possibly lost from the project. Recover via Admin → Recovery, don't delete.
const classify = b => livePics.has(picKey(b)) ? 'duplicate'
  : (tombFiles.has(tombOf(b)) || tombPics.has(picKey(b))) ? 'tombstoned'
  : mentioned.has(norm(b.url)) ? 'mentioned' : 'UNSHOWN';

// The same race could also leave one picture listed twice inside an item
// (counted per item while reading the docs — see shownTwice above).

// ── 4. Report ────────────────────────────────────────────────────────────────
const rows = [...allIds].map(pid => {
  const mine = blobs.filter(b => b.name.split('/')[0] === pid);
  const orph = orphans.filter(b => b.name.split('/')[0] === pid);
  const pr = projects.get(pid);
  return {
    project: (pr.name || '').slice(0, 40) + (pr.deleted ? ' [trash]' : '') + (!pr.inIndex && !pr.noDoc ? ' [not in index]' : ''),
    blobs: mine.length, MB: +MB(mine.reduce((s, b) => s + b.size, 0)),
    livePhotos: [...live.values()].filter(r => r.pid === pid).length,
    MISSING: missing.filter(m => m.pid === pid).length + empty.filter(m => m.pid === pid).length,
    notUploaded: noCloudCopy.filter(m => m.pid === pid).length,
    orphans: orph.length, orphanMB: +MB(orph.reduce((s, b) => s + b.size, 0)),
  };
}).sort((a, b) => b.MISSING - a.MISSING || b.orphanMB - a.orphanMB);
if (!CI) console.table(rows);

const byClass = { duplicate: [], tombstoned: [], mentioned: [], UNSHOWN: [] };
orphans.forEach(b => byClass[classify(b)].push(b));
const sum = l => `${l.length} files · ${MB(l.reduce((s, b) => s + b.size, 0))} MB`;
console.log(`\nStorage: ${sum(blobs)}   |   live photo references: ${live.size} across ${indexIds.size} indexed projects`);
console.log(`\nPICTURE HEALTH`);
console.log(`  missing from storage : ${missing.length}`);
console.log(`  zero-byte files      : ${empty.length}`);
console.log(`  never uploaded (no url in cloud doc): ${noCloudCopy.length}`);
if (!CI) [...missing, ...empty].slice(0, 25).forEach(m => console.log(`    ✗ ${m.project} · ${m.where} · ${m.url}`));
if (!CI) noCloudCopy.slice(0, 25).forEach(m => console.log(`    ⧗ ${m.project} · ${m.where} · photo ${m.photoId}${m.hasInlineData ? ' (inline data in doc)' : ''}`));
const twiceN = shownTwice.reduce((s, r) => s + r.extra, 0);
console.log(`  same picture listed more than once in an item: ${twiceN} extra photos in ${shownTwice.length} items`);
console.log(`\nORPHANED FILES: ${sum(orphans)}`);
console.log(`  spare copy of a picture still shown (safe to delete)        : ${sum(byClass.duplicate)}`);
console.log(`  deleted on purpose — photo tombstone (safe to delete)       : ${sum(byClass.tombstoned)}`);
console.log(`  not displayed but still mentioned in a doc (review)         : ${sum(byClass.mentioned)}`);
const unshownPics = new Map();
byClass.UNSHOWN.forEach(b => { const k = picKey(b); if (!unshownPics.has(k)) unshownPics.set(k, b); });
console.log(`  ⚠ NOT shown anywhere, NOT deliberately deleted (DO NOT delete — may be lost pictures): ${sum(byClass.UNSHOWN)} = ${unshownPics.size} distinct pictures`);
const unshownBy = {};
for (const b of unshownPics.values()) { const [pid, si] = b.name.split('/'); const k = `${projects.get(pid)?.name || pid} · ${si || ''}`; unshownBy[k] = (unshownBy[k] || 0) + 1; }
if (!CI) Object.entries(unshownBy).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`      ${String(n).padStart(3)} pictures  ${k}`));
const ages = orphans.map(b => new Date(b.createdOn || b.lastModified).getTime()).filter(Boolean).sort((a, b) => a - b);
if (ages.length) console.log(`  oldest ${new Date(ages[0]).toISOString().slice(0, 10)} · newest ${new Date(ages.at(-1)).toISOString().slice(0, 10)}`);

// ── 5. Regression check ──────────────────────────────────────────────────────
// Devices were given until 2026-09-23 to pick up v8.56; a spare copy uploaded
// after that means the single-upload guard is being bypassed somewhere.
const FIX_TS = Date.UTC(2026, 8, 23);
const newDup = byClass.duplicate.filter(b => new Date(b.createdOn || b.lastModified).getTime() > FIX_TS);
const liveMissing = [...missing, ...empty].filter(m => !m.where.includes('(deleted item)'));
console.log(`
REGRESSION CHECK
  spare copies uploaded since the v8.56 fix: ${newDup.length}${newDup.length ? '  ✗' : '  ✓'}
  live pictures missing from storage       : ${liveMissing.length}${liveMissing.length ? '  ✗' : '  ✓'}`);
if (!CI) newDup.slice(0, 10).forEach(b => console.log(`    ${b.createdOn}  ${b.name}`));
const clearable = byClass.duplicate.length + byClass.tombstoned.length;
if (clearable > 200) console.log(`
REMINDER: ${clearable} leftover files (${MB([...byClass.duplicate, ...byClass.tombstoned].reduce((n, b) => n + b.size, 0))} MB) are safe to clear — Admin → Storage → Orphaned files.`);
if (shownTwice.length) console.log(`REMINDER: ${shownTwice.reduce((n, r) => n + r.extra, 0)} duplicate photos inside items — Admin → Storage → Duplicate photos.`);
if (process.argv.includes('--check') && (newDup.length || liveMissing.length)) process.exitCode = 1;

if (OUT) {
  writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), base: BASE, missing, empty, noCloudCopy, shownTwice,
    orphans: orphans.map(b => ({ ...b, class: classify(b) })) }, null, 2));
  console.log(`\nFull lists written to ${OUT}`);
}
