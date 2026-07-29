# PinIT Chrome Extension — Publish Guardian

## Load (Chrome or Edge)

1. Open `chrome://extensions` or `edge://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this `extension/` folder
4. After code changes → click **Reload**
5. Open **Extension options** → Save (localhost or production URLs)
6. Popup → **Sign in to PinIT**

## Modes

| Mode | How |
|------|-----|
| **Verify** | Right-click image → Verify with PinIT |
| **Protect** | Right-click image → Protect with PinIT (any site) |
| **Publish Guardian** | On supported sites, choosing a file to post captures bytes and calls `publish-protect` |
| **Monitoring** | Hub Monitoring engine — discoveries attach to Protected Posts |

## Supported platforms (v1.1)

**Social:** Instagram, Facebook, X, Pinterest, LinkedIn, Telegram Web (public)  
**Creators:** YouTube/Studio, TikTok Web, Threads, Reddit, Tumblr, Medium, Substack, Patreon, Vimeo, Twitch, Behance, Dribbble, ArtStation, DeviantArt  
**Business:** GitHub, Canva (uploads), Figma (uploads), Shopify Admin, WordPress Admin  

Private DMs / WhatsApp / Discord private remain out of scope.

## Options

- API base (default `http://localhost:4000/api/v1`)
- Hub base (default `http://localhost:3000`)
- Per-platform toggles (grouped Social / Creators / Business)

## Production

Set API to `https://pinit-dna-backend.onrender.com/api/v1` and Hub to `https://dna-pinit-web.vercel.app`.

## Test checklist

1. Backend + Hub running (or production URLs)
2. Sign in via popup
3. Right-click any image → Protect with PinIT → check badge ✓ and Hub **Protected Posts**
4. On Instagram (or Canva/YouTube Studio) select a file to upload → protect should fire
5. Toggle a platform off in Options → uploads on that site should skip
