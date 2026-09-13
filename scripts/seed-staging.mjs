#!/usr/bin/env node
// Copies the production workspace (index + every live project) into a
// staging deployment through the public API — no credentials needed.
//
//   node scripts/seed-staging.mjs https://<staging-host>            (dry run)
//   node scripts/seed-staging.mjs https://<staging-host> --apply
//
// Photo entries keep their production blob URLs (the container is public-read,
// so staging shows the same pictures). Deleting a photo in staging is harmless:
// staging's deleteBlob only accepts URLs inside ITS container (site-photos-dev),
// so production files are never touched.

const PROD  = process.env.PROD || 'https://adhsiteaudit.com';
const UID   = process.env.ADH_USER_ID || '25a348bbf3bb4e9087aefec8b88424b6';
const TARGET = (process.argv[2] || '').replace(/[/]+$/, '');
const APPLY = process.argv.includes('--apply');
if (!/^https?:/.test(TARGET)) { console.error('usage: node scripts/seed-staging.mjs https://<staging-host> [--apply]'); process.exit(1); }
if (TARGET.replace(/^https?:[/][/]/, '') === PROD.replace(/^https?:[/][/]/, '')) { console.error('refusing to seed production into itself'); process.exit(1); }

const post = (base, path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const idx = await (await fetch(`${PROD}/api/getIndex?userId=${UID}`)).json();
console.log(`source: ${PROD} — ${idx.projectIds.length} projects, ${idx.folders.length} folders, ${idx.contacts.length} contacts`);
console.log(`target: ${TARGET}${APPLY ? '' : '  (dry run — add --apply to write)'}`);

let ok = 0, fail = 0, skipped = 0;
for (const pid of idx.projectIds) {
  const r = await fetch(`${PROD}/api/getProject?id=${encodeURIComponent(pid)}`);
  if (r.status !== 200) { skipped++; continue; }
  const p = await r.json();
  if (p._deleted) { skipped++; continue; }
  const project = { ...p, id: pid };
  delete project._etag; delete project._rid; delete project._self; delete project._ts; delete project._attachments;
  delete project.docType; delete project.label;
  if (!APPLY) { console.log(`  would copy ${pid}  ${p.name}`); continue; }
  const s = await post(TARGET, '/api/saveProject', { project });
  const j = await s.json().catch(() => ({}));
  if (s.ok && j.ok) { ok++; console.log(`  ✓ ${pid}  ${p.name}`); } else { fail++; console.log(`  ✗ ${pid}  HTTP ${s.status} ${j.error || ''}`); }
}
if (APPLY) {
  const s = await post(TARGET, '/api/saveIndex', {
    userId: UID, folders: idx.folders, contacts: idx.contacts, settings: idx.settings || {},
    projectIds: idx.projectIds, projectTombstones: idx.projectTombstones || {}, folderTombstones: idx.folderTombstones || {},
    _savedAt: Date.now()
  });
  console.log(`index: HTTP ${s.status}`);
}
console.log(`\nprojects copied=${ok} failed=${fail} skipped=${skipped}`);
