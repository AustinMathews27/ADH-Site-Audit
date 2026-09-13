#!/usr/bin/env node
// Lists every project document in Cosmos with its size against the 2 MB limit
// and where the bytes go (items / photo tombstones / activity log / env logs).
// Read-only — goes through the public getIndex/getProject API, no credentials.
//
// Usage:  node scripts/cosmos-doc-sizes.mjs
//         BASE=https://gray-stone-03fbce60f.7.azurestaticapps.net node scripts/cosmos-doc-sizes.mjs

const BASE  = process.env.BASE || 'https://adhsiteaudit.com';
const UID   = process.env.ADH_USER_ID || '25a348bbf3bb4e9087aefec8b88424b6';
const LIMIT = 2 * 1024 * 1024;
const B     = v => Buffer.byteLength(JSON.stringify(v === undefined ? null : v));
const KB    = b => (b / 1024).toFixed(0);

const idx = await (await fetch(`${BASE}/api/getIndex?userId=${UID}`)).json();
console.log(`index ${idx.id}: ${KB(B(idx))} KB — ${(idx.projectIds || []).length} projects, ${Object.keys(idx.devices || {}).length} devices\n`);

const rows = [];
for (const pid of idx.projectIds || []) {
  const r = await fetch(`${BASE}/api/getProject?id=${encodeURIComponent(pid)}`);
  if (r.status !== 200) { rows.push({ id: pid, name: `HTTP ${r.status}` }); continue; }
  const p = await r.json();
  const items = p.items || [];
  const tombBytes = items.reduce((a, i) => a + (i.photoTombstones ? B(i.photoTombstones) : 0), 0);
  rows.push({
    id: pid, name: (p.name || '').slice(0, 44), label: p.label || '(no label yet)',
    KB: +KB(B(p)), pct: +((B(p) / LIMIT) * 100).toFixed(1),
    SI: items.filter(i => !i._deleted).length,
    photos: items.reduce((a, i) => a + (i.photos || []).length, 0),
    itemsKB: +KB(B(items)), tombKB: +KB(tombBytes), activityKB: +KB(B(p.activityLog)), envKB: +KB(B(p.envData)),
  });
}
rows.sort((a, b) => (b.KB || 0) - (a.KB || 0));
console.table(rows.map(({ label, ...r }) => r));
console.log('\nlabels:'); rows.forEach(r => console.log(`  ${r.id.padEnd(48)} ${r.label}`));
