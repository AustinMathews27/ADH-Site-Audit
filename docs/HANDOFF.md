# Handoff — read this first, update it before you stop

## Last session
- **Device:** Windows desktop app (Claude Code)
- **Branch:** `feature/company-profiles` (no PR yet)
- **Date:** 2026-11-10
- **Summary:** Resources PDFs no longer open with `window.open` (installed app
  had no way back). New in-app viewer `docViewOpen()` (`2bf96ef`): Close / Esc /
  phone Back, zoom + pinch, fillable fields as inputs, device-local drafts,
  Save / Share a filled copy via pdf-lib. Also used for Toolbox Talks. Verified
  in the local preview (desktop + phone size); not yet on a real device or main.

## Pending
- [ ] **Ship the PDF viewer to main** — cherry-pick `2bf96ef` + bump to v8.66
      (`index.html` APP_VERSION + `sw.js` cache) if Austin wants it in production
      now, then try a form on an iPhone: Close, Back, fill, Save / Share.
- [ ] **PDF viewer follow-ups (only if asked)** — no freehand markup/signature
      on non-fillable PDFs yet; drafts are device-local only (never synced).
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
- `2bf96ef` In-app PDF viewer for Resources + Toolbox Talks (fillable forms,
  drafts in IndexedDB `docfill_<file>`, Save / Share via pdf-lib); `server.js`
  decodes `%20` so local preview serves resource files.
- `f1ca094` main merged into the branch (Project Book, AFQC report, per-day SI
  history, v8.65). `0bfdd60` → main as `c929e20`, bump `1bc70c9` (v8.65).
- `0bfdd60` PDF export: logos classified dark/light/dual (`_logoTone`), contrast
  plate drawn by `drawLogo()` / `logoImg()` only when tone matches the background;
  `COMPANY_DEFAULT_LOGO` loads each company's bundled file on selection (ACD →
  `acd-light.png`, ACM → `acm-light.png`); picked file stored per company
  (`logoFiles`); cleared logo = `null` (no re-default); `_shrinkLogo` caps stored
  logos at 1000 px and migrates old ones; `addImage(..., 'FAST')`.
- `77382f8` Phone SI editor: only the camera FAB at the bottom; Prev/Next/Duplicate/
  Delete in the ⋯ sheet, Delete in the row menu; banners below the top bar.
  Shipped to main as v8.60 (cda9ada). `e12f87e` merged main v8.59 into the branch.
- Back button climbs one folder level at a time (`_folderChain`): nested
  folder → company folder → home, instead of jumping straight home
- `8416300` Phone layout v2: SI list is the project screen, one ⋯ menu
  (`showPhoneMenu`), `navToOverview` screen, iOS-style back, status bar fix,
  bottom nav/drawer removed, duplicate "updated by" badge fixed
- `260eaad` iOS shell runs in the simulator with Entra sign-in completing in-app
  (fixes: allowNavigation segment-count wildcards; WKAppBoundDomains must name
  each SWA host in full because azurestaticapps.net is a public suffix)
- `9dbc2a6` Capacitor iOS shell (`ios-app/`), Info.plist permissions + app-bound
  domains, icon/splash, `_isNativeShell()` gating in `index.html`
- `ece9678` Entra ID sign-in with offline-first identity (staging)
- `73c54b8` AML temporary SVG wordmark
- `96dfe2b` Rename company ADH → AML (legacy id `adh` kept)
- `dc2064a` Company profiles slice 1 (per-company import buttons, companyId stamp)
- `ff0f28c` Staging: configurable Cosmos DB name + seed script

## Decisions
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
