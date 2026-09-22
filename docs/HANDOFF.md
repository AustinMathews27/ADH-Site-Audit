# Handoff — read this first, update it before you stop

## Last session
- **Device:** Windows desktop app (Claude Code)
- **Branch:** `feature/company-profiles` (no PR yet)
- **Date:** 2026-09-22
- **Summary:** Phone layout v2 (`8416300`): on phones a project opens straight
  onto its scope-item list, every other option sits behind one ⋯ menu sheet,
  iOS-style "‹ Parent" back button, bottom nav + Browse drawer removed, nav bar
  extends under the iOS status bar. Verified in the desktop browser at phone
  size; needs a real-iPhone check on staging.

## Pending
- [ ] **Phone layout v2 — check on a real iPhone** (staging) — status bar on
      charcoal, "‹ Parent" back button, ⋯ menu sheet, SI list as the project
      screen, Overview screen, camera FAB position. Tablet/desktop unchanged.
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
- [ ] **iOS app: run on a real iPad/iPhone** — plug in, pick it in Xcode's device
      picker, Run (free Apple ID works for 7-day dev builds).
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
- [ ] **Version bump** — code still says v8.53; `main` shipped v8.54. Bump
      `index.html` version + `sw.js` cache name before merging this branch.
- [ ] **Entra sign-in is staging-only** — set `ALLOWED_EMAIL_DOMAINS` on the
      Static Web App before enabling on prod; `scripts/*.mjs` stop working
      anonymously once auth is on (see README "Sign-in").
- [ ] **Open a PR** for `feature/company-profiles` → `main` when ready.
- [ ] **Stale PR #3 "task 1"** (`hardening/deps-offline`, July) — close or rebase.

## Done (recent)
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
