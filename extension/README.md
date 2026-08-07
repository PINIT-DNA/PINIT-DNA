# Pinit HUB (Chrome Extension)

Store / display name: **Pinit HUB**  
Feature mode: Event-Driven Protection Engine (adapters detect; Intent + Policy decide)  
Version: **1.5.0**

## Architecture (v1.5)

```
Platform Adapter → PlatformEvent
        ↓
Intent Engine (VIEW|UPLOAD|EXPORT|PUBLISH|VERIFY|MANUAL_PROTECT)
        ↓
Protection Policy Engine (Should Protect?)
        ↓
Protection Pipeline → Platform Links → Monitoring
```

Adapters **never** call protect. Popup shows **Protection Preview** (Viewer vs Creator).

See: `docs/PINIT_EXTENSION_EVENT_DRIVEN_PROTECTION_ENGINE.md`

| Mode | When | Auto-protect |
|------|------|--------------|
| **Viewer** | Browsing feeds, watch pages, shorts, search | Never |
| **Creator** | Upload/export surfaces (Studio, compose, file picker) | Yes — DNA → Vault → Cert → Monitoring |
| **Manual** | Right-click Protect / Verify | Only on explicit user action |

Every protect stores: `captureReason`, `ownerAction`, `captureMethod`, `platformType`.

## Load (Chrome or Edge)

1. Open `chrome://extensions` or `edge://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this `extension/` folder
4. After code changes → click **Reload**, then **refresh** open tabs
5. Open **Extension options** → Save (localhost or production URLs)
6. Popup → **Sign in to PinIT**

## Modes

| Mode | How |
|------|-----|
| **Verify** | Right-click image → Verify with PinIT |
| **Protect** | Right-click image → Protect with PinIT (manual, any site) |
| **Publish Guardian** | On creator surfaces only — file picker / export → `publish-protect` |
| **Monitoring** | Starts only after a successful protect |

## Supported platforms (creator-gated)

**Social:** Instagram, Facebook, X, Pinterest, LinkedIn, Telegram Web (public)  
**Creators:** YouTube Studio, TikTok Web, Threads, Reddit, Tumblr, Medium, Substack, Patreon, Vimeo, Twitch, Behance, Dribbble, ArtStation, DeviantArt  
**Business:** GitHub, Canva, Figma, Shopify Admin, WordPress Admin  

Private DMs / WhatsApp / Discord private remain out of scope.

## Options

- API base (default `http://localhost:4000/api/v1`)
- Hub base (default `http://localhost:3000`)
- Per-platform toggles (grouped Social / Creators / Business)

## Production

Set API to `https://pinit-dna-backend.onrender.com/api/v1` and Hub to `https://dna-pinit-web.vercel.app` (or your production Hub URL).

## Test checklist

1. Backend + Hub running (or production URLs)
2. Sign in via popup
3. Browse YouTube **watch** / Instagram **feed** → confirm no auto-protect (`adapter.viewer_mode` in telemetry)
4. YouTube **Studio** upload → exactly one protected asset with `captureReason: publish`
5. Right-click any image → Protect with PinIT → `captureReason: manual`
6. Toggle a platform off in Options → uploads on that site should skip
