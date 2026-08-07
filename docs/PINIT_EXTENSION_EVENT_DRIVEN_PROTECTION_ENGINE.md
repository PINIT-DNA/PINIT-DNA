# PinIT Hub Extension — Event-Driven Protection Engine

**Status:** Target architecture (implementation in progress from v1.4.0+)  
**Replaces mental model:** `Platform Adapter → Protect`  
**New mental model:** Event → Intent → Policy → Pipeline → Links → Monitoring  

---

## 1. Layered architecture (single responsibility)

```
Platform Adapter
        ↓  emits PlatformEvent only (never decides protect)
User Action Detector   (file-picker / drop / export / publish-complete / metadata)
        ↓
Intent Engine          (VIEW | UPLOAD | EXPORT | PUBLISH | VERIFY | MANUAL_PROTECT)
        ↓
Protection Policy Engine   (Should Protect? YES → pipeline / NO → ignore)
        ↓
Protection Pipeline    (DNA → Encrypt → Vault → Certificate → Asset)
        ↓
Platform Link Service  (many URLs per Asset)
        ↓
Monitoring + Timeline
```

**Hard rule:** Platform adapters **never** call protect, never create Assets, never enroll monitoring.

---

## 2. PlatformEvent contract

Adapters / detectors return structured events only:

```json
{
  "platform": "youtube",
  "action": "upload",
  "fileName": "travel.mp4",
  "pageUrl": "https://studio.youtube.com/...",
  "uploader": "@channel",
  "confidence": 100,
  "platformSurface": "studio-upload",
  "captureMethod": "file-picker",
  "dataUrl": "...",
  "postUrl": null
}
```

Allowed `action` values from adapters:

| action | Meaning |
|--------|---------|
| `upload` | User selected files for publish |
| `export` | User confirmed export/download protect |
| `drop` | User dropped files on creator surface |
| `publish_complete` | Public URL detected after prior protect |
| `page_meta` | Metadata only (no file) |
| `surface_change` | Viewer ↔ Creator surface changed (preview) |

---

## 3. Intent Engine

| Intent | Create Asset |
|--------|--------------|
| VIEW | ❌ |
| VERIFY | ❌ |
| UPLOAD | ✅ |
| EXPORT | ✅ |
| PUBLISH | ✅ |
| MANUAL_PROTECT | ✅ |
| SELF_TEST | ✅ (dev only) |

Nothing bypasses Intent Engine — not adapters, not queue flush, not self-test without classification.

---

## 4. Protection Policy Engine

Inputs: Intent + PlatformEvent + user config (platform toggles, guardian enabled, signed-in).

Outputs:

```json
{
  "shouldProtect": true,
  "reason": "Creator upload on allowlisted surface",
  "enrollMonitoring": true,
  "issueCertificate": true,
  "captureReason": "publish",
  "ownerAction": "upload",
  "captureMethod": "file-picker"
}
```

If `shouldProtect === false` → ignore (optionally update Protection Preview only).

---

## 5. Protection Pipeline (no shortcuts)

```
Original File → DNA → Encryption → Vault → Certificate → Asset
  → Platform Link → Monitoring → Timeline
```

---

## 6. Platform Link Service

One Asset → many links (Instagram, YouTube, Facebook, …).  
Late bind via `publish_complete` / `REGISTER_POST` through the same engines (intent PUBLISH, policy update-links-only).

---

## 7. Forensic WHY metadata (every Asset)

```json
{
  "captureReason": "publish",
  "captureMethod": "file-picker",
  "ownerAction": "upload",
  "platform": "youtube",
  "platformSurface": "studio-upload",
  "pageUrl": "...",
  "platformUrl": "..."
}
```

Prefer this over opaque `capturedVia` alone (keep `capturedVia` as legacy breadcrumb).

---

## 8. Strong allowlists

| Platform | Allow | Never |
|----------|-------|-------|
| YouTube | `studio.youtube.com`, `/upload`, `/create` | watch, shorts, home, search, channel browse |
| Instagram | `/create`, compose UI active | feed, reels view, stories view, explore, DMs |
| … | per-adapter path + dialog **and** file gesture | browsing alone |

---

## 9. Adapter Certification Checklist

Before an adapter is production-ready:

- [ ] Never captures while browsing  
- [ ] Never captures watched videos  
- [ ] Never captures viewed images  
- [ ] Captures only creator uploads / exports  
- [ ] Exactly one Asset per intentional upload  
- [ ] Metadata complete (WHY fields)  
- [ ] Platform URL linked (or late-bind path exists)  
- [ ] Monitoring enrolled after protect  
- [ ] Investigation can show original → leak trail  
- [ ] Protection Preview shows Viewer vs Creator correctly  

If any fail → adapter is **not** production-ready.

---

## 10. Protection Preview (transparency UX)

| Detected | Preview |
|----------|---------|
| Uploading `travel.mp4` on YouTube Studio | Will Protect: **YES** · Reason: Creator Upload · Vault/Monitoring: YES |
| Watching a video | Will Protect: **NO** · Reason: Viewer Mode |

Preview is informational; Policy Engine remains the authority.

---

## 11. Implementation map (code)

| Layer | Module |
|-------|--------|
| Events | `extension/shared/platform-events.js` |
| Intent | `extension/shared/intent-engine.js` |
| Policy | `extension/shared/policy-engine.js` |
| Adapter emit | `extension/shared/adapter-interface.js` → `PLATFORM_EVENT` |
| Orchestration | `extension/background/service-worker.js` |
| Preview UI | `extension/popup/*` + storage `protectionPreview` |
| Links | Backend `assetService.upsertPlatformLink` |

---

*This document is the north star for all extension work after the v1.4.0 creator-intent gate.*
