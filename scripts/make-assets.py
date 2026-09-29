#!/usr/bin/env python3
"""Regenerate the iOS app icon and splash from the repo's logo files.

Run from the repo root:  python3 scripts/make-assets.py   (needs Pillow)
"""
from PIL import Image

BG = (0x16, 0x18, 0x1D)
ASSETS = 'ios-app/ios/App/App/Assets.xcassets'

# App icon: 1024x1024, no alpha (App Store rejects alpha channels).
src = Image.open('icon-512.png').convert('RGBA')
flat = Image.new('RGBA', src.size, BG + (255,))
flat.alpha_composite(src)
flat.convert('RGB').resize((1024, 1024), Image.LANCZOS) \
    .save(f'{ASSETS}/AppIcon.appiconset/AppIcon-512@2x.png')

# Splash: 2732x2732 charcoal background — the app's own nav-bar / theme colour
# (#16181d; must match plugins.SplashScreen.backgroundColor and
# LaunchScreen.storyboard) — white logo above centre: the native spinner sits
# at the exact centre, so the logo is lifted to 40% height to leave room.
SPLASH_BG = (0x16, 0x18, 0x1D)
logo = Image.open('logo-white.png').convert('RGBA').resize((560, 560), Image.LANCZOS)
splash = Image.new('RGBA', (2732, 2732), SPLASH_BG + (255,))
splash.alpha_composite(logo, ((2732 - 560) // 2, int(2732 * 0.40) - 280))
splash = splash.convert('RGB')
for name in ('splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'):
    splash.save(f'{ASSETS}/Splash.imageset/{name}')
print('icon + splash written')
