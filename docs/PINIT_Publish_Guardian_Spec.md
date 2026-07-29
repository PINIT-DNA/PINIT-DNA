# PinIT Publish Guardian — Architecture & Product Specification

**Document status:** Implemented (additive module) — apply migration + `prisma generate` after restarting the backend so the Prisma engine unlocks.  
**Version:** 1.1  
**Date:** 2026-07-28  
**Related docs:**
- [PINIT_Browser_Extension_Quick_Solutions.md](./PINIT_Browser_Extension_Quick_Solutions.md) — verify / investigate from any page
- [DAIP-IICLME-HLD-v2.0.md](./DAIP-IICLME-HLD-v2.0.md) — continuous leak monitoring engine
- [architecture/01_UNIFIED_INVESTIGATION.md](./architecture/01_UNIFIED_INVESTIGATION.md) — investigation pipeline
- [enterprise/07_PROTECTED_DOWNLOAD_AND_TEP.md](./enterprise/07_PROTECTED_DOWNLOAD_AND_TEP.md) — tracked exports

**Product promise (approved wording):**

> Install PinIT once — when you post on supported sites in Chrome, your content is automatically protected in Vault, DNA-registered, and monitored for public copies and tampering, with alerts in PinIT Hub.

---

## 1. Overview

### 1.1 What Publish Guardian is

**PinIT Publish Guardian** is a Chrome extension mode (Manifest V3) that turns protection into a **background service at publish time**:

1. User posts content on a supported platform (e.g. Instagram Web).
2. Extension **captures** the original media (does not block or replace the platform upload).
3. PinIT backend generates DNA, stores the original in Vault, registers ownership, and optionally issues a certificate.
4. Monitoring is enrolled with the post URL as a watch target.
5. Existing crawler / monitoring / investigation engines discover public copies, score DNA matches, analyze tampering, and alert the owner.

### 1.2 What it is not

- Not a separate forensic engine (reuses DNA, Vault, Monitoring, Unified Investigation).
- Not continuous surveillance of private chats, DMs, or closed groups.
- Not control over Instagram / Meta / X / YouTube server-side files.
- Not a promise of 100% detection of every leak on earth.

### 1.3 Relationship to “Verify Extension”

| Mode | Trigger | Primary goal |
|------|---------|--------------|
| **Verify** (Phase 1) | Right-click / page scan | “Is this image ours / protected?” |
| **Publish Guardian** (Phase 2+) | Detect user publish | “Protect my new post automatically” |

Both share one extension package, one auth model, and the same backend APIs.

---

## 2. End-to-end workflow

### 2.1 Protect-on-publish (happy path)

```
User installs PinIT Extension + signs in (same PinIT Hub account)
        ↓
User enables “Publish Guardian” for Instagram (opt-in)
        ↓
User selects image/video and publishes on Instagram Web
        ↓
Extension detects publish intent / completed post
        ↓
Capture original media bytes + page/post URL + caption metadata
        ↓
POST /api/v1/extension/publish-protect
        ↓
Backend: Generate DNA → Store Vault → Register ownership → Issue certificate (if entitled)
        ↓
Backend: Enroll monitoring (watchUrls = [postUrl, profileUrl])
        ↓
Extension shows: “Protected — CERT-DNA-…” + deep link to Hub
        ↓
User continues normally on Instagram (no Hub visit required)
```

### 2.2 Discovery → alert → investigation

```
Monitor / crawler / extension profile-scan finds candidate media
        ↓
Lightweight DNA / pHash / identity compare vs Vault
        ↓
Match above policy threshold?
        ├─ No  → log rejection / discard
        └─ Yes → create incident / notification
                    ↓
              Optional: Unified Investigation (tamper %, heatmap, evidence)
                    ↓
              User opens PinIT Hub → View Investigation
```

### 2.3 Capture semantics (critical)

Correct phrasing for product and engineering:

| Say this | Do not say this |
|----------|-----------------|
| Capture original at publish | Intercept / hijack Instagram upload |
| Parallel protect + platform upload | Block publish until PinIT finishes |
| Alerts on discovery | Real-time millisecond Instagram events |
| Public / authorized content only | Monitor private DMs |

```
User selects media in Instagram
        ↓
Extension copies original bytes (before or immediately after publish)
        ↓
Parallel paths:
   ├─ Instagram upload (unchanged)
   └─ PinIT protect API (DNA + Vault + monitor)
```

---

## 3. Extension responsibilities

### 3.1 Components (Manifest V3)

| Component | Responsibility |
|-----------|----------------|
| **Service worker** | Auth tokens, API calls, context menus, publish queue, badge |
| **Content scripts** | Platform adapters (Instagram, X, …), media capture, post URL detection |
| **Popup** | Login status, Guardian toggles per platform, recent protections, open Hub |
| **Options** | Environment (prod/dev), notification prefs, auto-protect defaults |
| **Context menu** | Verify / Investigate / Report (shared with Verify mode) |

### 3.2 Publish Guardian duties

1. Detect **user-authored** publish events on enabled platforms.
2. Capture **original media bytes** (prefer file input / blob before CDN recompress when possible).
3. Capture **metadata**: `platform`, `postUrl`, `mediaUrl`, `caption`, `capturedAt`, `pageTitle`.
4. Call `publish-protect` with multipart media + metadata.
5. Show protection success / failure UI (non-blocking).
6. Retry failed protects with backoff (local queue).
7. Optional: **Scan my profile** — list recent posts, protect any not yet vaulted.
8. Never run continuous background scraping of the whole platform without user action / schedule agreed in policy.

### 3.3 Verify mode duties (shared)

1. Right-click image → quick verify (`/vault/verify-identity` or lightweight match).
2. Full investigation → SSE stream (`/forensics/unified-investigate?stream=true`).
3. Open Hub deep link with report / vault IDs.

### 3.4 Permissions (minimal)

| Permission | Why |
|------------|-----|
| `storage` | Tokens, queue, settings |
| `contextMenus` | Verify / Investigate |
| `activeTab` / host permissions | Capture media on user-enabled sites |
| Host: PinIT API | Backend calls |
| Host: platform domains (opt-in) | Instagram, X, etc. when Guardian enabled |

---

## 4. Backend responsibilities

### 4.1 Reuse existing services (no parallel DNA logic)

| Service | Role in Publish Guardian |
|---------|--------------------------|
| DNA orchestrator | Generate multi-layer DNA from captured media |
| Vault service | Encrypt + store original |
| Certificate service | Issue / derive certificate when entitled |
| Monitoring service | `enroll(dnaRecordId, { watchUrls, scanType })` |
| Image / video monitoring | Periodic candidate discovery + pHash / DNA score |
| Unified Investigation | Tamper analysis + evidence report on alert |
| Notifications / audit | Owner alerts + chain of custody |
| Auth | Extension OAuth / JWT / org API keys |

### 4.2 New thin orchestration layer

A single **extension facade** endpoint avoids forcing the extension to orchestrate DNA → vault → enroll → certificate in multiple round-trips:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v1/extension/publish-protect` | One-shot: DNA + Vault + ownership + monitor enroll + certificate |
| `POST /api/v1/extension/register-post` | Attach platform post URL to existing vault (late URL resolution) |
| `GET /api/v1/auth/extension/authorize` | Start Hub login for extension |
| `POST /api/v1/auth/extension/token` | Exchange code → access + refresh tokens |
| `POST /api/v1/auth/extension/refresh` | Refresh JWT |
| `POST /api/v1/extension/verify` | Optional thin wrapper over verify-identity (rate-limited) |

All forensic decisions remain in existing engines.

### 4.3 Audit tagging

Every protect / enroll / alert from the extension MUST record:

```json
{
  "capturedVia": "extension_publish_guardian",
  "platform": "instagram",
  "postUrl": "https://www.instagram.com/p/...",
  "extensionVersion": "1.0.0"
}
```

---

## 5. Monitoring architecture

### 5.1 Enrollment at protect time

```
publish-protect success
        ↓
monitoringService.enroll(dnaRecordId, {
  ownerUserId,
  scanType: "CONTINUOUS",
  watchUrls: [postUrl, profileUrl?]
})
```

### 5.2 Discovery sources

| Source | When | Strength |
|--------|------|----------|
| Direct `watchUrls` | Enrolled post / profile | High for that URL |
| Filename / visual search providers | Existing image monitor | Medium |
| Platform connectors (YouTube, Telegram channels, website) | Existing crawler engine | Platform-dependent |
| Extension “Scan my profile” | User-triggered | High for posts extension can see |
| Extension Verify / page scan | User-triggered | High for visible media |

### 5.3 Match → alert policy

Reuse existing monitoring thresholds (image):

| Similarity | Classification |
|------------|----------------|
| ≥ 0.95 | DUPLICATE |
| ≥ 0.80 | NEAR_MATCH |
| ≥ 0.65 | POSSIBLE |
| &lt; 0.65 | NO_MATCH (reject) |

On DUPLICATE / NEAR_MATCH (and optionally high POSSIBLE):

1. Persist crawl / match result.
2. Create Hub notification.
3. Optionally auto-queue Unified Investigation for evidence pack.
4. Deep link: `/investigation` or Forensic Reports with IDs.

### 5.4 Tampering

Tampering is **not** detected by watching Instagram’s CDN mutate a post.  
Tampering is detected when a **candidate copy** is compared to the Vault original:

- Crop / brightness / object removal / AI fill / recompress / screenshot / watermark strip  
→ Unified Investigation + DNA Difference / tamper localization (existing).

---

## 6. API contracts

### 6.1 Auth — extension login (Hub OAuth-style)

**Flow:**

1. Extension opens `https://dna-pinit-web.vercel.app/extension/auth?ext_id={chrome.runtime.id}&state={csrf}`.
2. User logs into Hub (existing auth).
3. Hub redirects / posts message with one-time `code`.
4. Extension: `POST /api/v1/auth/extension/token` with `{ code, ext_id }`.
5. Store `accessToken` + `refreshToken` in `chrome.storage.session` (preferred) or encrypted `local`.

**Token response:**

```json
{
  "success": true,
  "accessToken": "...",
  "refreshToken": "...",
  "expiresIn": 3600,
  "user": {
    "id": "uuid",
    "shortId": "PINIT-XXXXXXXX",
    "email": "optional"
  }
}
```

**Dev-only fallback (not for production):** paste Hub JWT / org API key.

### 6.2 `POST /api/v1/extension/publish-protect`

**Auth:** Bearer JWT (extension) or org API key.  
**Body:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `media` | file | Yes | Original image/video bytes |
| `platform` | string | Yes | `instagram` \| `facebook` \| `x` \| `youtube` \| `pinterest` \| `linkedin` \| `telegram` \| `github` \| `web` |
| `postUrl` | string | No | May be null until post URL is known |
| `mediaUrl` | string | No | CDN URL if available |
| `profileUrl` | string | No | Author profile URL |
| `caption` | string | No | Truncated caption |
| `pageTitle` | string | No | Document title |
| `enrollMonitoring` | `"true"` \| `"false"` | No | Default `true` |
| `issueCertificate` | `"true"` \| `"false"` | No | Default per entitlement |

**Success 201:**

```json
{
  "success": true,
  "vaultId": "uuid",
  "dnaRecordId": "uuid",
  "certificateId": "CERT-DNA-XXXXXXXX",
  "monitorId": "uuid",
  "ownership": {
    "ownerPinitId": "PINIT-XXXXXXXX",
    "registeredAt": "ISO-8601"
  },
  "message": "Protected and enrolled for monitoring"
}
```

**Errors:** `400` invalid media, `401` auth, `403` entitlement / cross-account duplicate, `409` same-file policy, `429` rate limit, `500` protect failed.

### 6.3 `POST /api/v1/extension/register-post`

Used when Instagram post URL is only known **after** publish completes.

```json
{
  "vaultId": "uuid",
  "platform": "instagram",
  "postUrl": "https://www.instagram.com/p/ABC123/",
  "mediaUrl": "https://...",
  "profileUrl": "https://www.instagram.com/username/"
}
```

**Behavior:** Update vault/DNA metadata; merge `postUrl` / `profileUrl` into monitor `watchUrls`.

### 6.4 Existing APIs (extension may call directly)

| Action | Endpoint |
|--------|----------|
| Quick verify | `POST /api/v1/vault/verify-identity` |
| Full investigation | `POST /api/v1/forensics/unified-investigate?stream=true` |
| Manual enroll | `POST /api/v1/monitoring/enroll/:dnaRecordId` |
| List vault | `GET /api/v1/vault` |
| Generate DNA (legacy path) | `POST /api/v1/dna/generate` |

### 6.5 Rate limits (proposed)

| Action | Limit (per user) |
|--------|------------------|
| `publish-protect` | 30 / hour |
| `verify` / verify-identity via extension | 60 / hour |
| `unified-investigate` | 10 / hour |
| Profile scan batch | 50 images / run |

---

## 7. Security & privacy

### 7.1 Principles

1. **Opt-in per platform** — Guardian never auto-protects until user enables that site.
2. **User-authored content only** — do not vault other people’s posts from a feed scroll.
3. **Minimal data** — send media + post metadata; no full feed scrape by default.
4. **Tokens never in content scripts** — only service worker / popup.
5. **Tenant isolation** — all Prisma queries scoped to `ownerUserId` (existing rule).
6. **Cross-account duplicate policy** — same as Hub (block DNA for another account’s protected file).
7. **Store listing honesty** — privacy policy must state: chosen media is sent to PinIT for protection and forensic analysis.

### 7.2 Legal / ToS boundaries

- No bypass of platform DRM or private API abuse.
- No monitoring of private DMs / Messenger / WhatsApp / closed Discord / private Telegram chats.
- Public content and user-authorized browser activity only (aligned with DAIP HLD).

### 7.3 Enterprise

- Org API keys (`organization/api-keys`) may authenticate extension for team seats.
- Audit events: `EXTENSION_PUBLISH_PROTECT`, `EXTENSION_VERIFY`, `EXTENSION_REGISTER_POST`.

---

## 8. Platform support matrix

| Platform | Auto-protect (Chrome Web) | Track public copies | Tamper on match | Notes |
|----------|---------------------------|---------------------|-----------------|-------|
| **Instagram** | Yes (opt-in) | Yes (public) | Yes | Blob/CDN quirks; stories expire; DMs out of scope |
| **Facebook** | Yes (opt-in) | Yes (public) | Yes | Private posts not monitorable |
| **X (Twitter)** | Yes (strong) | Yes (strong) | Yes | Public posts most accessible |
| **YouTube** | Yes | Yes | Yes | Requires video DNA / keyframes for robust match |
| **Pinterest** | Yes (strong) | Yes (strong) | Yes | Excellent image-match use case |
| **LinkedIn** | Yes (public posts) | Medium | Yes | Company/public posts feasible |
| **GitHub** | Yes | Yes (strong) | Yes | Public files/assets |
| **Telegram** | Partial | Partial | Partial | Public channels / links only |
| **Open web** | N/A (Verify mode) | Yes | Yes | Best verify/investigate experience |

### Instagram-internal scenarios

| Scenario | Detectable? |
|----------|-------------|
| User’s original public post (Guardian on) | Yes — protected at publish |
| Public re-upload / duplicate | Often yes (pHash + DNA) |
| Public reshare / embed | Sometimes — if URL reachable |
| Story reshare | Partial — short-lived, public reachability |
| Close Friends / DM | No |
| Screenshot re-upload | Often yes |
| Crop / filter / AI edit / watermark strip | Often yes on candidate match |
| Instagram edits the live post on Meta servers | No — Vault original remains proof of ownership |

---

## 9. Technical limitations

1. **Chrome Web only for Publish Guardian** — mobile Instagram/Facebook apps do not run this extension. Mobile posts need “Open in Chrome to protect” or a future mobile app.
2. **Post URL may lag** — Instagram sometimes exposes the permalink only after publish; use `register-post`.
3. **CDN recompression** — if only CDN bytes are captured (not the local file), DNA is still useful but may differ slightly from device original; prefer file-input capture.
4. **Monitoring is discovery-based** — not millisecond Instagram webhooks; schedule + check-now + profile scan.
5. **Closed platforms** — private chats cannot be monitored legally or technically via extension.
6. **Rate limits / platform anti-bot** — Instagram/Facebook may throttle; adapters must be resilient and non-aggressive.
7. **Video** — full YouTube/Facebook video matching needs video DNA path (Phase 5); thumbnails alone are insufficient for strong claims.
8. **Investigation timeouts** — full investigation remains budget-bound (existing 150s recovery caps); alerts should start from lightweight match first.

---

## 10. Build phases

Implementation starts **only after this spec is reviewed and approved**.

| Phase | Deliverable | Success criteria |
|-------|-------------|------------------|
| **Phase 1** | Extension scaffold + Hub OAuth + Verify (context menu) | Right-click verify on open web; open Hub report |
| **Phase 2** | Publish Guardian — Instagram Web adapter | Detect publish, capture media, call protect API |
| **Phase 3** | Auto Vault + DNA + monitor enroll + certificate | One publish → vaultId + monitorId + CERT in popup |
| **Phase 4** | Multi-platform: X, Pinterest, LinkedIn | Same protect flow on ≥3 platforms |
| **Phase 5** | YouTube + Facebook + Video DNA path | Video protect + keyframe monitoring |
| **Phase 6** | Profile scan, continuous monitoring polish, Hub alerts | User sees alerts for discovered public copies |

### Phase 2 reliability upgrades (implemented 2026-07-28)

| Milestone | Status | Notes |
|-----------|--------|-------|
| **2.1 Reliability** | Done | Offline queue (`chrome.storage`), exponential backoff, idempotent `clientRequestId`, draft→FAILED recovery |
| **2.2 Domain model** | Done | Lifecycle state machine, monitoring profile PENDING/RUNNING/PAUSED/FAILED/DISABLED, discovery firstSeen/lastSeen/severity, ProtectedPost aggregate in getPost |
| **2.3 Platform layer** | Done | Adapter interface (`adapter-interface.js`), domain event bus, risk engine (LOW→CRITICAL) |
| **2.4 Operations** | Partial | `/posts/stats` ops dashboard + `/extension/sync`; Redis/BullMQ worker cluster deferred to scale phase |

### Remaining at true enterprise scale

- Redis/BullMQ monitoring workers + concurrent scan pools
- Push/session sync of OAuth across browsers (beyond Hub pull sync)
- Auto-queue Unified Investigation on CRITICAL risk
- YouTube video DNA path

### Phase dependencies

```
Phase 1 (auth + verify)
    ↓
Backend: extension auth + publish-protect (can start in parallel with Phase 1)
    ↓
Phase 2 (Instagram capture)
    ↓
Phase 3 (enroll + certificate UX)
    ↓
Phase 4 → 5 → 6
```

### Repo layout (proposed)

```
extension/
  manifest.json
  src/
    background/
    content/
      adapters/
        instagram.ts
        x.ts
        pinterest.ts
        linkedin.ts
        youtube.ts
        facebook.ts
    popup/
    options/
    shared/
      api.ts
      auth.ts
      types.ts
  public/icons/
```

Build tooling recommendation: **WXT** or **Plasmo** (React + MV3 + HMR). Final choice at kickoff.

---

## 11. Future roadmap

| Item | Description |
|------|-------------|
| Mobile companion | Protect posts made in native apps |
| Browser push notifications | Alert without opening Hub |
| Enterprise force-install | Google Admin policy deploy |
| Leak Sentinel (DAIP Phase 4) | Opt-in fingerprint signals while browsing |
| Batch backfill | “Protect all my last N Instagram posts” |
| Evidence export from alert | One-click forensic PDF pack |
| Edge / Firefox ports | After Chrome Web Store stability |
| Stronger Meta adapters | Improve blob/CDN capture resilience |

---

## 12. Acceptance criteria (for team approval)

Spec is ready to approve when the team agrees:

1. [ ] Product promise wording is acceptable for marketing and Store listing.
2. [ ] Capture-at-publish (not intercept) is the official model.
3. [ ] Private DMs / closed chats are explicitly out of scope.
4. [ ] `publish-protect` is the canonical one-shot API (no parallel DNA logic in extension).
5. [ ] Monitoring reuses existing enroll + thresholds.
6. [ ] Phase order 1→6 is the implementation sequence.
7. [ ] Auth model is Hub OAuth for production (API key only for enterprise/dev).
8. [ ] Platform matrix honesty (Instagram medium, X/Pinterest strong, Telegram partial) is accepted.

---

## 13. One-line summary

**Publish Guardian makes PinIT protection automatic at the moment of publishing on supported Chrome platforms — Vault + DNA + monitoring + alerts — while Verify mode handles discovery of suspicious content elsewhere, all on the existing forensic stack.**

---

## Document control

| Field | Value |
|-------|-------|
| Authors | PinIT product / engineering |
| Reviewers | _(assign)_ |
| Approval | Pending team review |
| Next step after approval | Begin Phase 1 implementation (`extension/` scaffold + auth + Verify) |
