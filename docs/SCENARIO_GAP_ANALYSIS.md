# PINIT-DNA — Scenario Gap Analysis (Phase 0 Audit)

**Status:** Audit only — no implementation in this phase  
**Date:** 14 July 2026  
**Branch audited:** `ashwitha` @ `44f9b08` (local; not re-verified on production after Render sync)  
**Acceptance source:** `docs/PINIT-DNA_Core_Loop_Solution_Report.md` + sir’s five official scenarios  
**Rule:** Do not break existing auth, Vault, Smart Links, DNA, Protect Download, Monitoring, Investigation, Certificates, Tracking, or Admin flows.

---

## 1. Current Architecture (As-Built)

```
Upload (Generate DNA / Vault)
    ↓
15-Layer DNA + Certificate (optional)
    ↓
Vault (AES-256-GCM, Supabase Storage)
    ↓
Protect Download (TEP + invisible watermark embed)  OR  Smart Link (tracked share)
    ↓
Distribution (WhatsApp / email / public /s/:token)
    ↓
Detection (Access log | Crawler | Manual investigation upload)
    ↓
Alert (Platform events, Monitoring Match Alerts, Security Center)
    ↓
Investigation (Unified Investigation orchestrator)
    ↓
Evidence (PDF report, CSV export, signed manifest, incidents)
```

### 1.1 Stack & deployment

| Layer | Technology | Production URL |
|-------|------------|----------------|
| Frontend | React + Vite + Tailwind | `https://pinit-dna.vercel.app` |
| Backend | Node.js + Express + TypeScript | Render (`pinit-dna-uf5y.onrender.com` / org repo) |
| Database | PostgreSQL + Prisma | Supabase |
| Storage | Supabase bucket `vault-files` | — |
| AI | Python FastAPI (`python-ai/`) | Render AI service |
| Auth | JWT (`pinit_access_token`) | — |

### 1.2 Core API namespaces

| Prefix | Purpose |
|--------|---------|
| `/api/v1/dna/*` | Generate, compare, auto-compare, verify |
| `/api/v1/vault/*` | Vault CRUD, protected download, tracking |
| `/api/v1/share/*` | Smart Links, access logs, hop tree, block-viewer |
| `/api/v1/monitor/*` | Monitoring enrollment, alerts, crawler |
| `/api/v1/forensics/*` | Unified investigation, diff, attribute-leak |
| `/api/v1/certificates/*` | Issue, verify, revoke |
| `/api/v1/evidence/*` | Reports, incidents, chain |
| `/api/v1/tep/*` | TEP manifests |
| `/api/v1/intelligence/*` | Document OCR/search (not share access intel) |

### 1.3 Core UI routes (user dashboard)

| Route | Page | Loop step |
|-------|------|-----------|
| `/generate` | Generate DNA + Protect Ready | Upload → DNA → Protect |
| `/vault` | Vault Explorer + Smart Link create | Vault → Share |
| `/s/:token` | Share Viewer (public) | Viewer activity |
| `/access-intelligence` | Smart Link list | Tracking |
| `/access-intelligence/:token` | Link Intelligence (map, viewers) | Tracking |
| `/link-tree/:parentToken` | Hop link tree | Scenario 1 chain |
| `/monitoring` | Crawler enrollment & alerts | Detection |
| `/unified-investigation` | Manual leak investigation | Investigation |
| `/certificates` | Certificate lifecycle | Certificate |
| `/timeline` | File provenance timeline | Evidence |
| `/chain/:dnaRecordId` | Forward/leak chain graph | Investigation |

### 1.4 Core database tables (Prisma)

| Domain | Tables |
|--------|--------|
| DNA | `DnaRecord`, layers L1–L15, `VerificationLog`, `LocalFeatureIndex`, `LocalDnaPatch` |
| Vault | `VaultRecord` |
| Share / tracking | `ShareLink`, `ShareAccessLog`, `LinkForwardEvent`, `BlockedShareViewer` |
| TEP / watermark | `TrackedExportPackage`, `WatermarkProfile`, `RecipientProfile` |
| Monitoring | `MonitorRecord`, `CrawlResult`, `CrawlerJob`, `CrawlerMatch` |
| Evidence | `EvidenceRecord`, `Incident`, `ForensicProvenanceEvent` |
| Certificates | `Certificate` |

---

## 2. Core Loop Verification (Phase 1 — Read-Only Assessment)

| Step | Status | Notes |
|------|--------|-------|
| Upload | ✅ Working | Generate + Vault upload |
| Generate DNA | ✅ Working | 15-layer orchestrator |
| Certificate | ✅ Working | Issue + public verify |
| Vault | ✅ Working | Encrypted storage |
| Protect Download | ✅ Working | TEP embed in wizard |
| Watermark | ✅ Partial | TEP/download invisible WM; viewer visible overlay only |
| Smart Link | ✅ Working | Create, viewer, hop mint |
| Viewer Activity | ✅ Partial | GPS consent-gated; recent fast-open fix local |
| Monitoring | ⚠️ Partial | Code exists; prod env must be enabled |
| Investigation | ✅ Working | Unified orchestrator + PDF |
| Alert | ✅ Partial | Events fire; not all scenario-specific alert types |
| Evidence | ✅ Partial | PDF/ZIP; no DMCA draft |

**Known regressions recently fixed (local, pending your verification):**
- Hop logs not aggregated in Access Intelligence list
- Per-viewer revoke blocking wrong users on shared Wi‑Fi
- Location gate 30s block → Access Denied on laptop
- Hop links shown as “Revoked” in list (internal hop tokens)
- Render backend behind Vercel frontend (commit sync)

---

## 3. Scenario 1 — Link Forward Chain (A → B → C)

**Official requirement:** Owner → Link A → Link B → Link C; each node clickable with timeline, GPS, investigation, revoke; revoke Viewer 3 only.

### 3.1 What exists today

| Component | Location | Status |
|-----------|----------|--------|
| Parent Smart Link create | `VaultPage` → `POST /share` | ✅ |
| Auto hop on new device | `resolveAccessHop()` | ✅ |
| Explicit “Share further” | `POST /share/:token/share-further` | ✅ |
| Client redirect to hop URL | `ShareViewerPage` | ✅ |
| Aggregated logs (detail) | `getWithAggregatedLogs()` | ✅ (recent) |
| Per-viewer revoke (device-scoped) | `BlockedShareViewer` + ancestry walk | ✅ (recent) |
| Link tree API + UI | `GET /share/:token/tree`, `LinkTreePage` | ✅ |
| Visible viewer watermark | `ShareViewerPage` SVG overlay | ✅ |
| GPS + map | `LinkIntelligencePage`, `FileTrackingMap` | ✅ (consent) |

### 3.2 Gaps

| Gap | Severity | Cannot prove today? |
|-----|----------|---------------------|
| Access Intelligence **list** under-counts viewers (parent logs only) | Medium | Partially |
| Hop graph not shown as Owner→A→B→C **clickable tree** inside Link Intelligence (use separate Link Tree page) | Medium | Partially |
| No per-hop “Open Investigation” one-click | Medium | Yes |
| Full-link revoke does not cascade to child hops | Low | Edge case |
| Session-specific invisible watermark in live viewer | High (Phase 2) | Yes for streaming attribution |
| DMCA / takedown one-click | High | Yes |
| `unblockViewer` may fail if called with hop token | Low | Rare |

### 3.3 Evidence path to prove Scenario 1 locally

1. Create Smart Link from Vault for `han.webp` (production URL, not localhost).
2. Open on Device A (mobile) → allow location → VIEWED.
3. Forward same URL to Device B → auto hop → separate token.
4. B uses “Share further” → C opens new URL.
5. Access Intelligence → open **parent token** → expect ≥3 viewers on map.
6. Revoke Viewer 3 only → Viewer 3 sees “Access Revoked”; 1, 2, 4 still open.

---

## 4. Scenario 2 — Protect Download → Native Re-Upload

**Official requirement:** Protect Download → upload elsewhere → investigation shows owner, certificate, DNA match, watermark; **honestly** show “Cannot Identify Subscriber.”

### 4.1 What exists today

| Component | Status |
|-----------|--------|
| Protect Download + TEP embed | ✅ |
| 15-layer DNA in file | ✅ |
| Certificate issue + verify | ✅ |
| Monitoring / YouTube crawl | ⚠️ (env-dependent) |
| Unified Investigation on leaked file | ✅ |
| Ownership + similarity in report | ✅ |
| Subscriber attribution on native platform | ❌ By design |

### 4.2 Gaps

| Gap | Severity |
|-----|----------|
| UI does not prominently label **“Cannot Identify Subscriber”** on Scenario 2 results | High for demo |
| Monitoring → Investigate one-click incomplete | Medium |
| Crawler disabled/misconfigured on prod | High for auto-detection |
| No DMCA draft from match | Medium |
| `VerifyLeakedFilePage` exists but **not routed** | Low |

---

## 5. Scenario 3 — Tamper / Crop / Re-Encode

**Official requirement:** Crop, resize, brightness, screenshot, JPEG, etc. → investigation shows SHA, pHash, embedding, watermark, confidence; **“Needs Manual Review”** when low confidence.

### 5.1 What exists today

| Component | Status |
|-----------|--------|
| `/dna/compare`, `/forensic/diff` | ✅ API |
| Unified Investigation (patch DNA, ORB, CLIP) | ✅ |
| Tamper classifier | ✅ |
| `ComparePage` UI | ❌ Not in router |
| Social API (Instagram/X) seconds detection | ❌ |
| Explicit “Needs Manual Review” verdict UI | ⚠️ Partial (acceptance engine exists; UX unclear) |

### 5.2 Gaps

| Gap | Severity |
|-----|----------|
| No dedicated **tamper test checklist UI** (must use Unified Investigation) | Medium |
| False owner risk on heavy re-encode — needs confidence thresholds in UI | High |
| ComparePage orphaned | Medium |

---

## 6. Scenario 4 — Manual Leak Report (Closed Groups)

**Official requirement:** Report Leak → upload file → investigation; show **“Reported by User / Manual Investigation”** — do not pretend crawler found Telegram.

### 6.1 What exists today

| Component | Status |
|-----------|--------|
| Unified Investigation upload | ✅ `/unified-investigation` |
| `/vault/verify-identity` API | ✅ |
| Telegram public channel connector | ⚠️ Stub / env |
| Discord connector | ❌ |
| “Report Leak” dashboard entry | ❌ |
| Discovery method honesty in report | ⚠️ Partial |

### 6.2 Gaps

| Gap | Severity |
|-----|----------|
| No **Report Leak** button routing to investigation | High for demo |
| Admin Evidence Center placeholder | Medium |
| Closed group crawl | ❌ (honest limitation) |

---

## 7. Scenario 5 — Enterprise TEP (Unique Recipient)

**Official requirement:** Unique Smart Link + watermark + timeline + viewer + investigation per recipient; leak identifies recipient with evidence package.

### 7.1 What exists today

| Component | Status |
|-----------|--------|
| TEP on Protect Download | ✅ |
| TEP on Smart Link download | ✅ |
| Per-recipient access logs | ✅ |
| Access Intelligence + GPS | ✅ (consent) |
| Watermark attribution API | ✅ `/share/forensics/attribute-leak` |
| PDF evidence report | ✅ |
| HR automated workflow | ❌ |

### 7.2 Gaps

| Gap | Severity |
|-----|----------|
| GPS not silent (browser consent required) | Document limitation |
| No Neo4j lineage graph in prod | Future |
| Evidence package missing some fields (platform URL, DMCA draft) | Medium |
| Google Maps one-click from map pin | ⚠️ Partial |

---

## 8. Cross-Cutting Gaps (All Scenarios)

| Area | Current | Gap |
|------|---------|-----|
| **Alerts** | Platform events, monitoring alerts | Missing typed alerts: impossible travel, revoked viewer retry, leak found |
| **Monitoring UI** | Enroll, alerts | Missing: one-click Investigate, owner/cert on alert row |
| **Tracking** | ShareAccessLog rich schema | Missing: Google Maps link, parent/child in list API |
| **Map** | FileTrackingMap | Missing: lat/lng/accuracy/capture time panel + Maps deep link |
| **Evidence PDF** | evidence-report.service | Missing: full scenario template, DMCA draft |
| **Investigation result** | Unified page | Missing: standardized evidence panel (all fields from prompt) |

---

## 9. Missing Pieces Summary (Do NOT Build Yet)

Priority order for **proof-only** work after your approval:

1. **Scenario 1 proof:** Link Intelligence tree UX + aggregated list stats + revoke regression test script.
2. **Scenario 2 proof:** Investigation result panel with honest “Cannot Identify Subscriber” + monitoring enroll smoke test.
3. **Scenario 3 proof:** Tamper test harness doc + confidence → “Needs Manual Review” UI string.
4. **Scenario 4 proof:** “Report Leak” nav entry → Unified Investigation + discovery method label.
5. **Scenario 5 proof:** TEP manifest + Access Intelligence + attribute-leak in one demo script.
6. **Cross-cutting:** Google Maps link on GPS pins; evidence PDF field completeness; alert labels.

**Explicitly out of scope until Phase 2:** Instagram/X API, Discord crawl, Neo4j, agency player SDK, silent GPS, session streaming watermark API.

---

## 10. Database Changes Required (Proposed — None Approved)

| Change | Needed for | Risk |
|--------|------------|------|
| None for Scenario 1 proof | — | — |
| Optional: `discoveryMethod` on `EvidenceRecord` | Scenario 4 honesty | Low |
| Optional: `alertType` enum expansion | Alert taxonomy | Low |
| Neo4j | Scenario 5 doc reference | High — defer |

**Recommendation:** Prove all five scenarios with **existing schema** first. Only add columns if investigation reports cannot store discovery method honestly.

---

## 11. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking Smart Link hop flow while fixing UI | Medium | High | Feature flags; no refactor of `resolveAccessHop` |
| Render/Vercel commit drift | High | High | Always push `org/ashwitha` + verify Render Events |
| False DNA match on Scenario 3 | Medium | High | Enforce confidence thresholds + “Manual Review” |
| Over-promising Telegram detection | High | Reputation | Honest labels only |
| GPS consent blocks viewer count | Medium | Medium | Fast-open after Allow (local fix) |
| Pushing before local test | High | High | **Your rule: no push until you verify** |

---

*End of Phase 0 audit. Awaiting approval before any implementation.*
