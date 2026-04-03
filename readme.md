# ADH Field Audit Tool — PWA

A fully offline-capable Progressive Web App for iOS field auditing.

## Deploy to Netlify (2 minutes)

1. Go to **netlify.com/drop**
2. Drag the entire **adh-field-audit** folder onto the page
3. Netlify gives you a URL like `https://xyz.netlify.app`

That's it — your app is live and fully offline-capable.

---

## Install on iPhone / iPad

Once deployed:

1. Open the Netlify URL in **Safari** (must be Safari for iOS PWA)
2. Tap the **Share** button (box with arrow at bottom of screen)
3. Scroll down and tap **"Add to Home Screen"**
4. Name it **ADH Audit** and tap **Add**

The app now appears on your home screen like a native app:
- Launches full-screen with no browser UI
- Works completely **offline** after first load
- Data is saved locally on the device

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | Main app (single-page) |
| `manifest.json` | PWA identity & icons |
| `sw.js` | Service Worker (offline cache) |
| `icon-192.png` | App icon (home screen) |
| `icon-512.png` | App icon (splash screen) |
| `netlify.toml` | Netlify routing & cache rules |

---

## Offline Behavior

- **First load** — app shell + fonts + jsPDF cached by Service Worker
- **Subsequent loads** — fully offline, zero network needed
- **Data** — all projects, photos, and notes stored in device localStorage
- **PDF export** — works offline (jsPDF pre-cached)
- **Updates** — SW detects new versions and shows "Update available" toast

---

## Notes

- **Storage limit** — iOS Safari gives ~50MB of localStorage. Photos compressed at export reduce PDF size.
- **Camera access** — the Camera button works natively on iOS when installed as PWA
- **Fonts** — IBM Plex fonts are cached on first load; app falls back to system fonts offline before first load
