# ADH Field Audit Tool

A field-conditions audit PWA for Allegheny Diversified Holdings superintendents. One app to record site conditions (Scope Items with photos, notes, statuses, field-check codes), plan the 6-week look ahead, log manpower and weekly toolbox talks, pin work to floor plans, track environmental conditions, and export branded client-ready PDF reports — all offline-first.

## How it works

- **Single-page PWA** — the entire client lives in `index.html` (no build step). `sw.js` is the service worker (offline cache). `pdf-export.js` renders the audit report client-side with jsPDF.
- **Offline-first storage** — app state lives in IndexedDB (`adh_audit_db`); dirty flags persist across reloads and changes push on reconnect.
- **Cloud sync** — Azure Functions in `api/` back the sync engine: per-user index doc + one Cosmos DB document per project, item-level deep merges with per-field timestamps, ETag retries, and tombstoned deletes. Photos upload to Azure Blob Storage via short-lived SAS tokens. Duplicating a project with "keep photos" copies each blob server-side (`api/copyBlobs`) into the new project's own path, so the two projects never share files.

### Cosmos DB layout (`Auditdata` / `Audits`)

| Document id | `docType` | What it is |
|---|---|---|
| `adh-proj-proj_<name-slug>_<ts>` | `project` | One per project. Older projects have no slug (`adh-proj-proj_1787752004305`). |
| `adh-proj-…` | `project-deleted` | Tombstone left behind after a delete (tiny; keeps stale devices from resurrecting it). |
| `adh-index-<userId>` | `index` | The shared workspace index: folders, contacts, settings, project id list, device heartbeats. |
| `adh-push-<deviceId>` | `push-sub` | Web Push subscription for one device. |

Every document starts with a human-readable `label` (`"Song Teller Amenities · Marriott · 71 SI"`, `"DELETED · …"`, `"INDEX · shared workspace · 47 projects …"`). The Data Explorer item list only shows ids, so to see names paste this in **New SQL Query**:

```sql
SELECT c.id, c.label, c.docType, c._savedAt FROM c ORDER BY c.label
```

### Staging / feature branches

Never point unfinished work at the production database. The API reads `COSMOS_DB_DATABASE` (default `Auditdata`) and `AZURE_BLOB_CONTAINER`, so a staging environment gets its own data by setting:

```
COSMOS_DB_DATABASE   = Auditdata-dev      (create it in the Cosmos account: container "Audits", partition key /id)
AZURE_BLOB_CONTAINER = site-photos-dev
```

Recommended setup: a second Static Web App (Free tier) connected to the feature branch, with those two settings — it gets a stable URL that installs on an iPad as its own PWA. `scripts/seed-staging.mjs` copies the production projects into it through the public API. The production workflow also builds a preview environment for any pull request against `main`; that preview **inherits production settings**, so open the PR only when the branch is ready and set the two variables on the preview environment (Portal → Static Web App → Environment variables → pick the environment) before anyone uses its URL.

**Size limit.** Cosmos allows **2 MB per document** — measured against the live API (2026-09-12): ~1,024 typical scope items or ~488 photo-heavy ones per project (a scope item costs ~2–4 KB; each photo is a ~170-byte blob URL, the image bytes never enter Cosmos). The largest real project was 318 KB. `saveProject` refuses anything over the limit with `413 {error:"too_large", bytes}`, the app warns from 75% and shows a red toast when a project is blocked, and **Admin → System → Cloud document sizes** lists every project against the limit. Run `node scripts/cosmos-label-backfill.mjs --apply` once after deploying a label change to stamp existing documents.
- **Innergy integration** — `/api/innergy/*` proxies `app.innergy.com` server-side; the `INNERGY_API_KEY` lives in Azure app settings, never in the browser.
- **Data hierarchy** — Folders (company brands) → Projects (jobs) → Sections → Scope Items (SIs).

## Repo layout

| Path | Purpose |
|------|---------|
| `index.html` | The whole client app (views, styles, sync engine) |
| `sw.js` | Service worker — bump `CACHE_VERSION` to push an update to all devices |
| `pdf-export.js` | Client-side audit report renderer (jsPDF) |
| `manifest.json` | PWA manifest (install metadata, icons) |
| `api/` | Azure Functions: save/get index & projects, blob SAS, change log, Innergy proxy |
| `resources/` | Field library served in-app: forms, QC plans, safety programs, 52 toolbox talks |
| `logos/` | Brand logos for folder icons and report branding |
| `server.js` | Local dev server (static files + Innergy proxy); `node server.js`, port 5000 |
| `staticwebapp.config.json` | Azure Static Web Apps routing config |

## Local development

```bash
INNERGY_API_KEY=<key> node server.js   # http://localhost:5000
```

No build step — edit `index.html`, refresh. Cloud-sync endpoints 404 locally by design; the app falls back to local-only storage.

## Deploying

Pushes to `main` deploy via the GitHub Action (Azure Static Web Apps, `app_location: "/"`, `api_location: "api"`). **Always bump `CACHE_VERSION` in `sw.js`** so installed devices see the "New version available — Reload Now" banner.

## Versioning

The app version is the service-worker cache string (`adh-audit-v8.xx`). Current: **v8.26**.
