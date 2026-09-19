# Plan — bullet-proof offline for the iOS app (bundled shell + token auth)

Status: **agreed 2026-09-19, not started.** Work it top to bottom; each phase
ships on its own and leaves the web PWA working unchanged.

## Why

Today `ios-app/` loads the hosted site in a WKWebView. Audit data is already
offline-first (IndexedDB + dirty-tracking sync engine, `index.html` "SYNC
ENGINE v5"), but the *app shell itself* comes from the network: with no
signal and no cached service worker the app cannot even open. Bundling the
web files inside the IPA removes that dependency. The one thing bundling
breaks is sign-in: Static Web Apps cookie auth (`/.auth/*`, principal header)
only works when the page is served from the site. So the app needs its own
sign-in (MSAL on the device) and the API must accept a bearer token.

Not changing: IndexedDB stays the local store (localStorage is 5 MB, strings
only, main-thread blocking — the app moved off it on purpose). Cosmos/Blob
stay the cloud store. The sync engine stays as is.

## Phase A — API accepts a bearer token (backend, backward compatible)

Goal: every function works for BOTH the web app (SWA cookie → principal
header) and the native app (`Authorization: Bearer <Entra access token>`).

1. Entra app registration (Azure portal → App registrations → New):
   - Name `ADH Audit Native`, single tenant.
   - Platform **iOS/macOS**, bundle id `com.adh.fieldaudit` → gives the
     redirect URI `msauth.com.adh.fieldaudit://auth`.
   - Expose an API scope on the SAME registration (e.g. `access_as_user`) so
     the token audience is this app; note **Application (client) ID**,
     **Tenant ID**, scope URI `api://<client-id>/access_as_user`.
2. `api/_shared/auth.js`: add `verifyBearer(req)` — validate the JWT with the
   tenant's JWKS (`https://login.microsoftonline.com/<tenant>/discovery/v2.0/keys`),
   check `aud` = client id, `iss` = tenant, `exp`. Use `jose` (add to
   `api/package.json`). Return the same shape as `parsePrincipal`
   (`{ identityProvider:'aad', userId: oid, userDetails: preferred_username, userRoles:['authenticated'] }`).
3. `requireUser`: principal header first; else bearer; else **401**. Keep the
   `ALLOWED_EMAIL_DOMAINS` check for both paths.
4. `staticwebapp.config.json`: change `"/api/*"` from `authenticated` to
   `anonymous` — the edge would otherwise 401 bearer requests before they
   reach the function. Auth is now enforced in `requireUser` on every
   function (grep: every `api/*/index.js` already calls it — verify none is
   missed). Add `Authorization` to CORS allowed headers if SWA CORS is
   configured; the native origin is `capacitor://localhost`.
5. Env on both SWAs: `ENTRA_TENANT_ID`, `ENTRA_NATIVE_CLIENT_ID`.
6. Test: `curl -H "Authorization: Bearer <token from step C>" .../api/getIndex`
   → 200; no header → 401; web app unchanged.

## Phase B — client: one door for API calls (web-safe refactor)

Goal: the page can be served from `capacitor://localhost` and still talk to
the API.

1. `index.html`: add `const API_BASE = _isNativeShell() ? 'https://<site host>' : '';`
   and make **every** API call go through `_authFetch(API_BASE + '/api/...')`.
   Today only 5 calls use `_authFetch`; ~19 call `fetch('/api/...')` directly
   (`copyBlobs, deleteBlob ×7, getBlobSasUrl ×2, getIndex, innergy ×2,
   listBlobs ×2, logChange, savePushSub ×2, sendPush`) plus the ones in the
   sync engine (`saveIndex`, `saveProject`). Grep `fetch('/api/` until zero.
2. `_authFetch`: when native, attach `Authorization: Bearer` from the token
   provider in Phase C; on 401 try one silent token refresh, then show the
   auth gate.
3. `_getAuthUser`: branch on `_isNativeShell()` — native uses the MSAL
   account (Phase C) instead of `/.auth/me`; the cached-identity/offline
   behaviour stays identical.
4. Sign-out button: native → MSAL sign-out instead of `/.auth/logout`.
5. Service worker: skip `navigator.serviceWorker.register` when native
   (assets are local); keep the version banner logic web-only.
6. Manifest injection + iOS install hint: already gated by `_isNativeShell()`.
7. Ship this phase to the web first — it is a no-op there — and confirm
   nothing regressed on an iPad PWA.

## Phase C — sign-in on the device (MSAL)

1. `ios-app`: `npm i @recognizebv/capacitor-plugin-msauth` (native MSAL for
   iOS; confirm it is still maintained for Capacitor 8 — fallback is
   `capacitor-plugin-msal` or a thin custom plugin around MSAL.framework).
   Info.plist: `CFBundleURLTypes` with `msauth.com.adh.fieldaudit`,
   `LSApplicationQueriesSchemes` `msauthv2`, `msauthv3` (plugin README).
2. `index.html`: `_nativeToken()` → plugin `login({ clientId, tenant, scopes:[api scope] })`
   silently, interactive on first run / when silent fails. Cache the account
   id in IndexedDB next to the existing cached identity so offline start-up
   never prompts.
3. Test in the simulator: first launch prompts once, relaunch is silent,
   airplane-mode launch opens with cached identity and data.

## Phase D — bundle the web app inside the IPA

1. `ios-app/scripts/bundle-www.sh`: copy `index.html`, `pdf-export.js`,
   `sw.js` (unused but harmless), `manifest.json`, `vendor/`, `logos/`,
   `icon-*.png`, `logo*.png`, `favicon.ico` from the repo root into
   `ios-app/www/`; add `www/` to `.gitignore` (generated). Wire it into
   `package.json` as `prebuild` so `npm run sync` = bundle + `cap sync ios`.
2. `capacitor.config.json`: remove `server.url`; keep `allowNavigation` for
   the login hosts only if the plugin opens login in the WebView (it uses
   ASWebAuthenticationSession, so normally none needed). Drop
   `limitsNavigationsToAppBoundDomains` + `WKAppBoundDomains` (no service
   worker to protect any more) — leave them only if Phase B keeps the SW.
3. Google Fonts are CDN-loaded in `index.html`; offline start-up must not
   depend on them — either self-host in `vendor/` or keep the `font-display:
   swap` fallback and verify the app opens in airplane mode on first launch.
4. Blob photo upload/download uses SAS URLs to `*.blob.core.windows.net`
   (cross-origin already) — unchanged.
5. Innergy import goes through `/api/innergy/*` — covered by Phase B.

## Phase E — updates without an App Store release

Bundled files only change with a new IPA. Options, pick one before shipping
to the team:
- **Simple**: keep the existing "new version available" check (it fetches
  `index.html` from the network) and, when native, show "update the app"
  instead of reloading. TestFlight/ad hoc builds are cheap to push.
- **Better**: Capgo (or Ionic Appflow) live updates — swaps `www/` over the
  air on launch. Adds a vendor; decide later.

## Phase F — test matrix before distributing

| Case | Expect |
|---|---|
| Fresh install, online | one MSAL prompt → dashboard |
| Relaunch, online | silent, no prompt |
| Airplane mode, previously signed in | opens, data intact, edits queue |
| Back online | dirty projects push within 30 s, no duplicates |
| Camera photo → PDF export → Share | works |
| Token expired (>1 h) mid-session | silent refresh, no gate |
| Web PWA on an iPad | unchanged (cookie auth, SW updates) |

## Later / out of scope for this plan
- Closed-app push (APNs) — separate item in HANDOFF.
- `<a download>` exports → Share-sheet fallback.
- Photos in Capacitor Filesystem instead of IndexedDB blobs — only if IDB
  quota ever becomes a problem on a device.
