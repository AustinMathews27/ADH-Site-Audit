#!/usr/bin/env node
// Compares every photo the project documents reference against what is really
// in Blob Storage. Answers two questions:
//   1. MISSING  — photos a project points at whose file is gone / empty / never
//                 uploaded (these render as broken pictures in the app + PDF).
//   2. ORPHANED — files in storage no project references any more (left behind
//                 while api/deleteBlob was broken, fixed in f3ba844).
// Read-only — goes through the public getIndex/getProject/listBlobs API, no
// credentials, never deletes. Delete orphans from Admin → Cleanup in the app.
//
// Usage:  node scripts/photo-audit.mjs                 summary
//         node scripts/photo-audit.mjs --out report.json   + full lists as JSON
//         node scripts/photo-audit.mjs --check             exit 1 on a regression: a live picture missing
//                                                          from storage, or spare copies uploaded after the
//                                                          v8.56 single-upload fix (for a scheduled run)
//         BASE=https://gray-stone-03fbce60f.7.azurestaticapps.net node scripts/photo-audit.mjs

import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'https://adhsiteaudit.com';
const UID  = process.env.ADH_USER_ID || '25a348bbf3bb4e9087aefec8b88424b6';
const OUT  = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const MB   = b => (b / 1048576).toFixed(1);
const getJson = async url => { const r = await fetch(url); return { status: r.status, json: r.status === 200 ? await r.json() : null }; };

// ── 1. Storage listing ───────────────────────────────────────────────────────
const lb = await getJson(`${BASE}/api/listBlobs`);
if (!lb.json) { console.error(`listBlobs HTTP ${lb.status}`); process.exit(1); }
const blobs = lb.json.blobs;
if (lb.json.truncated) console.warn('⚠ listBlobs hit its 20,000 cap — orphan/missing numbers below are incomplete.\n');
const blobByUrl = new Map(blobs.map(b => [b.url, b]));
const blobHost  = blobs.length ? new URL(blobs[0].url).host : '';
// Compare on the decoded path without query string — a stored URL may carry an
// old SAS token or percent-encoding the listing doesn't.
const norm = u => { try { const x = new URL(u); return x.host + decodeURIComponent(x.pathname); } catch { return u; } };
const blobByNorm = new Map(blobs.map(b => [norm(b.url), b]));
const findBlob = u => blobByUrl.get(u) || blobByNorm.get(norm(u));

// ── 2. Project documents ─────────────────────────────────────────────────────
const idx = (await getJson(`${BASE}/api/getIndex?userId=${UID}`)).json;
if (!idx) { console.error('getIndex failed'); process.exit(1); }
const indexIds = new Set(idx.projectIds || []);
// Blob names are <projectId>/<siId>/<file>; a prefix the index no longer lists may
// still have a (tombstoned, trash-restorable) doc — fetch those too.
const prefixIds = new Set(blobs.map(b => b.name.split('/')[0]));
const allIds = new Set([...indexIds, ...prefixIds]);

const live = new Map();        // url -> { pid, where }  photos the app displays
const mentioned = new Set();   // norm(url) of ANY storage URL anywhere in any doc
const tombFiles = new Set();   // filenames the app deliberately deleted (photo tombstones)
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
  const { status, json: p } = await getJson(`${BASE}/api/getProject?id=${encodeURIComponent(pid)}`);
  if (!p) { projects.set(pid, { name: `(no doc — HTTP ${status})`, inIndex: indexIds.has(pid), noDoc: true }); continue; }
  projects.set(pid, { name: p.name || pid, inIndex: indexIds.has(pid), deleted: !!p._deleted });
  deepScan(p);
  const addLive = (url, where) => { if (url && /^https?:/.test(url)) live.set(url, { pid, where }); };
  if (p.coverPhoto && !p.coverPhoto.startsWith('data:')) addLive(p.coverPhoto, 'cover photo');
  for (const it of p.items || []) {
    Object.keys(it.photoTombstones || {}).forEach(k => tombFiles.add(k.split('/').pop().split('?')[0]));
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
const livePics = new Set(blobs.filter(b => liveNorm.has(norm(b.url))).map(picKey));
const tombPics = new Set(blobs.filter(b => tombFiles.has(b.name.split('/').pop())).map(picKey));
// duplicate  — spare copy of a picture its item still shows        → safe to delete
// tombstoned — picture (or a copy of one) the user deleted on purpose → safe to delete
// mentioned  — not displayed but a doc still names the URL           → review
// UNSHOWN    — the picture appears in NO item and was never deliberately deleted:
//              possibly lost from the project. Recover via Admin → Recovery, don't delete.
const classify = b => livePics.has(picKey(b)) ? 'duplicate'
  : (tombFiles.has(b.name.split('/').pop()) || tombPics.has(picKey(b))) ? 'tombstoned'
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
console.table(rows);

const byClass = { duplicate: [], tombstoned: [], mentioned: [], UNSHOWN: [] };
orphans.forEach(b => byClass[classify(b)].push(b));
const sum = l => `${l.length} files · ${MB(l.reduce((s, b) => s + b.size, 0))} MB`;
console.log(`\nStorage: ${sum(blobs)}   |   live photo references: ${live.size} across ${indexIds.size} indexed projects`);
console.log(`\nPICTURE HEALTH`);
console.log(`  missing from storage : ${missing.length}`);
console.log(`  zero-byte files      : ${empty.length}`);
console.log(`  never uploaded (no url in cloud doc): ${noCloudCopy.length}`);
[...missing, ...empty].slice(0, 25).forEach(m => console.log(`    ✗ ${m.project} · ${m.where} · ${m.url}`));
noCloudCopy.slice(0, 25).forEach(m => console.log(`    ⧗ ${m.project} · ${m.where} · photo ${m.photoId}${m.hasInlineData ? ' (inline data in doc)' : ''}`));
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
Object.entries(unshownBy).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`      ${String(n).padStart(3)} pictures  ${k}`));
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
newDup.slice(0, 10).forEach(b => console.log(`    ${b.createdOn}  ${b.name}`));
if (process.argv.includes('--check') && (newDup.length || liveMissing.length)) process.exitCode = 1;

if (OUT) {
  writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), base: BASE, missing, empty, noCloudCopy, shownTwice,
    orphans: orphans.map(b => ({ ...b, class: classify(b) })) }, null, 2));
  console.log(`\nFull lists written to ${OUT}`);
}
