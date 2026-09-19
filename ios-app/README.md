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
   - `ios/App/App/Info.plist` → first entry of `WKAppBoundDomains`
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

## Assets

- `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` — 1024×1024,
  no alpha. Currently upscaled from `../icon-512.png`; replace with a true
  1024 px export when there is one.
- `Splash.imageset/*` — 2732×2732 dark background with the white logo.

Regenerate both after changing the source logo (Pillow):
```sh
python3 scripts/make-assets.py   # from the repo root
```

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
