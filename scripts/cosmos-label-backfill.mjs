#!/usr/bin/env node
// One-off: give every existing project document its `docType` / `label`
// (added in v8.53) by re-saving it through the live saveProject API.
//
// Only the identity fields are sent — the server's merge keeps every item,
// photo URL, section, schedule and env log exactly as stored (items only on
// the server side are always preserved), and `_savedAt` is echoed back so the
// "last saved" stamp does not move. `_ts` does bump, so every device pulls and
// re-merges each doc once on its next poll — the merge is idempotent.
//
// Usage:  node scripts/cosmos-label-backfill.mjs            (dry run — lists)
//         node scripts/cosmos-label-backfill.mjs --apply    (writes)
//         BASE=https://gray-stone-03fbce60f.7.azurestaticapps.net node … --apply

const BASE  = process.env.BASE || 'https://adhsiteaudit.com';
const UID   = process.env.ADH_USER_ID || '25a348bbf3bb4e9087aefec8b88424b6';
const APPLY = process.argv.includes('--apply');

const idx = await (await fetch(`${BASE}/api/getIndex?userId=${UID}`)).json();
const ids = idx.projectIds || [];
console.log(`${ids.length} projects in index ${idx.id}${APPLY ? '' : '  (dry run — add --apply to write)'}`);

let done = 0, skipped = 0, failed = 0;
for (const pid of ids) {
  const r = await fetch(`${BASE}/api/getProject?id=${encodeURIComponent(pid)}`);
  if (r.status !== 200) { console.log(`  ${pid}: HTTP ${r.status} — skipped`); skipped++; continue; }
  const p = await r.json();
  if (p.label && p.docType) { console.log(`  ${pid}: already "${p.label}"`); skipped++; continue; }
  const name = p.name || '';
  if (!APPLY) { console.log(`  ${pid}: would label "${name}"`); continue; }
  const res = await fetch(`${BASE}/api/saveProject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: { id: pid, name, ownedBy: p.ownedBy || '', _savedAt: p._savedAt } })
  });
  const j = await res.json().catch(() => ({}));
  if (res.ok && j.ok) {
    console.log(`  ${pid}: ✓ "${j.project && j.project.label}"  ${((j.bytes || 0) / 1024).toFixed(0)} KB`);
    done++;
  } else {
    console.log(`  ${pid}: ✗ HTTP ${res.status} ${j.error || ''}`); failed++;
  }
}
console.log(`\nlabelled=${done} skipped=${skipped} failed=${failed}`);
