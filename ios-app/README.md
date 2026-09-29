# ADH Audit — iOS app (Capacitor shell)

A native iPhone/iPad app that wraps the hosted PWA in a WKWebView. It loads the
**deployed** site (not a bundled copy), so:

- Sign-in keeps working exactly as on the web (Static Web Apps `/.auth/login/aad`
  cookie, `/api/*` with the principal header). Nothing in `api/` changes.
- Every web deploy reaches the app instantly. The IPA only needs rebuilding when
  something native changes (icon, plist, plugins).

The web page detects the shell via `_isNativeShell()` in `index.html`
(Capacitor injects `window.Capacitor`, and the UA carries `ADHAuditNative`).

## One-time setup (on the Mac)

1. Install Node 20+ and Xcode (with the iOS platform + simulator downloaded:
   Xcode → Settings → Components).
2. The app points at the staging site
   (`proud-moss-067ef8e0f.6.azurestaticapps.net`, deployed from
   `feature/company-profiles`). To ship against production, change the
   hostname in **two** places:
   - `capacitor.config.json` → `server.url`
   - `ios/App/App/Info.plist` → `WKAppBoundDomains`: the site host, plus
     `identity.<n>.azurestaticapps.net` (same `<n>` as the site), which
     `/.auth/login` bounces through. `azurestaticapps.net` and
     `<n>.azurestaticapps.net` are public suffixes, so a bare entry for them
     is ignored by WebKit and the webview ends up on `about:blank`.
   (`WKAppBoundDomains` is what lets the service worker — offline mode — run
   inside WKWebView. The Microsoft login hosts are listed so the Entra
   redirect is allowed to navigate.)
3. In this folder:
   ```sh
   npm install
   npx cap sync ios
   npx cap open ios
   ```
4. In Xcode, select the **App** target → *Signing & Capabilities*:
   - tick *Automatically manage signing*
   - pick your Team (Apple Developer Program account)
   - the Bundle Identifier is `com.adh.fieldaudit`; change it in
     `capacitor.config.json` and the Xcode target if the company wants another.
5. Pick a simulator or a plugged-in iPad and press ▶ Run.

## Producing an IPA

Xcode → *Product → Archive* → *Distribute App*, then choose:

| Goal | Method | Review? |
|---|---|---|
| Test on the team's devices | **TestFlight** (internal testers, up to 100) | No |
| Hand an `.ipa` to install via Apple Configurator / MDM | **Ad Hoc** (registered device UDIDs, max 100/yr) | No |
| Permanent install for the whole company | **App Store → Unlisted** or Apple Business Manager custom app | Yes |

The archive needs an Apple Developer Program membership ($99/yr). An
*Organization* account needs the company's D-U-N-S number and takes a few
days to approve; an *Individual* account works immediately for TestFlight.

## Launch screen (hides the sign-in flash)

`@capacitor/splash-screen` keeps a native blue screen (logo + spinner) over the
WebView while the Static Web Apps → Microsoft sign-in round trip runs, so the
Microsoft page never flashes on launch. `index.html` calls
`_hideNativeSplash()` once the session check has passed (not at first
render: the service worker serves the page from cache *before* the session
is checked, and an expired session then bounces through Microsoft — the
splash must still be up for that). Before that redirect the page calls
`_showNativeSplash()` in case the launch splash has already timed out. The
auth gate hides the splash itself. Config lives in `capacitor.config.json` → `plugins.SplashScreen`.
`ios/App/App/AppBridgeViewController.swift` (the root view controller,
wired in `SceneDelegate.swift` and `Main.storyboard`) hides the splash on
its own when the WebView settles for 1.5 s on any page that is not our site
— an interactive Microsoft sign-in, an error page — so a first-run login is
never stuck behind it, while a silent SSO hop (auto-submits in < 1 s) stays
covered. `launchShowDuration` (20 s) is only the last-resort cap behind that. The colour is `#2563eb` in three places
that must match: the plugin config, `LaunchScreen.storyboard`, and the splash
images from `scripts/make-assets.py`.

## Assets

- `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` — 1024×1024,
  no alpha. Currently upscaled from `../icon-512.png`; replace with a true
  1024 px export when there is one.
- `Splash.imageset/*` — 2732×2732 accent-blue background, white logo at 40 %
  height (the native spinner sits at the centre).

Regenerate both after changing the source logo (Pillow):
```sh
python3 scripts/make-assets.py   # from the repo root
```

## Sign-in hosts (`server.allowNavigation`)

Capacitor's host matcher is segment-by-segment: `*.azurestaticapps.net` has
three parts, so it does **not** match `identity.6.azurestaticapps.net` or
`proud-moss-….6.azurestaticapps.net` (four parts). Any host the login round
trip visits and that is not matched is opened in Safari instead of the app,
which strands the auth cookie outside the app. Keep both the `*.` and `*.*.`
forms listed, and add any new hop (a custom domain, a federated IdP) here.

## What works / what doesn't in the shell

| Feature | Status |
|---|---|
| Sign-in, sync, IndexedDB storage | Works unchanged |
| Camera / photo picker (`<input type=file accept=image/*>`) | Works — usage strings are in Info.plist |
| Offline (service worker) | Works once `WKAppBoundDomains` has the site hostname |
| PDF export via Share sheet | Works (`navigator.share` with files) |
| Plain `<a download>` blob downloads (e.g. VCF contact export) | Not handled by WKWebView — needs a Share-sheet fallback like the PDF path |
| Closed-app push notifications | **Not yet** — WKWebView has no Web Push. Needs `@capacitor/push-notifications` + an APNs sender in `api/sendPush` (APNs key from the developer account). In-app notifications still work. |

## Updating Capacitor

```sh
npm install @capacitor/core@latest @capacitor/ios@latest @capacitor/cli@latest
npx cap sync ios
```
