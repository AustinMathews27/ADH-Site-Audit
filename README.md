# ADH Field Audit Tool

A field-conditions audit PWA for Allegheny Diversified Holdings superintendents. One app to record site conditions (Scope Items with photos, notes, statuses, field-check codes), plan the 6-week look ahead, log manpower and weekly toolbox talks, pin work to floor plans, track environmental conditions, and export branded client-ready PDF reports — all offline-first.

## How it works

- **Single-page PWA** — the entire client lives in `index.html` (no build step). `sw.js` is the service worker (offline cache + background sync). `pdf-export.js` renders the audit report client-side with jsPDF.
- **Offline-first storage** — app state lives in IndexedDB (`adh_audit_db`); edits queue while offline and flush on reconnect (page + Background Sync).
- **Cloud sync** — Azure Functions in `api/` back the sync engine: per-user index doc + one Cosmos DB document per project, item-level deep merges with per-field timestamps, ETag retries, and tombstoned deletes. Photos upload to Azure Blob Storage via short-lived SAS tokens.
- **Innergy integration** — `/api/innergy/*` proxies `app.innergy.com` server-side; the `INNERGY_API_KEY` lives in Azure app settings, never in the browser.
- **Data hierarchy** — Folders (company brands) → Projects (jobs) → Sections → Scope Items (SIs).

## Repo layout

| Path | Purpose |
|------|---------|
| `index.html` | The whole client app (views, styles, sync engine) |
| `sw.js` | Service worker — bump `CACHE_VERSION` to push an update to all devices |
| `pdf-export.js` | Client-side audit report renderer (jsPDF) |
| `manifest.json` | PWA manifest (install metadata, icons) |
| `api/` | Azure Functions: save/get index & projects, patchAudit, blob SAS, change log, Innergy proxy |
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

The app version is the service-worker cache string (`adh-audit-v8.xx`). Current: **v8.23**.
