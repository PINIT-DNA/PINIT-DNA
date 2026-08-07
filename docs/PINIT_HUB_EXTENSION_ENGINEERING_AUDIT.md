# PinIT Hub Chrome Extension — Complete Engineering Audit

**Document type:** Lead Architect production readiness audit  
**Product:** PinIT Hub — Publish Guardian (Chrome / Edge MV3)  
**Extension version audited:** `1.4.0`  
**Repo path:** `extension/`  
**Audit date:** 2026-08-06  
**Scope:** Full extension + Publish Guardian backend surfaces + Hub auth  
**Mode:** Read-only audit — **no new features implemented in this document**

---

## Executive summary

PinIT Hub’s Chrome extension is a **creator-first digital asset protection layer**. Its job is to protect **user-owned originals** at the moment of intentional **upload**, **export**, or **manual protect** — then hand off to Hub backends for DNA, Vault encryption, certificates, monitoring, discovery, and investigation.

**North-star security principle (v1.4.0):**

```
Viewing  ≠  Owning  ≠  Publishing  ≠  Protecting
```

| Mode | When | Auto DNA / Vault / Monitoring |
|------|------|-------------------------------|
| **Viewer** | Feeds, watch pages, shorts, browse | **Never** |
| **Creator** | Upload / export / file-picker on allowlisted surfaces | **Yes** |
| **Manual** | Right-click Protect | Only on explicit user action |
| **Verify** | Right-click Verify | Match only — no new Asset |

**Verdict in one line:** Strong foundation and correct product architecture after the creator-intent hardening; **not yet enterprise-production-ready** because several adapter allowlists remain too broad, late URL binding exists for only 2 platforms, tests do not load real Chrome APIs, and `<all_urls>` + token-in-local-storage need a least-privilege pass before Web Store / enterprise rollout.

**Overall readiness: ~68%** (see §19).

---

## How we built the extension (structure & deliveries)

### Build evolution

| Phase | What was delivered |
|-------|--------------------|
| **Foundation** | MV3 shell: service worker, popup, options, storage, auth code exchange |
| **Publish Guardian** | File-input capture framework, offline queue, `publish-protect` API |
| **Platform breadth** | ~36 site adapters + YouTube MAIN-world shadow hook + export-protect |
| **Hub integration** | Protected Posts, Assets aggregate, certificates, monitoring enroll |
| **v1.4.0 Intent hardening** | Default-deny Creator Mode, structured capture metadata, AssetPlatformLink |

### What the extension delivers to users

1. **Protect-before-publish** — original bytes captured when the user picks/drops a file on a creator surface  
2. **Protect-on-export** — optional parallel protect on Canva/Figma/Adobe Web export gestures  
3. **Manual Protect / Verify** — context menu on any page (explicit intent)  
4. **Provenance** — Vault + DNA + Certificate + Protected Post + timeline  
5. **Monitoring handoff** — enroll DNA for public republication discovery  
6. **Late URL bind** — YouTube / Instagram can attach the public post URL after upload  
7. **Offline resilience** — durable queue with backoff when network/auth fails  
8. **Cross-browser sync snapshot** — `GET /extension/sync`

### What the extension does **not** deliver (by design)

- Scraping feeds or watching videos for ownership  
- Private DM / WhatsApp / Discord private capture  
- Local filesystem scanning  
- Claiming real-time viewer analytics from third-party platforms  
- Chrome Web Store published package (currently load-unpacked / zip)

---

# 1. ARCHITECTURE

## 1.1 Overall architecture diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         USER BROWSER (Chrome / Edge)                      │
│                                                                          │
│  ┌─────────────┐   chrome.runtime    ┌─────────────────────────────────┐ │
│  │ Popup UI    │◄──────────────────►│  Service Worker (MV3 module)    │ │
│  │ Options UI  │                     │  - Auth / tokens                 │ │
│  └─────────────┘                     │  - PUBLISH_CAPTURE orchestration │ │
│                                      │  - Queue flush / alarms          │ │
│                                      │  - Context menus / badges        │ │
│                                      └──────────────┬──────────────────┘ │
│                                                     │ HTTPS JWT          │
│  ┌──────────────────────────────────┐               │                    │
│  │ Content scripts (per platform)   │  sendMessage  │                    │
│  │  adapter-interface.js            ├───────────────┘                    │
│  │  adapters/*.js                   │                                    │
│  │  youtube-main-hook (MAIN world)  │                                    │
│  │  export-protect.js               │                                    │
│  │  content-bridge.js (all URLs)    │                                    │
│  └──────────────────────────────────┘                                    │
│           ▲                                                              │
│           │ file change / drop / export confirm                          │
│  ┌────────┴────────┐                                                     │
│  │ Platform pages  │  Instagram · YouTube Studio · Canva · …             │
│  └─────────────────┘                                                     │
└──────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  PinIT Hub Backend  /api/v1                                              │
│  POST /extension/publish-protect → DNA → Vault → Cert → Monitor → Asset  │
│  POST /extension/register-post   → late URL + AssetPlatformLink          │
│  POST /auth/extension/token      → JWT session                           │
│  GET  /extension/sync · POST /vault/verify-identity · POST /auth/refresh │
└──────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Hub Web (React)  — Extension Auth page · Protected Posts · Assets ·     │
│  Investigation · Monitoring dashboards                                   │
└──────────────────────────────────────────────────────────────────────────┘
```

## 1.2 MV3 components

| Component | File(s) | Role |
|-----------|---------|------|
| **Manifest V3** | `manifest.json` | Permissions, content script registration, SW entry |
| **Service Worker** | `background/service-worker.js` | Coordinator; only durable network/auth/queue owner |
| **Content scripts** | `content/**` | Page-scoped capture; isolated world (+ MAIN for YT) |
| **Popup** | `popup/*` | Sign-in, health, queue, deep links |
| **Options** | `options/*` | API/Hub URLs, platform toggles |
| **Shared libs** | `shared/*` | Config, API, queue, intent, adapter factory |
| **Icons** | `icons/*` | Extension branding |

## 1.3 Service Worker

Responsibilities:

- Context menus: Verify / Protect / Open Investigation  
- Alarms: queue flush (1m), Hub sync (15m), health (30m)  
- Message router for all extension chrome.runtime traffic  
- Intent gate before any protect  
- Call `publishProtect` / `registerPost` / verify / auth  
- Badge UX (`✓`, `!`, `Q`, `OK`)  
- Persist `lastProtect`, telemetry, queue failures  

## 1.4 Content Scripts

- **Isolated world adapters** — cannot see page JS vars; hook DOM file inputs  
- **YouTube MAIN hook** — patches page world to see Shadow DOM / Polymer inputs  
- **export-protect** — non-blocking confirm on export/download gestures  
- **content-bridge** — `GET_PAGE_META` only on `<all_urls>`  

## 1.5 Popup / Options

- Popup: auth, status cards, self-test, flush, sync, Hub links  
- Options: `apiBaseUrl`, `hubBaseUrl`, `publishGuardianEnabled`, per-platform flags  

## 1.6 Background communication

```
Adapter / export-protect / context-menu
        │  chrome.runtime.sendMessage({ type: 'PUBLISH_CAPTURE', ... })
        ▼
Service Worker handleMessage
        │  resolveCaptureIntent + isAllowedAutoProtect
        ▼
enqueueProtect  OR  immediate publishProtect (large online files)
        │
        ▼
POST /extension/publish-protect
```

## 1.7 Storage / Queue / Messaging / API / Auth / Events

See §§10–13 for depth. Event flow summary:

1. User opens creator surface → `detectPublishContext() === true`  
2. User selects file → hooked `change` / drop / MAIN hook  
3. Bytes → data URL → `PUBLISH_CAPTURE` with intent metadata  
4. SW authenticates → backend pipeline → Asset + ProtectedPost  
5. Optional late `REGISTER_POST` when public URL appears  
6. Monitoring crawler discovers leaks → timeline / investigation  

---

# 2. FOLDER STRUCTURE

```
extension/
├── manifest.json
├── README.md
├── background/          # Service worker
├── shared/              # Cross-context libraries
├── popup/               # Action popup UI
├── options/             # Options page UI
├── content/
│   ├── adapters/        # One file per platform
│   ├── content-bridge.js
│   ├── export-protect.js
│   └── youtube-main-hook.js
├── icons/
├── test/                # Local HTML mocks
├── src/                 # EMPTY stub (unused)
└── public/              # EMPTY stub (unused)
```

| Folder | Purpose | Responsibilities | Dependencies | Clean architecture? | Improvement |
|--------|---------|------------------|--------------|---------------------|-------------|
| `background/` | MV3 SW | Orchestration only | `shared/*`, Chrome APIs | Partially — large god-file | Split handlers: auth / protect / queue / sync |
| `shared/` | Portable logic | Config, API, queue, intent, adapter factory | Chrome storage/fetch | Good start | Separate content-safe vs SW-only modules clearly |
| `content/adapters/` | Platform allowlists | `detectPublishContext` + optional metadata | `adapter-interface.js` | Thin wrappers — good | Shared binder for late URLs; tighten allowlists |
| `content/` (root) | Cross-cutting content | Bridge, export, YT MAIN | Chrome runtime | Mixed | Don’t inject bridge on every URL long-term |
| `popup/` | User control plane | Auth UX, diagnostics | SW messages | OK | Reduce diagnostic noise for end users |
| `options/` | Tenant/config | URLs + toggles | storage | OK | Validate URLs; env presets (local/prod) |
| `icons/` | Branding | Static assets | — | Yes | — |
| `test/` | Manual QA | Mock Studio HTML | — | Thin | Automate Playwright extension tests |
| `src/`, `public/` | None | Dead | — | No | **Remove** |

---

# 3. PLATFORM ADAPTERS

**Count:** 36 adapters registered in manifest + `PLATFORM_REGISTRY`.

**Factory rule:** Default `detectPublishContext() = false`. Adapters must opt into Creator Mode.

### Quality distribution (audit)

| Rating | Approx. count | Examples |
|--------|---------------|----------|
| **Strong** | 3 | YouTube, Instagram, Dribbble |
| **Adequate** | ~14 | Facebook, Reddit, Canva, Figma, Flickr, WordPress, … |
| **Weak** | ~10 | X, Threads, LinkedIn, Substack, Pixieset, Shopify, … |
| **Risky** | ~9 | Telegram, Twitch, Tumblr, Medium, Adobe host-always-on, Adobe Portfolio |

### Per-platform inventory (condensed)

#### Social

| Platform | Auto-protect when | Events | Quality | Problems | Priority |
|----------|-------------------|--------|---------|----------|----------|
| **YouTube / Studio** | `studio.youtube.com` or `/upload\|/create` | File change, drop, MAIN hook | **Strong** | Complex dual-world; watch must stay gated | P0 maintain |
| **Instagram** | `/create`, stories create, create dialogs | File change; late REGISTER_POST | **Strong** | Dialog keywords `crop/edit/share` can be loose | P0 |
| **Facebook** | Composer / create paths + dialogs | File change / drop | Adequate | No late URL bind | P1 |
| **X** | `/compose` + dialogs | File change | Weak | Dialog keywords `post/media` too broad | P1 harden |
| **Pinterest** | pin-builder / create | File change | Adequate | No late bind | P2 |
| **Telegram** | Dialog **OR any file input** | File change | **Risky** | Chat always has file input → Creator Mode | **P0 fix** |
| **TikTok** | `/upload`, `/creator`, studio | File change | Adequate | No late bind | P1 |
| **LinkedIn** | compose paths + dialogs | File change | Weak | Keywords `photo/video` | P1 |
| **Threads** | Dialog only | File change | Weak | No path gate | P1 |

#### Creators

| Platform | Notes | Quality | Priority |
|----------|-------|---------|----------|
| Reddit | `/submit` focused | Adequate | P2 |
| Tumblr | `/blog/` **too broad** | Risky | **P0 fix** |
| Medium | `/p/` matches **reading** posts | Risky | **P0 fix** |
| Substack | `/post` reader collision | Weak | P1 |
| Patreon / Behance / ArtStation / DeviantArt | Upload paths | Adequate | P2 |
| Dribbble | Tight `/shots/new` | Strong | P2 |
| Vimeo | `/manage` broad | Weak | P1 |
| Twitch | `/u/` matches **all channels** | Risky | **P0 fix** |

#### Business / design

| Platform | Notes | Quality | Priority |
|----------|-------|---------|----------|
| GitHub | Issue/PR attach + acceptAll | Adequate | P1 policy |
| Canva / Figma | Editor paths + export confirm | Adequate | P1 |
| Adobe Express / PS / AI | **Hostname ⇒ always Creator** | Risky | **P0 fix** |
| Shopify | Wide admin paths | Weak | P1 |
| WordPress | wp-admin narrowed | Adequate | P2 |

#### Photo / CMS

| Platform | Notes | Quality | Priority |
|----------|-------|---------|----------|
| Flickr / 500px / SmugMug | Upload-oriented | Adequate | P2 |
| Pixieset `/collections`, Zenfolio `/photographer` | Browse likely Creator | Weak | P1 |
| Adobe Portfolio | Host always-on; export flag unused | Risky | P1 |
| Squarespace / Wix | CMS editor broad | Weak–Adequate | P2 |

### Late URL binding (`REGISTER_POST`)

| Has binder | Missing (most platforms) |
|------------|---------------------------|
| YouTube (full), Instagram (basic) | Facebook, X, TikTok, LinkedIn, Reddit, … |

**Before adding more adapters:** fix risky allowlists + extract shared late-bind helper. Do **not** grow platform count first.

---

# 4. CAPTURE ENGINE

## How files are captured

1. Adapter calls `createFileInputAdapter(platformId, options)`  
2. Deep-scan finds `input[type=file]` including **open shadow roots**  
3. Direct `change` listeners on each input (required — `change` is not composed)  
4. On change → read `File` → `FileReader.readAsDataURL` → `PUBLISH_CAPTURE`  
5. Alternate paths: document `drop`, MAIN-world YouTube hook, export-protect confirm, context-menu `mediaUrl`

## Upload detection

- **Not** network sniffing of XHR uploads  
- **Yes** user file-picker / drop on creator surfaces  
- Platform upload continues unblocked (PinIT runs in parallel)

## Export detection

- `export-protect.js`: click heuristics (`export|download|save as|…`) + `window.confirm`  
- Never blocks native export  

## Drag-drop

- Document capture-phase `drop` when Creator Mode true  
- YouTube MAIN also emits drop files on Studio  

## File picker

- Hook `change` on file inputs; also patch `click` / `showPicker` / `addEventListener` in YouTube MAIN  

## Shadow DOM

- Recursive `collectFileInputsDeep` (depth ≤ 40)  
- YouTube MAIN world for closed/Polymer trees  

## Mutation observers

- Adapter: throttled 250ms rescans  
- YouTube MAIN: 300ms  
- Export-protect: watches new download anchors  
- Instagram/YouTube: late URL observers  

## Duplicate prevention

- `WeakSet` on `File` objects per adapter instance  
- Queue: same `clientRequestId` while pending/processing  
- Backend: `@@unique([ownerUserId, clientRequestId])` idempotent recovery  
- DNA duplicate check across accounts (409)

## How random / broad captures happen

| Cause | Example |
|-------|---------|
| Over-broad `detectPublishContext` | Tumblr `/blog/`, Twitch `/u/`, Medium `/p/` |
| Host-always-on | Adobe Express/PS/AI entire origin |
| File input always present | Telegram |
| Loose dialog keywords | `post`, `media`, `photo`, `video` |
| Historical bug (fixed in 1.4.0) | YouTube returned true for all `youtube.com` |

## How to prevent them

1. Default deny (done)  
2. Path allowlists with **explicit deny** for feed/watch/read routes  
3. Require `(pathMatch) OR (composerDialog AND fileInput)` — never hostname alone  
4. Ban bare dialog keywords  
5. SW intent rejection for unknown reasons  
6. E2E invariant: browse feed → 0 Vault writes  

---

# 5. INTENT ENGINE

## Does an Intent Engine exist?

**Yes — v1.4.0 partial Intent Engine** (not a separate package, but a dual-layer system).

| Layer | Location | Role |
|-------|----------|------|
| Content | `adapter-interface.js` → `resolveCaptureIntent` | Attach reason/method/action at capture |
| Content | Per-adapter `detectPublishContext` | Creator vs Viewer surface |
| SW | `shared/capture-intent.js` | Re-resolve + `isAllowedAutoProtect` gate |

## Distinguishing states

| User state | Should create Asset? | How PinIT decides today |
|------------|----------------------|-------------------------|
| **VIEW** | No | Viewer Mode; no auto capture |
| **UPLOAD** | Yes | Creator Mode + file picker/drop → `captureReason=publish` |
| **EXPORT** | Yes (after confirm) | export-protect → `captureReason=export` |
| **PUBLISH** | Yes (same as upload at capture; URL late-bound) | protect + later `REGISTER_POST` |
| **VERIFY** | No | Context menu → `/vault/verify-identity` |
| **MANUAL PROTECT** | Yes | Context menu → `captureReason=manual` |

## Design target (full Intent Engine)

Formalize a single module `IntentEngine.decide(event)`:

```
input:  { surface, gesture, userExplicit, platformRules }
output: { mode: viewer|creator|manual|verify, captureReason, allowAsset: boolean }
```

Rules:

- Only `upload | export | publish | manual` → `allowAsset=true`  
- `view | verify` → never enroll monitoring / never new Vault  

**Gap:** Intent is string metadata + allowlists; not yet a centralized policy engine with per-platform rule tables and automated regression.

---

# 6. PROTECTION PIPELINE

```
Original File (browser)
        ↓  PUBLISH_CAPTURE (intent required)
Service Worker (+ queue if needed)
        ↓  POST /extension/publish-protect
Duplicate DNA check
        ↓
ProtectedPost status=PUBLISHING (draft)
        ↓
DNA generation (router / orchestrator)
        ↓
Vault store (encrypt + Supabase storage)
        ↓
Certificate issue (optional flag)
        ↓
Monitoring enroll (optional flag)
        ↓
Lifecycle → PROTECTED or MONITORING
        ↓
Asset aggregate + AssetPlatformLink (original)
        ↓
Timeline events + platform events / notifications
        ↓
(Later) Crawler discovery → risk → investigation → evidence
```

### APIs involved

| Step | API / service |
|------|----------------|
| Protect | `POST /api/v1/extension/publish-protect` |
| Late URL | `POST /api/v1/extension/register-post` |
| Verify | `POST /api/v1/vault/verify-identity` |
| Auth | `POST /auth/extension/issue-code`, `POST /auth/extension/token`, `POST /auth/refresh` |
| Sync | `GET /extension/sync` |
| Internal | `dna` router, `vaultService.store`, `certificateService.issue`, `monitoringService.enroll`, `assetService.ensureAssetFromProtect`, `upsertPlatformLink` |

---

# 7. VAULT INTEGRATION

| Concern | Behavior |
|---------|----------|
| **How files reach Vault** | Multipart buffer in `publishProtect` → `vaultService.store({ dnaRecordId, ownerUserId, imageBuffer, … })` |
| **Encryption** | Vault service encrypts before Supabase `vault-files` (server-side; extension never holds vault keys) |
| **DNA** | Temp file → DNA router → `dnaRecordId`; owner stamped |
| **Certificates** | `certificateService.issue`; failures logged; protect continues (degraded) |
| **Monitoring start** | `monitoringService.enroll(dnaRecordId, { watchUrls, CONTINUOUS })` after Vault+DNA |
| **Failures** | Draft post → `FAILED`; queue retries; badge `!` / `Q`; `lastQueueFailure` |

**Degraded protect:** Asset may exist with missing cert and/or monitor — SW flags `degradedReasons`.

---

# 8. PLATFORM METADATA

### Stored today

| Field | Where | Status |
|-------|-------|--------|
| Platform | ProtectedPost / Asset.sourcePlatform | Yes |
| Platform URL / postUrl | ProtectedPost.postUrl, currentUrl, watchUrls | Partial |
| Page URL | metadata JSON | Yes |
| Capture method / reason / ownerAction / platformType | metadata + extension payload (v1.4.0) | **Yes (new)** |
| capturedVia | columns | Yes |
| Asset type | Asset.assetType | Yes |
| Owner | ownerUserId | Yes |
| Created time | createdAt | Yes |
| Vault / DNA / Cert / Monitor IDs | columns | Yes |
| Extension version | ProtectedPost.extensionVersion | Yes |
| clientRequestId | unique per owner | Yes |
| Multi-platform links | **AssetPlatformLink** | Yes (schema + upsert) |
| Original upload URL vs leak URL | Discovery models | Partial UX |
| Uploader display account | ownerAccount | Only IG / X / YT adapters fill well |

### Missing / incomplete

1. First-class columns for `captureReason` (still mostly JSON metadata)  
2. Hub UI surfacing of intent + platform links  
3. Consistent `ownerAccount` / `profileUrl` across adapters  
4. Upload method enum (`studio_upload`, `web_composer`, …) normalized  
5. Explicit “Original Platform” vs “Discovery Platform” comparison UI in investigation  

---

# 9. MONITORING

```
Protect success
    → monitoringService.enroll(dnaId, watchUrls)
    → MonitorRecord RUNNING
    → Crawler engine scans public surfaces
    → Match DNA / similarity
    → ProtectedPostDiscovery / AssetDiscovery
    → Risk score / severity
    → Timeline + alerts
    → User opens Investigation / evidence
```

| Topic | Status |
|-------|--------|
| Starts only after protect | **Yes** (not on browse) |
| Platform links | `AssetPlatformLink` + ProtectedPost `watchUrls[]` |
| DNA comparison | Backend forensics / crawler match cascade |
| Notifications | Platform events / Hub notification prefs (Hub-side) |
| Extension role | Enroll + late-bind URLs; does **not** run crawler |

---

# 10. QUEUE SYSTEM

| Property | Value |
|----------|-------|
| Storage key | `pinit_protect_queue` |
| Cap | 50 items |
| Durable payload | data URL ≤ **4,000,000** chars (~3MB) |
| Large online files | Bypass durable byte queue → immediate upload |
| Max attempts | 8 |
| Backoff | `min(30m, 5s * 2^attempts)` |
| Flush | Alarm every 1 minute + popup button |
| Stuck processing | Recover after 15 minutes |
| Done prune | 7 days |
| Duplicate | Same clientRequestId while pending |
| Failure | `failed` status + `lastQueueFailure` |

---

# 11. AUTHENTICATION

```
Popup "Sign in"
  → Hub /extension/auth?ext_id=<chrome.runtime.id>
  → Logged-in Hub user
  → POST /auth/extension/issue-code  (JWT Hub session)
  → 5-minute one-time code bound to extensionId
  → Paste / Connect in popup
  → POST /auth/extension/token { code, extensionId }
  → accessToken + refreshToken → chrome.storage.local
  → API calls use Authorization: Bearer
  → 401 → POST /auth/refresh → retry or clear tokens
```

**Security notes:** Short TTL; extensionId match; unused-once. Tokens not encrypted at rest in extension storage (MV3 norm). Hub `postMessage(..., '*')` for code is secondary; paste is primary.

---

# 12. API REVIEW

| Method | Endpoint | Input | Output | Failures / retry |
|--------|----------|-------|--------|------------------|
| POST | `/extension/publish-protect` | multipart media + platform, URLs, intent fields, clientRequestId | 201 Asset/Post ids | 401 refresh; 409 duplicate DNA; queue retry |
| POST | `/extension/register-post` | vaultId/postId + platform + postUrl | updated post | 404 if missing |
| GET | `/extension/sync` | auth | recent posts + stats | soft-fail in SW |
| POST | `/vault/verify-identity` | image multipart | match / no match | badge error |
| POST | `/auth/extension/token` | code, extensionId | JWTs | invalid/expired code |
| POST | `/auth/refresh` | refreshToken | new access | clears tokens |
| POST | `/auth/extension/issue-code` | Hub only | code | auth required |

Hub-only (not SW): `GET/PATCH/DELETE /posts`, stats.

---

# 13. STORAGE

| Key | Contents |
|-----|----------|
| `config` | API/Hub URLs, guardian enabled, platform toggles |
| `accessToken` / `refreshToken` / `user` / `lastAuthAt` | Session |
| `pinit_protect_queue` | Offline protects |
| `lastProtect` / `lastVerify` / `lastCaptureAttempt` / `lastQueueFailure` | UX diagnostics |
| `captureTelemetry` | Last ~40 stages |
| `extensionHealth` | Health snapshot |
| `syncSnapshot` | Last Hub sync |

**Not used:** `chrome.storage.sync` (all local).  
**Session:** none separate — SW ephemeral + local persistence.

---

# 14. SECURITY REVIEW

| Area | Finding | Severity |
|------|---------|----------|
| Permissions | `storage`, `contextMenus`, `activeTab`, `scripting`, `alarms` — reasonable | OK |
| Host permissions | **`<all_urls>`** + listed Hub/API hosts | **High** — tighten for store |
| Message validation | Type switch only; any content script can message SW | Medium |
| JWT storage | `chrome.storage.local` plaintext | Accepted risk; document |
| Intent gate | Strong product control vs opportunistic capture | Good |
| MAIN-world YT hook | Elevated; correctly Studio-gated | Medium (monitor) |
| export confirm | Spoofable UX; non-blocking by design | Low |
| CSP | No custom CSP; MV3 defaults | OK |
| Privacy | Should not vault browse content — intent model | Good direction |
| Least privilege | Content bridge on all URLs is broader than needed | Medium |

---

# 15. PERFORMANCE REVIEW

| Area | Observation | Risk |
|------|-------------|------|
| MutationObservers | Every adapter page: 250ms throttle + 15s interval | Medium on heavy SPAs |
| YouTube MAIN | Patches prototypes + 10s interval scan | Medium on Studio only (OK if gated) |
| Interval scans when Viewer | `scanAndHook` returns 0 quickly if not creator | Low–Medium |
| Queue growth | Capped at 50; large files skip durable bytes | OK |
| Storage | data URLs in queue can be large | Watch quota errors |
| Duplicate scans | Multiple delayed scans intentional for late dialogs | Acceptable |
| Memory | Per-tab content scripts × many sites | Monitor; prefer optional scripting |

**No formal memory/CPU benchmarks in CI.** Recommend Playwright + performance marks.

---

# 16. USER EXPERIENCE

| Surface | Current | Gaps |
|---------|---------|------|
| Popup | Sign-in, health, last protect, telemetry, self-test | Too engineering-heavy for consumers |
| Options | URLs + platform toggles | Need clear Local vs Production presets |
| Badge | ✓ / ! / Q | Good; document meaning |
| Errors | lastProtect.message, lastQueueFailure | Not always user-friendly |
| Progress | pending lastProtect | No % progress for large uploads |
| Export | native `confirm()` | Feels dated; toast/UI preferred |

---

# 17. CODE QUALITY

| Topic | Assessment |
|-------|------------|
| Architecture | Clear SW vs content split; adapter factory is the right abstraction |
| Naming | Generally clear (`PUBLISH_CAPTURE`, `detectPublishContext`) |
| Modularity | SW is monolithic; adapters thin (good) |
| Maintainability | Allowlist copy-paste across adapters → drift |
| Testability | Pure Jest mirrors only — **not** loading real extension modules |
| Dead code | `extension/src/`, `extension/public/` empty; Portfolio export flag unused |
| Duplication | Intent resolution in both SW module and adapter IIFE |
| Unused | Some README URL defaults diverge from `config.js` |

---

# 18. MISSING FEATURES

### Critical

1. Harden **risky** adapter allowlists (Telegram, Twitch, Tumblr, Medium, Adobe host-always-on)  
2. Shared **late URL binder** for top social platforms  
3. Automated **Viewer Mode E2E** (browse must create zero Assets)  
4. Least-privilege host permissions plan for Web Store  

### High

5. Hub UI for intent metadata + AssetPlatformLink  
6. First-class DB columns / indexes for captureReason  
7. Split service worker modules  
8. Consumer-friendly popup (hide raw telemetry behind Advanced)  
9. Real Chrome extension integration tests  

### Medium

10. Normalize uploadMethod taxonomy  
11. ownerAccount/profileUrl helpers for all adapters  
12. Export UX beyond `window.confirm`  
13. Remove empty `src/` / `public/`  
14. Align README defaults with live config  

### Low

15. chrome.storage.sync for settings  
16. i18n  
17. Chrome Web Store listing assets / privacy policy page  

---

# 19. PRODUCTION READINESS

| Dimension | Score | Why |
|-----------|-------|-----|
| **Architecture** | **88%** | MV3 + pipeline + intent model correct; SW still monolithic |
| **Security** | **72%** | Intent model strong; `<all_urls>`, message trust, risky adapters hurt |
| **Performance** | **75%** | Acceptable patterns; observers need budgets; no CI perf |
| **Reliability** | **70%** | Queue/idempotency solid; late-bind sparse; allowlist FP risk |
| **Testing** | **55%** | Unit mirrors only; no Chrome driver E2E for protect invariants |
| **UX / Ops** | **65%** | Works for power users; not polished for enterprise rollout |
| **Platform coverage quality** | **60%** | Breadth high; depth uneven (many weak/risky gates) |
| **Overall** | **~68%** | Ready for **controlled internal / creator beta**; not yet enterprise Web Store GA |

### Why not higher

- Platform **quantity** outpaced **intent quality** historically (partially corrected in 1.4.0).  
- Monitoring/investigation are backend-strong; extension provenance UI incomplete.  
- Store/enterprise needs permission minimization + privacy narrative + automated regression.

---

# 20. FINAL ENGINEERING ROADMAP

**Do not add more platform adapters until Phase A–B complete.**

### First — Phase A: Trust & Intent (1–2 weeks)

1. Fix P0 risky allowlists (Telegram, Twitch, Tumblr, Medium, Adobe always-on)  
2. Codify Intent Engine policy table (viewer deny lists per platform)  
3. E2E invariant tests: feed browse → 0 protects; Studio upload → 1 Asset  
4. Remove dead folders / unused export flags  

### Second — Phase B: Provenance depth (2–3 weeks)

5. Shared `createLatePostBinder` for IG, YT, FB, X, TikTok, LinkedIn  
6. Surface AssetPlatformLink + captureReason in Hub Assets / Protected Posts  
7. Normalize metadata schema (columns or versioned JSON)  
8. Split service worker into modules  

### Third — Phase C: Enterprise readiness (2–4 weeks)

9. Least-privilege host permissions + optional scripting  
10. Message authentication / capability tokens between content and SW  
11. Consumer popup + enterprise admin docs  
12. Chrome Web Store package, privacy policy, screenshot set  
13. Chaos tests: offline queue, large video, auth expiry mid-upload  

### Fourth — Phase D: Controlled platform expansion

14. Only add platforms with: path allowlist, deny list, binder plan, E2E checklist  
15. Prefer **depth on top 8** over 50 thin adapters  

### Redesign / remove before more adapters

| Item | Action |
|------|--------|
| Broad path templates (`/blog/`, `/u/`, `/p/`) | Redesign |
| Hostname-as-Creator-Mode | Redesign |
| Telegram file-input OR | Redesign |
| Empty `extension/src`, `extension/public` | Remove |
| Duplicate intent resolvers | Consolidate |
| Bare dialog keywords | Ban in review checklist |
| Portfolio `__PINIT_EXPORT_PLATFORM__` without script | Fix or remove |

---

## Appendix A — Creator-intent solutions (product → engineering map)

This maps the product brief (“viewing ≠ protecting”) to shipped / remaining work:

| Product requirement | Engineering status |
|--------------------|--------------------|
| Viewer Mode never auto-protects | **Shipped** default deny + SW gate |
| Creator Mode only on upload/export | **Shipped** allowlists (quality varies) |
| Capture knows WHY | **Shipped** captureReason / ownerAction / captureMethod |
| YouTube watch/shorts never protect | **Shipped** Studio-only gate |
| Multi platform links | **Shipped** AssetPlatformLink (+ migrate applied) |
| Monitoring only after protect | **Shipped** |
| Lifecycle Draft→…→Archived | **Partial** enums exist; UX incomplete |
| Strict per-adapter rules table | **Partial** — needs P0 hardening |
| One upload → one Asset | **Mostly** via clientRequestId; needs E2E proof |
| Investigation provenance trail | **Backend ready**; Hub presentation incomplete |

---

## Appendix B — How to load & use (operator)

1. `chrome://extensions` → Developer mode → Load unpacked → `extension/`  
2. Options → set API (`http://localhost:4000/api/v1` or production) + Hub URL  
3. Popup → Sign in to PinIT → paste auth code  
4. **Viewer check:** open YouTube watch — no protect  
5. **Creator check:** YouTube Studio upload — one Protected Post / Asset  
6. **Manual:** right-click image → Protect / Verify  
7. After code changes: Reload extension + refresh tabs  

---

## Appendix C — Key files index

| Path | Role |
|------|------|
| `extension/manifest.json` | MV3 registration v1.4.0 |
| `extension/background/service-worker.js` | Orchestrator |
| `extension/shared/adapter-interface.js` | Capture framework |
| `extension/shared/capture-intent.js` | SW intent gate |
| `extension/shared/queue.js` | Offline queue |
| `extension/shared/api.js` | HTTP client |
| `extension/content/adapters/*` | Platform allowlists |
| `extension/content/youtube-main-hook.js` | Studio MAIN capture |
| `extension/content/export-protect.js` | Export confirm |
| `src/services/publish-guardian/*` | Protect pipeline |
| `src/services/assets/asset.service.ts` | Asset + platform links |
| `prisma/migrations/20260806120000_asset_platform_links/` | Multi-link schema |
| `tests/extension/*.test.ts` | Pure unit mirrors |
| `docs/PINIT_EXTENSION_ECOSYSTEM_ARCHITECTURE.md` | Prior architecture vision |

---

## Appendix D — Verification checklist (audit)

| Check | Status |
|-------|--------|
| Manifest MV3 present | ✅ |
| Creator-intent default deny | ✅ (v1.4.0) |
| YouTube Studio-only | ✅ |
| Intent metadata on protect | ✅ |
| AssetPlatformLink migrated | ✅ (2026-08-06) |
| Risky adapters remain | ⚠️ Yes — must fix before GA |
| Chrome E2E suite | ❌ Missing |
| Web Store package | ❌ Not production-published |
| Overall production ready | ❌ **~68%** — beta-ready, not GA |

---

*End of audit. This document is intentionally implementation-free: it defines truth of the current system and the ordered roadmap to production-grade creator protection.*
