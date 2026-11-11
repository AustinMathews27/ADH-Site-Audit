# Handoff — read this first, update it before you stop

## Last session
- **Device:** Windows desktop app (Claude Code)
- **Branch:** `feature/company-profiles` (no PR yet)
- **Date:** 2026-11-11
- **Summary:** Added the weekly photo audit's 3 read-only secrets (Austin ran
  the commands); the audit now reads Azure directly and passes after Austin
  removed 14 dead photo tiles (none from after the v8.68 release); issue #5
  closed.
  Previous session (2026-11-10): v8.68 bug-list fixes shipped to production
  (main `5b07ca5`) and main merged back into this branch (`bdddd86`).

## Pending
- [ ] **Device tests for v8.68** — iPad report share sheet; push notification
      re-subscribe + tap opens its link; app start on one bar of signal (3 s
      cache fallback); offline PDFs still there after the next update; Admin →
      Force refresh then offline pdf.js; a very large report (800+ photos) on
      iOS; Android system Back steps back inside the app.
- [ ] **Innergy import after v8.68** — the proxy now accepts only GUID-style
      project ids; if an import says "not found", widen `INNERGY_ID` in
      `api/innergy/index.js`.
- [ ] **Upload retry check needs storage CORS to allow HEAD** — otherwise a
      retried upload whose first try landed fails as before (no data loss).
- [ ] **Check one project wasn't set back by an old-copy push** — on
      2026-11-11 10:42 UTC a crew device pushed a July copy of a project
      (its re-added dead photos are now removed); its SIs have no field
      stamps, so statuses / notes may have reverted too. Name: run
      `node scripts/photo-audit.mjs` locally or ask Claude (never in CI).
- [ ] **Confirm the 2026-11-11 storage cleanup** — it also deleted 9 of the
      17 "may be lost" pictures (14 files); 8 remain. OK if chosen on purpose.
- Tip: Dead Photos only scans the device's own copies, and a running app
  only re-pulls the project that is OPEN — open the project (or reload) first.
- [ ] **Renew the audit's storage access rule before 2027-11-11** —
      `az storage container policy update --account-name adhauditphotos
      --container-name site-photos --name weekly-audit --expiry <date>
      --auth-mode key`; the `AUDIT_STORAGE_SAS` secret stays the same.
- [ ] **Report notes spacing (found, not fixed)** — notes reserve 4.6 mm per
      line but print 3.65 mm apart, leaving ~20% blank space under long notes.
- [ ] **Check v8.67 on an iPhone** — Resources → open a fillable form
      (e.g. QA QC Appendix D): ✕ Close works, tapping a box zooms in, ✍ Sign
      box opens the pad, draft survives closing, Save / Share sends a filled
      PDF with the signature in its box.
- [ ] **PDF viewer follow-ups (only if asked)** — no freehand markup on
      non-fillable PDFs yet; drafts are device-local only (never synced).
- [ ] **Check v8.65 on a device** — export a Flow-style report for an ACD or ACS
      project: logo should sit on a white plate in the hero; file should be well
      under 1 MB (was 15–39 MB with a full-size logo).
- [ ] **Graph names: needs the Entra admin** — code is in (`api/_shared/graph.js`,
      `/api/getProfile`, README "People's names"). Ask the admin for an App
      registration `ADH Audit API` with APPLICATION permission
      `User.ReadBasic.All` + consent + a client secret, then set
      `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` on both SWAs.
      Until then names fall back to the email prefix (Account menu says
      "name from email"). This can be the SAME registration as the iOS-plan
      one if the admin prefers one app.
- [ ] **Verify v8.62 on devices** — Entra now owns the name (device prompt
      skipped when signed in); activity log + AuditLog entries carry
      `byEmail` and `device {id,name,type,client,os}`; Users tab shows device
      type. Check a phone edit then an iPad edit on the same project show
      "Austin's iPhone (app)" vs "Austin's iPad".
- [ ] **iOS app: verify the launch screen on iPhone** — the SW-cached path
      (page → session check → Microsoft SSO → back) overran the 7 s cap, so the
      splash dropped mid-login. Now: `AppBridgeViewController.swift` hides the
      splash natively only when the WebView settles ≥1.5 s off our host
      (interactive login / error page); cap raised to 20 s; page still hides on
      success. Needs `git pull && npx cap sync ios` + rebuild in Xcode (native
      change). Expect charcoal → dashboard; first-run login appears after ~2 s.
- [ ] **iOS offline plan — Phase A BLOCKED on Entra permissions** —
      `docs/IOS-OFFLINE-PLAN.md`. Austin has no rights to create an App
      registration in the company tenant; access (Application Developer role, or
      an admin-created registration named "ADH Audit Native", platform iOS,
      bundle id `com.adh.fieldaudit`) has been requested. Once granted, the
      values needed are the Application (client) ID and Directory (tenant) ID.
      Steps A.2–A.4 (`verifyBearer` in `api/_shared/auth.js`, `/api/*` →
      anonymous) can be coded before then; only testing needs the IDs.
- [ ] **iOS app: point at production before release** — shell currently loads
      the staging SWA (`proud-moss-067ef8e0f.6.azurestaticapps.net`); swap the
      hostname in `capacitor.config.json` + `Info.plist` for the prod URL.
- [ ] **iOS app: Apple Developer Program** — needed for TestFlight / ad hoc /
      App Store archive. Organization account needs the company D-U-N-S number.
- [ ] **iOS app: closed-app push** — WKWebView has no Web Push. Needs
      `@capacitor/push-notifications` + APNs sending in `api/sendPush`
      (device token stored beside the web subscription in `savePushSub`).
- [ ] **iOS app: `<a download>` exports** — VCF contact export and similar
      blob downloads don't work in WKWebView; give them the Share-sheet
      fallback the PDF export already uses.
- [ ] **iOS app: real 1024px icon** — current AppIcon is upscaled from
      `icon-512.png` (`scripts/make-assets.py` regenerates).
- [ ] **Company profiles slice 2+** — slice 1 only gates import buttons per
      company (`COMPANY_PROFILES` in `index.html`). Decide and build what else a
      profile controls (branding, PDF defaults, project types, etc.).
- [ ] **Real AML logo** — `logos/aml.svg` is a temporary wordmark. PDF branding
      entry still uses id `adh` / `logos/adh.png` because stored logos are keyed by it.
- [ ] **Docs stale** — `docs/FULL-GUIDE.md` still lists ADH instead of AML and
      neither guide mentions company profiles or Entra sign-in (README does).

- [ ] **Entra sign-in is staging-only** — set `ALLOWED_EMAIL_DOMAINS` on the
      Static Web App before enabling on prod; `scripts/*.mjs` stop working
      anonymously once auth is on (see README "Sign-in").
- [ ] **Open a PR** for `feature/company-profiles` → `main` when ready.
- [ ] **Stale PR #3 "task 1"** (`hardening/deps-offline`, July) — close or rebase.

## Done (recent)
- 2026-11-11 photo audit passes again (0 live pictures missing); 14 dead
  tiles removed via Admin → Dead Photos; issue #5 closed.
- 2026-11-11 weekly photo audit secrets added (`AUDIT_COSMOS_CONNECTION_STRING`
  = read-only key, `AUDIT_STORAGE_ACCOUNT`, `AUDIT_STORAGE_SAS` = read + list
  via the `weekly-audit` access rule); manual run used the direct read.
- `bdddd86` main merged back into the branch (history only; tree unchanged —
  conflicts were main's left-out branch-only parts, kept the branch side).
- `5b07ca5` → main: v8.68 shipped to PRODUCTION (fast-forward from
  `release/v8.68`; branch-only parts left out). 21 node suites + local
  preview of main's build passed first.
- `94813e5` v8.68: every item on the 2026-11-10 bug list fixed (local-only
  list); 22 node suites + local-preview checks pass. Not yet on main.
- Bug review list written (local only, no commit); local preview checks
  reproduced C1, C2, H1.
- `7517304` PDF viewer: /Sig fields get a signature pad; image stamped into the
  field's boxes on Save / Share. Shipped as v8.67 (`6aa2773` + `e613d2f`).
- `679058b` + `a3273f0` → main: PDF viewer shipped as v8.66; `5a28750` main merged
  back into the branch.
- `2bf96ef` In-app PDF viewer for Resources + Toolbox Talks (fillable forms,
  drafts in IndexedDB `docfill_<file>`, Save / Share via pdf-lib); `server.js`
  decodes `%20` so local preview serves resource files.

## Decisions
- 2026-11-11 — Audit SAS is tied to a stored access rule (`weekly-audit`), so it
  can be renewed or revoked in Azure without changing the GitHub secret.
- 2026-11-10 — Austin: ship the v8.68 fixes straight to production (main
  fast-forwarded to `release/v8.68`, no PR — a PR preview would run on
  production settings).
- 2026-11-10 — Austin: fix every item on the bug list; check it works; ask
  before commit + push.
- 2026-11-10 — Defaults chosen for the fixes (Claude, not yet confirmed by
  Austin): cancelled Innergy WOs are skipped (old `na` → `on-hold`, `complete`
  → `completed`, repaired once); "Everyone" messages get per-device read
  receipts; an SI's labor estimate is spread evenly over its scheduled Look
  Ahead weeks; report photos are cropped to their cell (not squashed).
- 2026-11-10 — Bug review list stays OFF git for now (the repo is public and the
  list describes exploitable holes). Alternatives were making the repo private
  or pushing a copy without the security items.
- 2026-11-10 — PDF signature-field fix shipped straight to production as v8.67.
- 2026-11-10 — In-app PDF viewer shipped straight to production as v8.66
  (cherry-pick + version bump).
- 2026-11-10 — Resource form drafts stay on the device (not synced); the
  shared/sent PDF is the record, same as toolbox signatures. (Claude default — not yet confirmed by Austin.)
- 2026-11-08 — PDF division-logo fix shipped straight to production as v8.65
  (cherry-pick + version bump, same as the phone-layout releases). Entra and
  company profiles still stay on the branch.
- 2026-09-29 — Person identity = Entra sign-in; display name from Microsoft Graph
  (option B), email prefix until configured. Device identity stays per install
  (id + optional label) and now records type/client automatically.
- 2026-09-23 — Phone layout changes ship to main right away (cherry-pick + version
  bump); Entra + company profiles stay on the branch.
- 2026-09-23 — Phone layout v2 shipped to PRODUCTION as v8.59 (cherry-picked
  bb1effd/feb08b6/919ee57 onto main). Entra sign-in and company profiles stay on
  the branch — NOT wanted on main yet.
- 2026-09-22 — Phone layout v2 approved on staging ("working perfect so far"); Austin
  field-tests it through the week of 2026-09-22, then the branch goes to `main`.
- 2026-09-19 — Keep IndexedDB + the existing sync engine (no move to localStorage).
  "Bullet-proof offline" = bundle the web files in the IPA and switch the native
  app to MSAL + bearer tokens; plan in `docs/IOS-OFFLINE-PLAN.md`.
- 2026-09-19 — iOS shell targets the staging URL for now; switch to prod before any TestFlight/App Store build.
- 2026-09-18 — iOS app loads the **hosted** site (Capacitor `server.url`), not a
  bundled copy, so SWA cookie auth and `/api/*` stay unchanged and web deploys
  reach the app without an App Store release.
- 2026-09-18 — Every session must read/update this file and push (see `CLAUDE.md`).
- 2026-09-12 — AMI is the only company on Innergy; others import from spreadsheet or manual entry.
- 2026-09-12 — Everyone shares ONE workspace; Entra only identifies who is on the device.
