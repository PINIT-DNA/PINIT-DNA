# PINIT-DNA Enterprise Documentation

**Complete Technical Reference — Single Document**

Document version: 1.0
Generated: July 2026
Source: Codebase analysis (docs/enterprise/)

---


---

# PINIT-DNA â€” Executive Summary

**Document version:** 1.0  
**Audience:** Management and enterprise stakeholders  
**Date:** July 2026

---

## 1. Problem

Organisations need to prove that a digital file:

- Originated from a specific owner and vault  
- Was not altered without detection  
- Has a documented chain of custody from creation to investigation  

Traditional checksums and metadata are insufficient because they break after compression, cropping, screenshotting, or re-encoding. Legal and forensic teams need a deterministic, auditable system that survives file transformation.

---

## 2. Solution

**PINIT-DNA** is a universal forensic identity platform that assigns every supported file a **15-layer DNA fingerprint** at generation time. The DNA is immutable. Lifecycle events (encryption, vault storage, download, share, investigation) are recorded in a separate append-only provenance system.

When a suspect file is found â€” on the internet, in email, or on a device â€” it can be uploaded to **Unified Investigation**. The system searches the owner's vault, ranks candidates, runs deep DNA comparison, and returns an authoritative verdict through the **Acceptance Engine**.

---

## 3. Architecture (High Level)

```
User / Analyst
      |
      v
Web Application (React + Vite on Vercel)
      |
      v
API Server (Node.js + Express on Render)
      |
      +---> DNA Engine (15 layers, 10 file types)
      +---> Vault (AES-256-GCM + Supabase Storage)
      +---> Investigation Pipeline
      +---> TEP / Protected Download
      +---> Forensic Provenance (append-only events)
      |
      v
Database (PostgreSQL on Supabase)
```

---

## 4. Current Status

| Area | Status |
|------|--------|
| 15-layer DNA generation | Implemented â€” all 10 file types LIVE |
| Vault encryption and storage | Implemented |
| Certificate issuance | Implemented |
| Unified Investigation | Implemented |
| Acceptance Engine (5 verdicts) | Implemented |
| Candidate Ranking Engine | Implemented |
| TEP Protected Download | Implemented |
| Forensic provenance / chain of custody | Implemented (partial event coverage) |
| Tracking Dashboard | Implemented |
| Biometric login (face/voice/fingerprint) | Implemented |
| Smart Links (share with access logs) | Implemented |
| Monitoring / Crawler | Implemented |
| Semantic AI search | Implemented |
| Native mobile/desktop apps | Not Yet Implemented |
| Post-download continuous tracking | Not Yet Implemented |

---

## 5. Completed Modules

| Module | Description |
|--------|-------------|
| Universal File Router | Routes 10 file types to DNA engines |
| DNA Orchestrator | Image 15-layer pipeline |
| Universal Engines | TXT, CSV, JSON, PDF, DOCX, PPTX, ZIP, VIDEO, AUDIO |
| Vault Service | Encrypt, store, retrieve, protected download |
| Certificate Service | Issue, verify, revoke certificates |
| TEP Service | Tracked export packages v3.0 |
| Unified Investigation Orchestrator | End-to-end forensic pipeline |
| Acceptance Engine | Sole verdict authority |
| Candidate Ranking Engine | Multi-stage candidate funnel |
| Investigation Manifest | Immutable sealed report contract |
| Forensic Provenance Service | Append-only lifecycle events |
| Comparison Engine | L1â€“L6 scoring with derivative-aware logic |
| Biometric Auth | Face, voice, fingerprint fusion login |
| Share Links | Smart links with viewer tracking |
| Monitoring | URL watch and crawl alerts |

---

## 6. Modules Under Development / Partial

| Module | Gap |
|--------|-----|
| Provenance events | FORWARDED, RECOVERED, CRAWLER_DETECTION not yet appended |
| TEP expiry enforcement | Stored but not checked at extraction |
| Revoked TEP blocking | Status in DB; file still matches on re-upload |
| Video/audio engines | Baseline fingerprints; advanced algorithms planned |
| L11 deepfake | Heuristic only; ML model planned |
| Native viewer | Planned for post-download control |
| Prisma migrate on legacy DB | Workaround script in production start |

---

## 7. Next Milestones

| Milestone | Description | Priority |
|-----------|-------------|----------|
| Production deployment alignment | Single backend URL + Supabase DATABASE_URL on Render | High |
| Vercel env synchronisation | VITE_API_BASE_URL matches live Render service | High |
| Complete provenance event coverage | Live append for share revoke, cert revoke, crawler | Medium |
| TEP expiry + revoked blocking | Enforce at extraction time | Medium |
| Investigation stability | Deterministic results for same input | Medium |
| Native PINIT Viewer | Controlled open + OPENED events | Future |
| ML deepfake layer | Replace L11 heuristics | Future |
| Enterprise PDF documentation | This document set | Current |

---

## 8. Key Metrics (System Capabilities)

| Metric | Value |
|--------|-------|
| Supported file types | 10 (all LIVE) |
| DNA layers | 15 |
| Investigation verdicts | 5 (Acceptance Engine) |
| Evidence channels in scorecard | 7 |
| Tamper detectors | 19 |
| Provenance event types declared | 15 |
| Provenance event types actively appended | 10 |

---

## 9. Deployment

| Component | Platform |
|-----------|----------|
| Frontend | Vercel â€” https://pinit-dna.vercel.app |
| Backend API | Render â€” https://pinit-dna-uf5y.onrender.com |
| Database | Supabase PostgreSQL |
| File storage | Supabase Storage (vault-files bucket) |
| Python AI (optional) | Local sidecar / external URL in production |

---

## 10. Honest Capability Statement

**PINIT-DNA can reliably prove:**

> "This file matches Vault X, DNA Record Y, owned by User Z, was exported via Protected Download at time T, and shows tamper vectors A, B, C compared to the original."

**PINIT-DNA cannot currently prove:**

> "This file was forwarded on WhatsApp to Person Q and opened at Location R without the file being uploaded back into PINIT."

Post-download tracking requires either file recovery via Investigation or a future PINIT-controlled native viewer.

---

*End of document*




---

# PINIT-DNA â€” System Architecture

**Document version:** 1.0  
**Primary references:** `src/server.ts`, `src/app.ts`, `src/api/routes/`, `client/src/`

---

## 1. Overall Architecture

```
+------------------------------------------------------------------+
|                         USER / ANALYST                            |
+------------------------------------------------------------------+
                              |
                              v
+------------------------------------------------------------------+
|              FRONTEND â€” React + TypeScript + Vite                 |
|              Deployed: Vercel (pinit-dna.vercel.app)              |
|                                                                   |
|  Pages: Dashboard, Generate DNA, Vault, Investigation,           |
|         Share Viewer, Monitoring, Security Center, Timeline       |
|  Auth: JWT (pinit_access_token) + Biometric (face/voice/fp)        |
+------------------------------------------------------------------+
                              |
                     HTTPS /api/v1
                              v
+------------------------------------------------------------------+
|              BACKEND â€” Node.js + Express + TypeScript             |
|              Deployed: Render (pinit-dna-uf5y.onrender.com)       |
|              Port: 4000                                           |
+------------------------------------------------------------------+
          |              |              |              |
          v              v              v              v
    +----------+  +------------+  +----------+  +------------+
    | DNA      |  | Vault      |  | Forensic |  | Provenance |
    | Engine   |  | Service    |  | Pipeline |  | Services   |
    +----------+  +------------+  +----------+  +------------+
          |              |              |              |
          v              v              v              v
+------------------------------------------------------------------+
|              DATABASE â€” PostgreSQL (Supabase)                     |
|              STORAGE â€” Supabase Storage (vault-files)             |
+------------------------------------------------------------------+
                              |
                              v (optional, dev)
+------------------------------------------------------------------+
|              PYTHON AI SIDECAR â€” FastAPI (port 8001)              |
|              OCR, embeddings, vision, document analysis           |
+------------------------------------------------------------------+
```

---

## 2. Request Flow â€” DNA Generation

```
Client Upload (multipart)
        |
        v
POST /api/v1/dna/generate
        |
        v
dna.controller.ts
        |
        v
UniversalFileRouter.route()
        |
        +-- IMAGE --> DnaOrchestrator (L1-L15)
        |
        +-- Other --> Type Engine (L1-L6) + L7-L10 + L11-L15
        |
        v
Prisma persist (layer tables + DnaRecord)
        |
        v
forensicProvenanceService.appendAsync(DNA_GENERATED)
        |
        v
Response: dnaRecordId, layers, status
```

---

## 3. Request Flow â€” Vault Store

```
Client Upload + dnaRecordId
        |
        v
POST /api/v1/vault/store
        |
        v
vault.controller.ts --> vault.service.ts
        |
        +--> Vault watermark engine (pre-encrypt)
        +--> AES-256-GCM encrypt
        +--> Upload ciphertext to Supabase Storage
        +--> Prisma vault_records row
        +--> Provenance: ENCRYPTED, VAULT_STORED
        |
        v
Response: vaultId
```

---

## 4. Request Flow â€” Unified Investigation

```
Client Upload (suspect file)
        |
        v
POST /api/v1/forensics/unified-investigate
        |
        v
unified-investigation.orchestrator.ts
        |
        +--> Enterprise Recovery (7 stages)
        |       +--> Candidate Ranking Engine
        |       +--> Deep Vault Compare
        |
        +--> Acceptance Engine (verdict)
        |
        +--> Authoritative DNA Compare
        |
        +--> Tamper Analysis
        |
        +--> Provenance (INVESTIGATED, TAMPERED)
        |
        +--> Investigation Manifest (sealed)
        |
        v
UnifiedInvestigationReport JSON
```

---

## 5. Backend Module Map

### 5.1 API Routes

| Route prefix | Module | File |
|--------------|--------|------|
| /api/v1/auth | Authentication | auth.routes.ts |
| /api/v1/dna | DNA generation + compare | dna.routes.ts |
| /api/v1/vault | Vault storage + protected download | vault.routes.ts |
| /api/v1/certificates | Certificate management | certificate-mgmt.routes.ts |
| /api/v1/forensics | Unified investigation | unified-investigation.routes.ts |
| /api/v1/share | Smart links | share.routes.ts |
| /api/v1/tep | TEP manifests | tep.routes.ts |
| /api/v1/evidence | Evidence reports + signing | evidence.routes.ts |
| /api/v1/monitor | URL monitoring + crawler | monitoring.routes.ts |
| /api/v1/ai | Semantic search + reindex | ai.routes.ts |
| /api/v1/intelligence | Access intelligence | intelligence.routes.ts |
| /api/v1/admin | Admin portal | admin.routes.ts |
| /api/v1/profile | User profile + sessions | profile.routes.ts |
| /api/v1/notifications | Notifications | notification.routes.ts |
| /api/v1/recipients | Recipient profiles | recipients.routes.ts |
| /api/v1/forensic/diff | Forensic diff | forensic-diff.routes.ts |

### 5.2 Core Services

| Service | Path | Role |
|---------|------|------|
| DnaOrchestrator | services/dna.orchestrator.ts | Image 15-layer DNA |
| UniversalFileRouter | services/universal-file-router.ts | Route all file types |
| VaultService | services/vault/vault.service.ts | Encrypt/decrypt/store |
| ProtectedDownloadService | services/vault/protected-download.service.ts | Owner export pipeline |
| TepService | services/tep/tep.service.ts | Tracked export packages |
| ComparisonEngine | services/verification/comparison-engine.ts | Layer-by-layer compare |
| AcceptanceEngine | services/forensics/acceptance-engine.service.ts | Final verdict |
| CandidateRankingEngine | services/forensics/candidate-ranking-engine.service.ts | Candidate funnel |
| UnifiedInvestigationOrchestrator | services/forensics/unified-investigation.orchestrator.ts | Investigation pipeline |
| InvestigationManifestBuilder | services/forensics/investigation-manifest.builder.ts | Sealed report |
| ForensicProvenanceService | services/forensics/forensic-provenance.service.ts | Append-only events |
| TamperAnalysisService | services/forensics/tamper-analysis.service.ts | Tamper detectors |
| CertificateService | services/certificates/certificate.service.ts | Certificates |
| WatermarkService | services/watermark/watermark.service.ts | Share/TEP watermarks |
| VaultWatermarkEngine | services/watermark/vault-watermark-engine.service.ts | Pre-vault embed |
| AuthService | services/auth/auth.service.ts | JWT login |
| BiometricAuthService | services/auth/biometric-auth.service.ts | Face/voice/fp |
| ShareLinkService | services/share/share-link.service.ts | Smart links |
| SemanticSearchService | services/semantic/semantic-search.service.ts | AI search |
| MonitorService | services/monitor/ (monitoring routes) | URL watch |

### 5.3 Provenance Subsystem

| Service | Path |
|---------|------|
| download-event.service.ts | Protected download custody |
| revoke.service.ts | TEP revocation |
| timeline.service.ts | Evidence timeline read API |
| chain-of-custody.service.ts | Ordered custody projection |
| tracking-dashboard.service.ts | Vault tracking UI data |
| geo-ip.service.ts | IP to country/city |
| event-bus.ts | In-process event dispatcher |

### 5.4 Layer Services (L1â€“L15)

| Layer | File |
|-------|------|
| L1 | services/layers/layer1.cryptographic.ts |
| L2 | services/layers/layer2.structural.ts |
| L3 | services/layers/layer3.perceptual.ts |
| L4 | services/layers/layer4.semantic.ts |
| L5 | services/layers/layer5.metadata.ts |
| L6 | services/layers/layer6.steganography.ts |
| L7 | services/layers/layer7.behavioral.ts |
| L8 | services/layers/layer8.relationship.ts |
| L9 | services/layers/layer9.origin.ts |
| L10 | services/layers/layer10.evolution.ts |
| L11â€“L15 | services/layers/layers-11-15.service.ts |

### 5.5 Universal Engines

| Type | File |
|------|------|
| TXT | services/engines/txt/txt-dna-engine.ts |
| CSV | services/engines/csv/csv-dna-engine.ts |
| JSON | services/engines/json/json-dna-engine.ts |
| PDF | services/engines/pdf/pdf-dna-engine.ts |
| DOCX | services/engines/docx/docx-dna-engine.ts |
| PPTX | services/engines/pptx/pptx-dna-engine.ts |
| ZIP | services/engines/zip/zip-dna-engine.ts |
| VIDEO | services/engines/video/video-dna-engine.ts |
| AUDIO | services/engines/audio/audio-dna-engine.ts |

---

## 6. Frontend Module Map

| Page | Path | Purpose |
|------|------|---------|
| Dashboard | pages/DashboardPage.tsx | Overview stats |
| Generate DNA | App.tsx / UploadZone | DNA generation flow |
| Vault Explorer | pages/VaultPage.tsx | Vault list, protected download, tracking |
| Unified Investigation | pages/UnifiedInvestigationPage.tsx | Forensic investigation |
| DNA Records | pages/DnaRecordsPage.tsx | DNA record list |
| File Timeline | pages/TimelinePage.tsx | Share/access timeline |
| Share Viewer | pages/ShareViewerPage.tsx | Public share link viewer |
| Monitoring | pages/MonitoringPage.tsx | URL monitor + alerts |
| Security Center | pages/SecurityCenterPage.tsx | Incidents + evidence |
| Access Intelligence | pages/AccessIntelligencePage.tsx | Share analytics |

**API client:** `client/src/services/dashboard.api.ts`  
**Config:** `client/src/config/api.config.ts`

---

## 7. Database Schema (Key Models)

```
User
  |
  +-- DnaRecord
  |     +-- CryptoLayer (L1)
  |     +-- StructuralLayer (L2)
  |     +-- ... (L3-L15 layer tables)
  |     +-- VaultRecord (1:1)
  |     +-- Certificate[]
  |     +-- ForensicProvenanceEvent[]
  |
  +-- ShareLink[]
  +-- MonitorRecord[]
  +-- RefreshToken[]

TrackedExportPackage (TEP)
WatermarkProfile
ShareAccessLog
VerificationLog
```

**ORM:** Prisma â€” `prisma/schema.prisma`

---

## 8. Security Architecture

```
Authentication
  JWT (7-day access, 30-day refresh)
  Biometric fusion (face + voice + fingerprint)
  Multi-tenant isolation (ownerUserId on all queries)

Encryption
  Vault: AES-256-GCM + HKDF-SHA256
  VAULT_MASTER_SECRET (env)
  Supabase Storage for ciphertext

Signing
  L6 HMAC / LSB steganography
  TEP manifest HMAC tail
  Report manifest signing (report-signing.service.ts)

Isolation
  tenant-scope.ts â€” all queries scoped to JWT sub
  assertVaultOwner, assertDnaOwner, etc.
```

---

## 9. External Dependencies

| Dependency | Purpose | Required |
|------------|---------|----------|
| Supabase PostgreSQL | Primary database | Yes |
| Supabase Storage | Vault file storage | Yes |
| Render | Backend hosting | Yes |
| Vercel | Frontend hosting | Yes |
| Python AI (FastAPI) | OCR, embeddings, vision | Optional |
| Apache Tika | Enhanced metadata | Optional |
| Geo-IP | Location from IP | Built-in via share-link geo |

---

## 10. Investigation Data Flow (Detailed)

```
Probe File
    |
    v
EphemeralFingerprinter ------> Probe DNA (L1-L6, L7-L10)
    |
    v
Vector Search (FAISS) --------> Candidate pool (top 100)
    |
    v
Candidate Ranking Engine -----> Deep pool (top 2-4)
    |
    v
DeepVaultCompareService ------> 15-layer compare per candidate
    |
    v
Acceptance Engine ------------> Verdict + scorecard
    |
    v
Authoritative DNA Compare ----> Final DNA lock on winner
    |
    v
Tamper Analysis --------------> 19 detector registry
    |
    v
Manifest Builder -------------> Sealed investigation-manifest-v1.0
    |
    v
Report (JSON + optional PDF/ZIP export)
```

---

## 11. Deployment Topology

```
Developer Machine
  npm run dev:all
    Node :4000 (API)
    Vite :3000 (client, proxies /api to :4000)
    Python :8001 (AI, optional)

Production
  Vercel CDN --> React static build
       |
       HTTPS --> Render Web Service (Node :4000)
                     |
                     +--> Supabase PostgreSQL
                     +--> Supabase Storage
```

**Start command (Render):** `npm run render:start` â†’ `ensure-provenance-table.cjs` + `node dist/server.js`

---

*End of document*




---

# PINIT-DNA â€” 15-Layer DNA Architecture

**Document version:** 1.0  
**Source of truth:** Codebase analysis (not marketing claims)  
**Primary references:** `src/constants/dna-layer-registry.ts`, `src/services/dna.orchestrator.ts`, `src/services/universal-file-router.ts`, `prisma/schema.prisma`

---

## 1. Overview

PINIT-DNA assigns every supported file a **15-layer forensic identity**. Layers L1â€“L10 are core content and context fingerprints. Layers L11â€“L15 are advanced registry layers generated only when an authenticated owner (`ownerUserId`) is present at generation time.

Two related models exist in code:

| Model | Purpose | Location |
|-------|---------|----------|
| Generation registry | DNA creation, storage, comparison | `src/constants/dna-layer-registry.ts` |
| Investigation report map (`15-layer-v1`) | Unified investigation UI and reports | `src/types/dna-layer.types.ts`, `dna-layer-standardization.service.ts` |

**Constants:** `TOTAL_DNA_LAYERS = 15`, `CORE_DNA_LAYERS = 10`, `ADVANCED_DNA_LAYERS = 5` (`src/constants/dna-layers.ts`).

---

## 2. Summary Table

| Layer | Name | Primary Algorithm | Images | Video | PDF | Documents | Audio | Security Level | Immutable | Status |
|-------|------|-------------------|--------|-------|-----|-----------|-------|----------------|-----------|--------|
| L1 | Cryptographic | SHA-256 (+ optional BLAKE3 for images) | Yes | Yes | Yes | Yes | Yes | High | Yes | Implemented |
| L2 | Structural | Sobel edges (image) / type-specific structure hash | Yes | Yes | Yes | Yes | Yes | Mediumâ€“High | Yes | Implemented |
| L3 | Perceptual | DCT pHash (image) / SimHash (universal) | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Implemented |
| L4 | Semantic | RGB/HSV histograms / distribution fingerprints | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Implemented |
| L5 | Metadata | EXIF/IPTC/XMP / container metadata hash | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Implemented |
| L6 | Signature | LSB steganography + HMAC (image) / HMAC over L1â€“L5 | Yes | Yes | Yes | Yes | Yes | High | Yes | Implemented |
| L7 | Behavioral | SHA-256 behavior bundle (filename, size, session) | Yes | Yes | Yes | Yes | Yes | Lowâ€“Medium | Yes | Implemented |
| L8 | Relationship | SHA-256 graph hash (duplicate linkage) | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Implemented |
| L9 | Origin | SHA-256 origin bundle (IP, geo, user agent) | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Implemented (geo when provided) |
| L10 | Evolution | Merkle root over mutation log | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Implemented |
| L11 | Deepfake Detection | Heuristic byte/pixel analysis | Yes | Partial | Yes | Yes | Yes | Lowâ€“Medium | Yes | Partially Implemented |
| L12 | Invisible Watermark | DCT frequency watermark record (hash stored) | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Partially Implemented |
| L13 | Chain of Custody | Legal custody chain JSON + evidence hash | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Implemented |
| L14 | ZK Ownership Proof | Hash commitment + AES-GCM secret | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Partially Implemented |
| L15 | Biometric Bind | SHA-256 of face embedding or NOT_REGISTERED | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Partially Implemented |

**Notes on â€œDocumentsâ€:** TXT, CSV, JSON, DOCX, PPTX, and ZIP are supported via universal engines (`src/services/engines/`).

---

## 3. Layer-by-Layer Detail

### Layer 1 â€” Cryptographic

| Field | Detail |
|-------|--------|
| Purpose | Byte-exact and normalized content identity |
| Generation | `layer1.cryptographic.ts` (images); universal engines L1 (all types) |
| Algorithm | SHA-256 of raw bytes; images also compute normalized pixel hash; optional BLAKE3 via `dna-enhancements.ts` |
| Storage | `crypto_layers` table (images); `DnaRecord.universalFingerprints` JSON (non-image L1â€“L6) |
| Verification | Binary exact match in `comparison-engine.ts`; weight 35% |
| Immutability | Yes â€” stored at generation; never overwritten |
| PASS | Probe fingerprint equals vault fingerprint (score 1.0) |
| FAIL | Fingerprints differ (score 0) |
| SKIPPED | Layer not generated for probe or vault side |

### Layer 2 â€” Structural

| Field | Detail |
|-------|--------|
| Purpose | Layout and structural organization fingerprint |
| Generation | `layer2.structural.ts` (Sobel edge detection â†’ 64-bit signature); universal per-type L2 |
| Media | All 10 supported file types |
| Algorithm | Image: Sobel edges. PDF: page layout. Video: container/box structure. Others: type-specific |
| Storage | `structural_layers` / universal JSON |
| Verification | Hex/Hamming similarity; threshold 0.80; weight 20% |
| Status | Implemented |

### Layer 3 â€” Perceptual

| Field | Detail |
|-------|--------|
| Purpose | Near-duplicate and perceptual similarity |
| Generation | `layer3.perceptual.ts` (DCT pHash64/256); universal SimHash |
| Algorithm | Image: pHash/aHash/dHash. Universal: SimHash on content chunks |
| Verification | Hamming distance on hex hashes; threshold 0.75; weight 20% |
| Status | Implemented â€” primary layer for derivative matching when L1 differs |

### Layer 4 â€” Semantic

| Field | Detail |
|-------|--------|
| Purpose | Content meaning / distribution fingerprint |
| Generation | `layer4.semantic.ts`; universal semantic distributions |
| Algorithm | Image: RGB/HSV histograms. Text: word frequencies. Video/audio: codec/tag profiles |
| Verification | Hex/Hamming; threshold 0.70; weight 10% |
| Status | Implemented |

### Layer 5 â€” Metadata

| Field | Detail |
|-------|--------|
| Purpose | Provenance and container metadata fingerprint |
| Generation | `layer5.metadata.ts`; universal metadata extractors |
| Algorithm | Image: EXIF/IPTC/XMP + C2PA-style manifest hash. PDF: info dict. DOCX/PPTX: OPC core.xml |
| Verification | Binary match; threshold 0.60; weight 5% |
| Status | Implemented |
| Investigation note | Report slot â€œAI Fingerprintâ€ maps here in UI but is often SKIPPED in reports |

### Layer 6 â€” Signature

| Field | Detail |
|-------|--------|
| Purpose | Integrity seal and hidden signature |
| Generation | `layer6.steganography.ts` (LSB blue-channel + HMAC); universal HMAC over L1â€“L5 |
| Algorithm | Image: LSB steganography. Universal: HMAC-SHA256 |
| Verification | Binary match; threshold 0.90; weight 10% |
| Comparison note | Probe and vault L6 stabilised via `HMAC("COMPARE:" + fileType + L1â€“L5)` for fair comparison |
| Status | Implemented |

### Layer 7 â€” Behavioral

| Field | Detail |
|-------|--------|
| Purpose | Upload session behavior fingerprint |
| Generation | `layer7.behavioral.ts` |
| Algorithm | SHA-256 of filename, size, mime, upload timing, user agent, session |
| Storage | `behavioral_layers` |
| Verification | Compared if present; **weight 0** in overall DNA score |
| Status | Implemented â€” registry evidence, not content identity |

### Layer 8 â€” Relationship

| Field | Detail |
|-------|--------|
| Purpose | Duplicate and graph linkage |
| Generation | `layer8.relationship.ts` â€” Prisma lookup for same SHA-256, sorted related IDs |
| Algorithm | SHA-256 graph hash |
| Verification | Weight 0 in score; vault-compare mode may credit when content verified |
| Status | Implemented |

### Layer 9 â€” Origin

| Field | Detail |
|-------|--------|
| Purpose | Upload origin context |
| Generation | `layer9.origin.ts` |
| Algorithm | SHA-256 bundle: IP, user agent, country, city, filename, timestamp |
| Verification | Weight 0; geo only when router receives IP/GPS |
| Status | Implemented |

### Layer 10 â€” Evolution

| Field | Detail |
|-------|--------|
| Purpose | Version and mutation chain |
| Generation | `layer10.evolution.ts` |
| Algorithm | Merkle root over mutation log (starts with ORIGIN entry) |
| Verification | Weight 0 |
| Status | Implemented |

### Layer 11 â€” Deepfake Detection

| Field | Detail |
|-------|--------|
| Purpose | AI/manipulation signal heuristics |
| Generation | `layers-11-15.service.ts` â€” pixel noise, JPEG quantization, channel stats |
| Algorithm | `ai_deepfake_analysis` â€” heuristic, not ML model (`modelVersion: '1.0'`) |
| Condition | Requires `ownerUserId`; media analysis emphasised for image/video MIME |
| Status | **Partially Implemented** â€” heuristic only |

### Layer 12 â€” Invisible Watermark

| Field | Detail |
|-------|--------|
| Purpose | Owner identity watermark record |
| Generation | `layers-11-15.service.ts` |
| Algorithm | SHA-256 payload hash; method varies by MIME (`dct-frequency`, `psychoacoustic`, `structural-encoding`) |
| Status | **Partially Implemented** â€” record stored; actual DCT embed in file depends on vault/TEP watermark pipeline |

### Layer 13 â€” Chain of Custody

| Field | Detail |
|-------|--------|
| Purpose | Legal custody chain entry at DNA generation |
| Generation | `layers-11-15.service.ts` |
| Algorithm | JSON custody entry + evidence hash |
| Storage | `custody_layers` |
| Status | Implemented â€” separate from append-only `forensic_provenance_events` timeline |

### Layer 14 â€” ZK Ownership Proof

| Field | Detail |
|-------|--------|
| Purpose | Ownership commitment |
| Generation | `layers-11-15.service.ts` |
| Algorithm | `H(secret || fileHash || ownerUserId)` with AES-GCM encrypted secret |
| Status | **Partially Implemented** â€” hash commitment, not a zero-knowledge protocol |

### Layer 15 â€” Biometric Bind

| Field | Detail |
|-------|--------|
| Purpose | Bind DNA to uploader biometrics |
| Generation | `layers-11-15.service.ts` |
| Algorithm | SHA-256 of user `faceEmbedding` from database, or `NOT_REGISTERED` |
| Status | **Partially Implemented** â€” `embeddedInFile: false` when not registered |

---

## 4. PASS / FAIL / SKIPPED Meanings

Three status systems exist in code:

### A. Generation status (`DnaRecord.status`)

| Value | Meaning |
|-------|---------|
| COMPLETE | All 15 layers succeeded |
| PARTIAL | Some layers succeeded |
| FAILED | No layers succeeded |
| PENDING / PROCESSING | In progress |

### B. Comparison (`comparison-engine.ts`)

Uses `matched: boolean`, `skipped: boolean`, `similarityScore` â€” not PASS/FAIL strings.

Skip reasons include: layer not generated for file type; registry layers L7â€“L15 not regenerated on probe.

### C. Investigation report (`ChannelState`)

| Value | Meaning |
|-------|---------|
| PASS | Channel contributed positively to Acceptance Engine scorecard |
| FAIL | Channel failed or DNA classification DIFFERENT / score below 40 |
| SKIPPED | Channel not applicable or evidence unavailable |

Mapped in `src/services/forensics/dna-layer-standardization.service.ts`.

---

## 5. DNA Generation Workflow

```
User uploads file
        |
        v
FileTypeDetector (src/services/file-type-detector.ts)
        |
        +--- IMAGE --------------------------> DnaOrchestrator
        |                                      |
        |                                      L1-L4 parallel
        |                                      L5 (needs L1)
        |                                      L6 (needs record ID)
        |                                      L7-L10 parallel
        |                                      Persist L1-L10 to Prisma
        |                                      L11-L15 if ownerUserId
        |
        +--- TXT, CSV, JSON, PDF, DOCX,      Universal engine L1-L6
             PPTX, ZIP, VIDEO, AUDIO  -----> L7-L10 parallel
                                               L11-L15 if ownerUserId
                                               Persist to Prisma + universalFingerprints JSON
        |
        v
Optional: dna-enhancement-bundle (OCR, screenshot DNA, video/audio extras)
        |
        v
Optional: forensicProvenanceService.appendAsync(DNA_GENERATED)
        |
        v
DnaRecord status: COMPLETE | PARTIAL | FAILED
```

**Image pipeline:** `src/services/dna.orchestrator.ts`  
**Universal pipeline:** `src/services/universal-file-router.ts`  
**Supported types config:** `src/config/supported-file-types.ts` (all 10 types marked `LIVE`)

---

## 6. Storage Architecture

| Layer | Prisma Model | Table |
|-------|--------------|-------|
| L1 | CryptoLayer | crypto_layers |
| L2 | StructuralLayer | structural_layers |
| L3 | PerceptualLayer | perceptual_layers |
| L4 | SemanticLayer | semantic_layers |
| L5 | MetadataLayer | metadata_layers |
| L6 | StegoLayer | stego_layers |
| L7 | BehavioralLayer | behavioral_layers |
| L8 | RelationshipLayer | relationship_layers |
| L9 | OriginLayer | origin_layers |
| L10 | EvolutionLayer | evolution_layers |
| L11 | DeepfakeLayer | deepfake_layers |
| L12 | DctWatermarkLayer | dct_watermark_layers |
| L13 | CustodyLayer | custody_layers |
| L14 | ZkProofLayer | zk_proof_layers |
| L15 | BiometricBindLayer | biometric_bind_layers |

Non-image L1â€“L6 also stored in `DnaRecord.universalFingerprints` JSON.

**Immutability rule:** DNA layers are write-once at generation. Lifecycle events (download, share, investigation) are stored separately in `forensic_provenance_events` â€” never merged into DNA.

---

## 7. Implementation Status Summary

| Category | Status |
|----------|--------|
| L1â€“L10 generation (all 10 file types) | Implemented |
| L11â€“L15 generation (when owner present) | Implemented |
| L1â€“L6 comparison scoring | Implemented |
| L7â€“L15 comparison | Partial â€” weight 0 or skipped; vault credit in compare mode |
| Investigation 15-slot report standardisation | Implemented |
| Video ffprobe / keyframe pHash (config names) | Planned â€” not in current `video-dna-engine.ts` |
| Chromaprint for audio (config names) | Planned â€” engine uses chunk SimHash |
| True ZK proof (L14) | Planned |
| ML-based deepfake (L11) | Planned |

---

*End of document*




---

# PINIT-DNA â€” File Type Security Matrix

**Document version:** 1.0  
**Primary reference:** `src/config/supported-file-types.ts`, `src/services/universal-file-router.ts`

---

## 1. Supported File Types (Implemented)

All types below have `engineStatus: 'LIVE'` in configuration.

| File Type | Extensions | Max Size | Engine |
|-----------|------------|----------|--------|
| IMAGE | .jpg, .jpeg, .png, .webp, .tiff, .gif, .bmp | 20 MB | `DnaOrchestrator` |
| TXT | .txt, .log, .md | 10 MB | `engines/txt/txt-dna-engine.ts` |
| CSV | .csv | 50 MB | `engines/csv/csv-dna-engine.ts` |
| JSON | .json | 10 MB | `engines/json/json-dna-engine.ts` |
| PDF | .pdf | 50 MB | `engines/pdf/pdf-dna-engine.ts` |
| DOCX | .docx | 50 MB | `engines/docx/docx-dna-engine.ts` |
| PPTX | .pptx | 100 MB | `engines/pptx/pptx-dna-engine.ts` |
| ZIP | .zip | 500 MB | `engines/zip/zip-dna-engine.ts` |
| VIDEO | .mp4, .mov, .avi, .mkv, .webm | 500 MB | `engines/video/video-dna-engine.ts` |
| AUDIO | .mp3, .wav, .flac, .aac, .m4a | 100 MB | `engines/audio/audio-dna-engine.ts` |

---

## 2. Security Matrix by File Type

### 2.1 Images

| Capability | Status | Notes |
|------------|--------|-------|
| DNA layers L1â€“L15 | Implemented | Full 15-layer image pipeline |
| L2 algorithm | Sobel edge detection | `layer2.structural.ts` |
| L3 algorithm | DCT pHash64/256 | Best for crop/compress derivatives |
| L6 algorithm | LSB steganography + HMAC | |
| Tracking (TEP / provenance) | Implemented | When vaulted and exported via protected download or share |
| Tamper detection | Implemented | Full tamper registry in investigation; crop/resize/compress/screenshot heuristics |
| Ownership recovery | Implemented | Unified investigation + vector search + local patch DNA |
| Watermark (vault store) | Implemented | DCT + DWT + tail via `vault-watermark-engine.service.ts` |
| Watermark (TEP export) | Implemented | EXIF/metadata + structural tail |
| Certificate | Implemented | `certificate.service.ts` |
| Investigation | Implemented | Full unified investigation pipeline |
| Limitations | | Heavy crop (>60%) may reduce DNA score; camera scan quality affects probe DNA |

### 2.2 Videos

| Capability | Status | Notes |
|------------|--------|-------|
| DNA layers L1â€“L15 | Implemented | Universal video engine (baseline) |
| L2â€“L5 | Partially Implemented | Container/box/chunk SimHash; ffprobe/keyframe pHash named in config but not in engine |
| Tracking | Implemented | Same provenance/TEP as other types when vaulted |
| Tamper detection | Implemented | Video re-encoding detector in tamper analysis |
| Ownership recovery | Implemented | Investigation supported; performance slower on large files |
| Watermark | Partially Implemented | Binary tail watermark; limited metadata embed |
| Certificate | Implemented | |
| Limitations | | 500 MB max; deep compare timeouts on Render free tier; no frame-level pHash yet |

### 2.3 PDF

| Capability | Status | Notes |
|------------|--------|-------|
| DNA layers L1â€“L15 | Implemented | Universal PDF engine |
| L2â€“L6 | Implemented | Page layout, text SimHash, metadata, HMAC |
| Tracking | Implemented | TEP metadata embed in PDF export |
| Tamper detection | Implemented | OCR/metadata/format conversion detectors |
| Ownership recovery | Implemented | Investigation + vault scan-verify |
| Watermark | Implemented | PDF metadata + invisible page text (`watermark.service.ts`) |
| Certificate | Implemented | |
| Limitations | | Scanned PDFs depend on OCR quality |

### 2.4 Documents (TXT, CSV, JSON, DOCX, PPTX)

| Capability | Status | Notes |
|------------|--------|-------|
| DNA layers L1â€“L15 | Implemented | Per-type universal engines |
| L1â€“L6 storage | `universalFingerprints` JSON + L7â€“L15 tables | |
| Tracking | Implemented | Provenance events when vaulted |
| Tamper detection | Implemented | OCR changes, format conversion |
| Ownership recovery | Implemented | Investigation supported |
| Watermark | Partial | DOCX: custom XML; TXT/CSV: pass-through on share export |
| Certificate | Implemented | |
| Limitations | | Plain TXT has weaker perceptual matching than images |

### 2.5 Audio

| Capability | Status | Notes |
|------------|--------|-------|
| DNA layers L1â€“L15 | Implemented | Universal audio engine |
| L3 | Partially Implemented | Chunk SimHash + ID3; Chromaprint listed in config but not implemented |
| Tracking | Implemented | TEP binary tail |
| Tamper detection | Implemented | Audio re-encoding detector |
| Ownership recovery | Implemented | Investigation supported |
| Watermark | Partial | Binary tail only |
| Certificate | Implemented | |
| Limitations | | Re-encoded/transcoded audio reduces match confidence |

### 2.6 ZIP

| Capability | Status | Notes |
|------------|--------|-------|
| DNA layers L1â€“L15 | Implemented | Directory tree + entry SimHash |
| Tracking | Implemented | `.pinit/` manifest in ZIP comment when vault watermarked |
| Tamper detection | Partial | Archive structure changes detectable; inner file edits may vary |
| Ownership recovery | Implemented | Investigation on archive fingerprint |
| Watermark | Partial | ZIP comment + hidden manifest |
| Certificate | Implemented | |
| Limitations | | 500 MB max; inner file replacement changes fingerprint |

---

## 3. Future Supported Formats

| Format | Status | Notes |
|--------|--------|-------|
| XLSX | Planned | Not in `SUPPORTED_FILE_TYPES` registry |
| Additional image RAW formats | Planned | Not registered |
| Email (.eml, .msg) | Planned | Not registered |
| Additional video codecs | Planned | Enhancement noted in video engine comments |

Non-`LIVE` types would throw: *"DNA engine for X is not yet available"* from `universal-file-router.ts`.

---

## 4. Cross-Cutting Capabilities

| Capability | Images | Video | PDF | Documents | Audio | ZIP |
|------------|--------|-------|-----|-----------|-------|-----|
| Vault AES-256-GCM encryption | Yes | Yes | Yes | Yes | Yes | Yes |
| Supabase Storage persistence | Yes | Yes | Yes | Yes | Yes | Yes |
| Share links (Smart Links) | Yes | Yes | Yes | Yes | Yes | Yes |
| Protected Download (TEP) | Yes | Yes | Yes | Yes | Yes | Yes |
| Unified Investigation | Yes | Yes | Yes | Yes | Yes | Yes |
| Monitoring / Crawler enrollment | Yes | Partial | Partial | Partial | Partial | Partial |
| Semantic AI search | Yes | Yes | Yes | Yes | Yes | Yes |
| Location tracking (custody) | Optional GPS at generation | Same | Same | Same | Same | Same |

---

## 5. DNA Layer Availability by Type

| Layer | Image | Video | PDF | DOCX/PPTX/TXT/CSV/JSON | Audio | ZIP |
|-------|-------|-------|-----|------------------------|-------|-----|
| L1â€“L6 (content) | Full image algorithms | Universal engine | Universal | Universal | Universal | Universal |
| L7â€“L10 (context) | Yes | Yes | Yes | Yes | Yes | Yes |
| L11â€“L15 (advanced) | Yes (if owner) | Yes (if owner) | Yes (if owner) | Yes (if owner) | Yes (if owner) | Yes (if owner) |

Probe DNA during investigation generates L1â€“L6 (and L7â€“L10 where applicable) **without** L11â€“L15 unless owner context exists on probe path.

---

## 6. Known Limitations (All Types)

1. **Web application** â€” cannot track files after download unless recovered via investigation or PINIT-controlled viewer.
2. **WhatsApp sharing** â€” no automatic detection of WhatsApp forwarding; recompression may be inferred during investigation preprocessing.
3. **Free-tier Render** â€” cold starts cause 30â€“90 second delays; investigation timeouts configured in `investigation-performance.ts`.
4. **DNA immutability** â€” lifecycle events never modify stored DNA; corrections require new DNA generation.
5. **TEP expiry** â€” stored in database but not enforced at extraction time (Not Yet Implemented).

---

*End of document*




---

# PINIT-DNA â€” Forensic Investigation Architecture

**Document version:** 1.0  
**Primary references:** `src/services/forensics/unified-investigation.orchestrator.ts`, `acceptance-engine.service.ts`, `candidate-ranking-engine.service.ts`, `investigation-manifest.builder.ts`

---

## 1. Unified Investigation Overview

Unified Investigation is the single forensic pipeline that accepts a suspect file (probe), searches the owner's vault, ranks candidates, runs deep 15-layer DNA comparison, and produces a sealed report with an authoritative verdict from the **Acceptance Engine**.

**API entry:** `POST /api/v1/forensics/unified-investigate`  
**Optional streaming:** `?stream=true` (SSE progress events)  
**Controller:** `src/api/controllers/unified-investigation.controller.ts`

---

## 2. Investigation Flow

```
Upload suspect file (probe)
        |
        v
+---------------------------+
| Enterprise Recovery       |  7-stage PINIT Original Identity Recovery
| (parallel: leak verify)   |  + lightweight leaked-file verify
+---------------------------+
        |
        +--- timeout + live vault lead ----> Partial report (Acceptance re-run)
        |
        +--- timeout, no vault ------------> INSUFFICIENT_EVIDENCE
        |
        +--- no candidate / NO_SIGNATURE ---> NOT_PINIT report
        |
        v
+---------------------------+
| deriveInvestigationOutcome|  Acceptance Engine (sole verdict authority)
+---------------------------+
        |
        v
+---------------------------+
| Authoritative 15-layer    |  compareProbeToAuthoritativeAsset
| DNA Compare               |
+---------------------------+
        |
        +--- rejected ----------------------> NOT_PINIT or downgrade
        |
        v
+---------------------------+
| Enrichment (parallel)     |  Tamper, access intelligence, owner,
|                           |  leak intelligence, operational timeline
+---------------------------+
        |
        v
+---------------------------+
| Forensic Provenance       |  Append INVESTIGATED / TAMPERED events
|                           |  Load evidenceTimeline + provenanceSummary
+---------------------------+
        |
        v
+---------------------------+
| Report Assembly           |  UnifiedInvestigationReport
+---------------------------+
        |
        v
+---------------------------+
| Seal with Manifest        |  buildInvestigationManifest (immutable)
| + Pipeline Audit          |  Diagnostic trace (does not change verdict)
+---------------------------+
        |
        v
Final JSON report (+ optional PDF/ZIP export on frontend)
```

---

## 3. Enterprise Recovery â€” Internal Stages

**File:** `src/services/forensics/pinit-original-identity-recovery.service.ts`  
**Wrapper:** `enterprise-recovery-pipeline.service.ts`

| Stage | ID | Purpose |
|-------|-----|---------|
| 1 | stage1_forensic_recovery | Watermark, identity token, manifest recovery from probe |
| 2 | stage2_probe_dna | Ephemeral 15-layer probe DNA (skipped in fast investigation mode when configured) |
| 3 | stage3_vault_search | Vault / identity hit search |
| 3b | stage3b_local_dna_index | Local patch DNA index search |
| 4 | stage4_similarity_vector | Vector similarity scoring (FAISS / embeddings) |
| 5 | stage5_deep_dna_compare | 15-layer deep compare + Candidate Ranking Engine walk |
| 6 | stage6_confidence_fusion | Multi-signal fusion scores |
| 7 | stage7_decision | Internal fusion verdict (superseded by Acceptance Engine at report level) |

**Fast path:** SHA-256 exact hash match skips most stages.

---

## 4. Live UI Timeline (SSE)

Emitted steps during streaming investigation:

| Step ID | Label |
|---------|-------|
| preprocessing | Preprocessing |
| identity_recovery | Identity Recovery |
| vault_search | Vault Search |
| orb_verification | ORB Verification |
| deep_dna_compare | Deep DNA Compare |
| final_report | Final Report |

---

## 5. Candidate Ranking Engine

**File:** `src/services/forensics/candidate-ranking-engine.service.ts`  
**Invoked from:** Phase 5 of enterprise recovery

### Funnel stages

```
All vector candidates
        |
        v  Top 100 (RANKING_TOP_VECTOR)
Vector pool
        |
        v  Top 30 (RANKING_TOP_IDENTITY) â€” identity hit promoted
Identity filter
        |
        v  Top 20 (RANKING_TOP_MEDIA)
Media filter
        |
        v  Top 2â€“4 (RANKING_TOP_DEEP or RANKING_TOP_DEEP_STRONG_LEAD)
Deep pool
        |
        v  Per-candidate deep DNA + Acceptance Engine walk
Winner selection
```

### Key constants

| Constant | Value |
|----------|-------|
| RANKING_TOP_VECTOR | 100 |
| RANKING_TOP_IDENTITY | 30 |
| RANKING_TOP_MEDIA | 20 |
| RANKING_TOP_DEEP | 4 |
| RANKING_TOP_DEEP_STRONG_LEAD | 2 |
| RANKING_TRUSTED_LEAD_MIN | 50% |
| LOCAL_PATCH_RESCUE_MIN | 45% |

### Winner selection rules

1. SHA-256 exact match â†’ immediate accept as VERIFIED_ORIGINAL
2. For each deep-pool candidate: run deep DNA compare
3. Hard DNA gate: reject if score < 40 or classification DIFFERENT (unless exact hash or local-patch rescue)
4. Run Acceptance Engine per candidate
5. Accept on VERIFIED_ORIGINAL, VERIFIED_DERIVATIVE, or POSSIBLE_MATCH
6. Reject and try next candidate â€” does not stop at rank #1 by default

---

## 6. Acceptance Engine

**File:** `src/services/forensics/acceptance-engine.service.ts`  
**Policy version:** `acceptance-policy-v1.0`  
**Rule:** Only `runAcceptanceEngine()` may emit final verdicts.

### Evidence channels (weighted scorecard)

| Channel | Weight |
|---------|--------|
| DNA | 30 |
| Certificate | 25 |
| Visual | 15 |
| Metadata | 10 |
| Watermark | 10 |
| Timeline | 5 |
| Owner | 5 |

FAIL and SKIPPED channels contribute 0. DNA channel forced to FAIL if classification is DIFFERENT or score < 40.

### Key thresholds

| Constant | Value |
|----------|-------|
| DNA_FULL_PASS_MIN | 75 |
| DNA_PARTIAL_MIN | 40 |
| VISUAL_PASS_MIN | 40 |
| VISUAL_STRONG_MIN | 80 |
| VERIFIED_ORIGINAL_CONFIDENCE_MIN | 95 (scorecard total) |

### Decision priority

1. INSUFFICIENT_EVIDENCE â€” analysis incomplete
2. NOT_PINIT â€” no candidate
3. VERIFIED_ORIGINAL â€” full DNA pass, all gates PASS, scorecard > 95, no tamper
4. VERIFIED_DERIVATIVE â€” DNA + visual + tamper detected
5. POSSIBLE_MATCH â€” partial DNA + vault locked + weak/missing cert/watermark
6. Default â†’ NOT_PINIT

---

## 7. Investigation Manifest

**File:** `src/services/forensics/investigation-manifest.builder.ts`  
**Version:** `investigation-manifest-v1.0`  
**Sealed:** `Object.freeze()` on every report path

| Section | Contents |
|---------|----------|
| probe | filename, mime, size, SHA-256, probeId |
| candidates | ranked funnel logs |
| acceptedCandidate | locked vault/DNA/method/tier |
| verdict + confidenceBreakdown | Acceptance verdict + scorecard |
| owner, vault, dna, certificate | Identity anchors |
| tamper | primary vector, score, per-flag YES/NO/UNKNOWN |
| timeline | operational timeline events |
| lifecycle | 11-stage custody trail |
| layers | standardised 15-layer DNA slots |
| evidence | watermark status, identity verification, digital signature |
| scores | retrieval, ownership, identity, trust, DNA % |

---

## 8. Evidence Collection

Evidence is assembled from multiple sources â€” not a separate graph database class, but connected nodes in the report:

| Evidence node | Source |
|---------------|--------|
| Owner / Vault / DNA / Certificate | Authoritative asset lookup |
| Timeline / Shares / Downloads | `buildTimeline`, share access logs, TEP records |
| Investigation session | Provenance `INVESTIGATED` event |
| Tampering | `tamper-analysis.service.ts` + provenance `TAMPERED` |
| Crawler recoveries | `buildLeakIntelligence` (MonitorRecord + crawlResults) |
| Lifecycle trail | `buildLifecycle()` in manifest builder |

**Provenance service:** `src/services/forensics/forensic-provenance.service.ts`  
**Pipeline audit (diagnostic only):** `investigation-pipeline-audit.service.ts`

---

## 9. Confidence and Report Generation

### Confidence layers

| Layer | Description |
|-------|-------------|
| Acceptance confidence | Weighted scorecard from 7 channels |
| Retrieval confidence | Vector/deep DNA fusion; 0 when candidate rejected |
| DNA match percent | From authoritative 15-layer compare |
| Tamper score | From tamper analysis registry |
| Risk level | LOW / MEDIUM / HIGH / CRITICAL based on DNA + tamper |

### Report outputs

| Output | Location |
|--------|----------|
| JSON report | `UnifiedInvestigationReport` from orchestrator |
| Frontend UI | `client/src/pages/UnifiedInvestigationPage.tsx` |
| PDF export | `client/src/services/investigation-report-export.ts` |
| Evidence package ZIP | PDFs + JSON + signed manifest + QR |
| Signed manifest | `src/services/evidence/report-signing.service.ts` |

---

## 10. Investigation Verdicts

### Authoritative verdicts (Acceptance Engine â€” 5 types)

| Verdict | Display Label | Meaning |
|---------|---------------|---------|
| VERIFIED_ORIGINAL | Verified PINIT Asset | Original file identified; DNA â‰¥75%; certificate/vault/owner/timeline PASS; scorecard >95%; no tamper |
| VERIFIED_DERIVATIVE | Original Found â€” Derivative Detected | Original vault identified; probe is altered/tampered derivative |
| POSSIBLE_MATCH | Possible PINIT Asset â€” Needs Manual Review | Partial DNA match; certificate/watermark weak or missing; analyst review required |
| NOT_PINIT | No PINIT Asset Found | No candidate passed acceptance gates |
| INSUFFICIENT_EVIDENCE | Insufficient Evidence â€” Investigation Incomplete | Timeout, corrupt file, or incomplete analysis |

### Forensic verdicts (legacy display mapping â€” 4 types)

| ForensicVerdict | Mapped from |
|-----------------|-------------|
| ORIGINAL_VERIFIED | VERIFIED_ORIGINAL |
| ORIGINAL_FOUND_PARTIAL | VERIFIED_DERIVATIVE |
| POSSIBLE_ASSET | POSSIBLE_MATCH |
| NO_SIGNATURE | NOT_PINIT, INSUFFICIENT_EVIDENCE |

### Report state (UI â€” 3 types)

| ReportState | Mapped from |
|-------------|-------------|
| VERIFIED | VERIFIED_ORIGINAL, VERIFIED_DERIVATIVE |
| POSSIBLE | POSSIBLE_MATCH |
| NO_SIGNATURE | NOT_PINIT, INSUFFICIENT_EVIDENCE |

---

## 11. Tamper Analysis

**File:** `src/services/forensics/tamper-analysis.service.ts`

Registered detectors (19): Compression, Crop, Resize, Rotation, Screenshot, Screen Recording, Metadata Removed, OCR Changes, AI Editing, AI Enhancement, AI Generated, Watermark Damage, Video Re-encoding, Audio Re-encoding, Blur, Contrast/Brightness, Color Filters, Format Conversion, Sharpen.

Detectors are initialised for every investigation; results derived from DNA layer comparison deltas and preprocessing variant analysis (`forensic-image-preprocessor.service.ts`).

---

*End of document*




---

# PINIT-DNA â€” Traceability and Findings

**Document version:** 1.0  
**Purpose:** Answer â€” *At what level can a file found on the internet be traced back to its PINIT origin?*  
**Rule:** Only capabilities verified in code are marked Implemented. Others marked Planned or Not Applicable.

---

## 1. Traceability Model

PINIT-DNA separates two concepts:

| Concept | Description | Status |
|---------|-------------|--------|
| **DNA identity** | Immutable 15-layer fingerprint stored at generation | Implemented |
| **Custody events** | Append-only lifecycle log (download, share, investigation) | Implemented |
| **Post-download tracking** | Continuous monitoring of file on external devices | Not Yet Implemented (web limitation) |

A file recovered from the internet can be traced **only when it is uploaded back into PINIT Investigation** or opened through a PINIT-controlled mechanism that reports to the server.

---

## 2. Traceability Matrix â€” Images

| Capability | Current | Future | Implementation |
|------------|---------|--------|----------------|
| Recover owner | Yes â€” via investigation match + vault record | Enhanced with native app telemetry | `unified-investigation.orchestrator.ts`, vault ownership |
| Recover vault ID | Yes â€” when candidate accepted | Same | Candidate ranking + manifest |
| Recover certificate | Yes â€” when certificate exists for DNA record | Same | `certificate.service.ts` |
| Recover DNA record | Yes â€” authoritative compare locks DNA ID | Same | Authoritative DNA compare |
| Recover watermark | Partial â€” TEP tail, EXIF, LSB, vault identity token | Stronger DCT embed | `tep.service.ts`, `watermark.service.ts`, `vault-watermark-engine.service.ts` |
| Recover timeline | Yes â€” provenance + share access logs | Full event bus | `forensic-provenance.service.ts`, `buildTimeline()` |
| Recover download history | Yes â€” for protected downloads recorded server-side | Native app offline sync | `download-event.service.ts`, provenance `DOWNLOADED` |
| Detect WhatsApp recompression | Partial â€” preprocessing simulates WhatsApp JPEG; investigation may flag | Dedicated messenger classifier | `forensic-image-preprocessor.service.ts` (whatsapp_compress variant) |
| Detect screenshot | Partial â€” screenshot DNA enhancement + tamper detector | ML screenshot classifier | `screenshot-dna.service.ts`, tamper registry |
| Detect crop | Yes â€” partial; local patch DNA rescue for heavy crops | Multi-scale patch index | `candidate-ranking-engine.service.ts`, preprocessor `center_crop` variant |
| Detect resize | Yes â€” via L3 perceptual + tamper Resize detector | Same | `comparison-engine.ts`, tamper analysis |
| Detect metadata removal | Yes â€” L5 mismatch + Metadata Removed tamper flag | Same | Tamper analysis |
| Detect AI generation | Partial â€” L11 heuristic + AI Generated tamper flag | ML deepfake model | `layers-11-15.service.ts`, tamper analysis |
| Detect compression | Yes â€” L3/L1 delta + Compression tamper flag | Same | Tamper analysis, derivative scoring |

**Internet-found image without PINIT interaction:** No automatic trace. Owner recovery requires upload to Investigation.

---

## 3. Traceability Matrix â€” Videos

| Capability | Current | Future |
|------------|---------|--------|
| Recover owner | Yes â€” via investigation | Same |
| Recover vault / DNA / certificate | Yes â€” when match found | Same |
| Recover watermark | Partial â€” binary tail only | Frame-level watermark |
| Recover timeline / downloads | Yes â€” server-side events only | Native viewer events |
| Detect re-encoding | Yes â€” Video Re-encoding tamper detector | ffprobe-based analysis |
| Detect crop / resize | Partial â€” container-level only | Per-frame analysis (Planned) |
| Detect WhatsApp | Not Applicable directly | Messenger-specific heuristics (Planned) |
| Detect screenshot | Partial â€” screen recording detector | Same |
| Detect AI generation | Partial â€” L11 heuristic | ML model (Planned) |

**Limitation:** Video engine uses binary header/chunk SimHash baseline; frame-level pHash not yet implemented.

---

## 4. Traceability Matrix â€” PDF

| Capability | Current | Future |
|------------|---------|--------|
| Recover owner | Yes â€” via investigation | Same |
| Recover vault / DNA / certificate | Yes | Same |
| Recover watermark | Yes â€” PDF metadata + invisible text | Same |
| Recover timeline / downloads | Yes â€” server-side | Same |
| Detect metadata removal | Yes | Same |
| Detect OCR/text changes | Yes â€” OCR Changes tamper flag | Same |
| Detect crop / resize | Not Applicable (page-level reflow) | Page hash comparison (Planned) |
| Detect compression | Partial â€” format conversion flag | Same |
| Detect AI generation | Partial â€” heuristic | Planned |

---

## 5. Traceability Matrix â€” Documents (TXT, CSV, JSON, DOCX, PPTX)

| Capability | Current | Future |
|------------|---------|--------|
| Recover owner | Yes â€” via investigation | Same |
| Recover vault / DNA / certificate | Yes | Same |
| Recover watermark | Partial â€” DOCX custom XML; TXT pass-through | Full zero-width encoding |
| Recover timeline / downloads | Yes â€” server-side | Same |
| Detect text/OCR changes | Yes â€” for PDF/DOCX paths | Same |
| Detect metadata removal | Partial | Same |
| Detect crop / resize / screenshot | Not Applicable | N/A for text documents |
| Detect compression | Partial â€” format conversion | Same |

---

## 6. Traceability Matrix â€” Audio

| Capability | Current | Future |
|------------|---------|--------|
| Recover owner | Yes â€” via investigation | Same |
| Recover vault / DNA / certificate | Yes | Same |
| Recover watermark | Partial â€” binary tail | Psychoacoustic embed (Planned) |
| Recover timeline / downloads | Yes â€” server-side | Same |
| Detect re-encoding | Yes â€” Audio Re-encoding tamper | Chromaprint (Planned) |
| Detect crop / resize / screenshot | Not Applicable | N/A |
| Detect AI generation | Partial â€” heuristic | Planned |

---

## 7. Traceability Matrix â€” ZIP

| Capability | Current | Future |
|------------|---------|--------|
| Recover owner | Yes â€” archive fingerprint match | Inner file extraction (Planned) |
| Recover vault / DNA / certificate | Yes | Same |
| Recover watermark | Partial â€” `.pinit/` manifest in archive | Same |
| Detect tampering | Partial â€” tree structure changes | Per-entry hash (Planned) |

---

## 8. What PINIT Can Prove Today

When a suspect file is uploaded to Unified Investigation and a match is found:

```
PROVEN (Implemented):
  - This file matches Vault ID X
  - DNA Record ID Y belongs to Owner Z
  - Certificate C was issued (if exists)
  - File was downloaded via Protected Download at time T from IP/location (if recorded)
  - File was shared via Smart Link (if recorded)
  - Tamper vectors detected on probe vs original
  - Investigation occurred at time T (provenance INVESTIGATED event)

NOT PROVEN (Web limitation):
  - Where the file travelled after download to WhatsApp/Telegram/email
  - Who opened the file on another person's device
  - Continuous GPS tracking of the file offline
  - Automatic detection of file appearing on arbitrary websites (requires Monitor enrollment)
```

---

## 9. Internet / Crawler Recovery

| Capability | Status | Reference |
|------------|--------|-----------|
| URL monitoring enrollment | Implemented | `monitoring.routes.ts`, `MonitorRecord` |
| Crawler filename search | Implemented | `filename-search.provider.ts` |
| Crawler detection provenance event | Not Yet Implemented | `CRAWLER_DETECTION` declared but no append call site |
| Automatic internet-wide search | Not Yet Implemented | Requires enrolled watch URLs |

---

## 10. TEP Re-Discovery

When a TEP-exported file is re-uploaded:

| Step | Status |
|------|--------|
| Extract TEP tail from file | Implemented â€” `tep.service.ts extractFromFile()` |
| Match to TrackedExportPackage | Implemented |
| Mark REDISCOVERED | Implemented â€” `duplicate-check.service.ts` |
| Block if TEP revoked | Not Yet Implemented |
| Append RECOVERED provenance event | Not Yet Implemented |

---

## 11. Summary Table

| File found on internet | Can trace to PINIT owner? | Condition |
|------------------------|---------------------------|-----------|
| Original PINIT file (unmodified) | High confidence | Upload to Investigation |
| Compressed/cropped derivative | Mediumâ€“High | Investigation + derivative scoring |
| WhatsApp-forwarded image | Medium | Recompression heuristics; no forward event |
| Screenshot of PINIT file | Lowâ€“Medium | Screenshot DNA + tamper flags |
| File never exported via PINIT | None | No embedded markers |
| File from protected download | High (if TEP intact) | TEP tail + investigation |
| File found by crawler | Medium | Only if monitor enrolled for that DNA |

---

*End of document*




---

# PINIT-DNA â€” Revocation Architecture

**Document version:** 1.0  
**Primary references:** `src/services/provenance/revoke.service.ts`, `src/services/share/share-link.service.ts`, `src/services/certificates/certificate.service.ts`, `src/services/tep/tep.service.ts`

---

## 1. Revocation Principles

| Principle | Detail |
|-----------|--------|
| DNA is never revoked | DNA records are immutable identity anchors |
| Revocation is metadata-level | Changes access rights and registry status, not file bytes |
| Append-only audit | Revocation events are logged; prior events are never deleted |
| Downloaded files persist | Bytes already on a user's device cannot be remotely deleted |

---

## 2. Revocation Matrix

### 2.1 Share Links

| Item | Can Revoke? | Mechanism | File |
|------|-------------|-----------|------|
| Active share link | Yes | `isActive = false` | `share-link.service.ts` |
| Future access via link | Yes | 404 on revoked token | Share controller |
| Per-viewer access | Yes | `BlockedShareViewer` row | `blockViewer()` |
| One-time links | Auto-revoke | First view triggers revoke | `share-link.service.ts` |
| High-risk links | Auto-revoke | Risk score â‰¥ 85 + suspicious actions | `share-link.service.ts` |
| Already-viewed sessions | Partial | Force-logout via link revoke | Implemented |
| Downloaded file from share | No | Bytes already exported | Web limitation |
| Provenance REVOKED event on share revoke | No | Not Yet Implemented | Legacy synthesis only |

### 2.2 Protected Download

| Item | Can Revoke? | Mechanism |
|------|-------------|-----------|
| Future protected downloads | N/A | Each download is a new event |
| TEP package tied to download | Yes | TEP revoke (see below) |
| Already-downloaded file | No | Web limitation |
| Download event record | No | Append-only; cannot un-record |

### 2.3 TEP (Tracked Export Package)

| Item | Can Revoke? | Mechanism | File |
|------|-------------|-----------|------|
| TEP manifest status | Yes | `status = REVOKED` | `revoke.service.ts` |
| Provenance REVOKED event | Yes | `forensicProvenanceService.append()` | `revoke.service.ts` |
| API endpoint | Yes | `POST /vault/:id/tep/:tepCode/revoke` | `vault.controller.ts` |
| Watermark/tail in exported file | No | Embedded bytes remain |
| TEP re-discovery on upload | Yes (partial) | Shows REVOKED in dashboard; extraction still matches | Not Yet Implemented: block on REVOKED |
| TEP expiry enforcement | No | `expiresAt` stored but not enforced | Not Yet Implemented |

### 2.4 Certificates

| Item | Can Revoke? | Mechanism |
|------|-------------|-----------|
| Certificate validity | Yes | `status = REVOKED`, `revokedAt` set |
| Future verification | Yes | Verification fails |
| Investigation reference | Partial | Timeline shows REVOKED via legacy synthesis |
| Live provenance REVOKED append | No | Not Yet Implemented on revoke action |
| DNA record | No | Immutable |

### 2.5 Future: PINIT Viewer (Planned)

| Item | Expected capability | Status |
|------|---------------------|--------|
| Revoke viewer session | Planned | Not Yet Implemented |
| Block file open after revoke | Planned â€” requires PINIT-controlled viewer | Not Yet Implemented |
| Real-time access revocation | Planned | Not Yet Implemented |

### 2.6 Future: Native App (Planned)

| Item | Expected capability | Status |
|------|---------------------|--------|
| Device-bound licence revocation | Planned | Not Yet Implemented |
| Encrypted container invalidation | Planned | Not Yet Implemented |
| Offline revocation cache sync | Planned | Not Yet Implemented |

---

## 3. What Cannot Be Revoked â€” Technical Reasons

| Asset | Why |
|-------|-----|
| Downloaded file bytes | HTTP download transfers a copy; server has no filesystem access to recipient device |
| Embedded watermark / TEP tail | Cryptographic markers are part of file content; revocation changes registry only |
| DNA fingerprint | Immutable by design â€” identity cannot be "un-issued" |
| Append-only provenance events | Audit integrity requires no deletion |
| Investigation reports already generated | Reports are point-in-time sealed manifests |

---

## 4. Legal Limitations

| Limitation | Explanation |
|------------|-------------|
| Jurisdiction | Revocation of access links is enforceable server-side; physical file possession is not |
| Third-party platforms | WhatsApp, email, cloud drives are outside PINIT control |
| Evidence admissibility | Revocation timestamp proves intent; does not destroy copies already distributed |
| DMCA / takedown | Separate workflow; not automated in current codebase |

---

## 5. Enterprise Recommendations

1. **Use Protected Download** for sensitive exports â€” creates TEP + custody event with IP/geo/device.
2. **Set share link expiry** and one-time links for high-risk recipients.
3. **Revoke TEP promptly** when recipient relationship ends â€” status visible in Tracking Dashboard.
4. **Revoke certificates** when ownership transfers or evidence is invalidated.
5. **Plan native viewer** for scenarios requiring post-download access control.
6. **Do not assume WhatsApp tracking** â€” forward events are not captured by web application.

---

## 6. Why Downloaded Files Cannot Be Remotely Deleted (Web Application)

```
Owner clicks Protected Download
        |
        v
Server encrypts/decrypts vault file
        |
        v
Server embeds TEP watermark + tail
        |
        v
HTTP response sends file bytes to browser
        |
        v
Browser saves to local disk / shares via OS
        |
        v
[ SERVER LOSES CONTROL ]
        |
        v
File exists independently on recipient device
```

**Technical facts:**

- Web browsers do not grant servers write access to user filesystems after download.
- HTTPS delivers a **copy**; the original vault ciphertext remains on Supabase Storage.
- Revocation can only invalidate **future server-mediated access** (links, TEP registry, certificates).
- Re-upload to Investigation is the recovery mechanism for tracing leaked copies.

---

## 7. Why Native Applications Provide Stronger Control

| Web (current) | Native app (planned) |
|---------------|----------------------|
| File saved to OS filesystem | File opened in PINIT encrypted container |
| No open-event telemetry after download | Viewer can report OPENED events |
| Watermark is passive marker | Active licence check on each open |
| Revocation is registry-only | Revocation can block container decryption |
| No background monitoring | Optional device policy integration |

Native apps can implement:

- Device-bound decryption keys
- Online licence validation before open
- Session heartbeat reporting
- Encrypted export with expiry built into container format

These are **Planned/Future** â€” not present in the current web codebase.

---

## 8. Revocation API Summary

| Action | Method | Endpoint |
|--------|--------|----------|
| Revoke share link | DELETE | `/api/v1/share/:token` |
| Block viewer | POST | `/api/v1/share/:token/block-viewer` |
| Revoke TEP | POST | `/api/v1/vault/:id/tep/:tepCode/revoke` |
| Revoke certificate | POST | `/api/v1/certificates/revoke/:id` |
| Revoke auth session | DELETE | `/api/v1/profile/session/:id` |

---

*End of document*




---

# PINIT-DNA â€” Chain of Custody

**Document version:** 1.0  
**Primary references:** `src/services/forensics/forensic-provenance.service.ts`, `src/services/provenance/chain-of-custody.service.ts`, `docs/FORENSIC_PROVENANCE.md`

---

## 1. Principle

**DNA is immutable identity. Custody is append-only events.**

Lifecycle tracking (who did what, when, from where) is stored in `forensic_provenance_events` and synthesised from legacy tables. DNA layers are never modified after generation.

---

## 2. File Lifecycle Flow

```
File Created (user upload)
        |
        v
DNA Generated --------------------> Event: DNA_GENERATED
        |                           Source: dna.orchestrator.ts, universal engines
        v
Encrypted (AES-256-GCM) ---------> Event: ENCRYPTED
        |                           Source: vault.service.ts
        v
Stored in Vault -----------------> Event: VAULT_STORED
        |                           Source: vault.service.ts, vault.controller.ts
        v
Certificate Issued (optional) ---> Event: CERTIFICATE_ISSUED
        |                           Source: certificate.service.ts
        v
Protected Download / TEP --------> Events: PROTECTED_EXPORT, TEP_CREATED, DOWNLOADED
        |                           Source: tep.service.ts, download-event.service.ts
        v
Shared (Smart Link) -------------> Events: SHARED, OPENED (legacy synthesis)
        |                           Source: share_links, share_access_logs
        v
Viewed (share viewer) -----------> Event: OPENED
        |                           Source: share_access_logs (legacy synthesis)
        v
Recovered (re-upload) -----------> Status: REDISCOVERED on TEP table
        |                           Provenance RECOVERED: Not Yet Implemented
        v
Investigation -------------------> Event: INVESTIGATED
        |                           Source: unified-investigation.orchestrator.ts
        v
Tamper Detected -----------------> Event: TAMPERED (when tamper vectors found)
        |
        v
Revoked (optional) --------------> Event: REVOKED
                                    Source: revoke.service.ts, certificate revoke
        |
        v
Report Generated ----------------> Sealed investigation manifest (point-in-time)
```

---

## 3. Event Types

Declared in `PROVENANCE_EVENT_TYPES` (`forensic-provenance.service.ts`):

| Event Type | Runtime Append | Source |
|------------|----------------|--------|
| DNA_GENERATED | Yes | DNA orchestrator / universal router |
| ENCRYPTED | Yes | vault.service.ts |
| VAULT_STORED | Yes | vault.service.ts, vault.controller.ts |
| CERTIFICATE_ISSUED | Yes | certificate.service.ts |
| DOWNLOADED | Yes | download-event.service.ts |
| PROTECTED_EXPORT | Yes | tep.service.ts (owner protected download) |
| TEP_CREATED | Yes | tep.service.ts (share download) |
| SHARED | Legacy synthesis | share_links table |
| OPENED | Legacy synthesis | share_access_logs |
| FORWARDED | Not Yet Implemented | Declared only |
| RECOVERED | Not Yet Implemented | TEP uses REDISCOVERED status instead |
| INVESTIGATED | Yes | unified-investigation.orchestrator.ts |
| TAMPERED | Yes | unified-investigation.orchestrator.ts |
| CRAWLER_DETECTION | Not Yet Implemented | Declared only |
| REVOKED | Partial | TEP revoke yes; certificate via legacy synthesis |

---

## 4. Event Record Fields

Table: `forensic_provenance_events`

| Field | Description |
|-------|-------------|
| id | UUID primary key |
| createdAt | Timestamp (append-only) |
| eventType | One of PROVENANCE_EVENT_TYPES |
| dnaRecordId | Link to DNA record |
| vaultId | Link to vault record |
| certificateId | Link to certificate |
| tepCode | TEP package code |
| shareLinkId | Share link ID |
| investigationId | Investigation session ID |
| actorUserId | User who triggered event |
| actorLabel | Human-readable actor (e.g. recipient label) |
| summary | Event description |
| payload | JSON additional data |
| country, region, city | Geo from IP or GPS |
| latitude, longitude | GPS coordinates (when shared) |
| locationSource | ip / gps / none |
| ipAddress | Client IP |
| userAgent | Browser user agent |
| device | Parsed device string |
| dedupeKey | Prevents duplicate writes |

---

## 5. Database Tables Involved

| Table | Role in custody |
|-------|-----------------|
| forensic_provenance_events | Primary append-only event store |
| dna_records | DNA identity anchor |
| vault_records | Encrypted file storage metadata |
| certificates | Issued ownership certificates |
| tracked_export_packages | TEP manifests |
| share_links | Smart link definitions |
| share_access_logs | Viewer access events |
| metadata_layer | EXIF/GPS at DNA generation |
| watermark_profiles | Per-recipient watermark records |
| verification_logs | DNA verification runs |

**Migration:** `prisma/migrations/20260704140000_forensic_provenance_events/migration.sql`  
**Bootstrap script:** `scripts/ensure-provenance-table.cjs` (for databases without Prisma migrate history)

---

## 6. Chain of Custody Service

**File:** `src/services/provenance/chain-of-custody.service.ts`

Read-only projection for reports. Steps ordered:

1. DNA Generated  
2. Encrypted  
3. Vault Stored  
4. Certificate Issued  
5. Protected Export / TEP Created  
6. Downloaded  
7. Shared  
8. Opened  
9. Recovered  
10. Investigated  
11. Tampered  
12. Revoked  

Unknown event types appended after ordered types, sorted by timestamp.

Consumed by: `tracking-dashboard.service.ts`, investigation reports (`evidenceTimeline`, `provenanceSummary`).

---

## 7. Location in Custody Chain

Location is **custody evidence**, not DNA:

| Location type | Source |
|---------------|--------|
| Creation | EXIF GPS from metadata_layer OR DNA_GENERATED provenance event with GPS |
| Shared | Latest DOWNLOADED / PROTECTED_EXPORT / SHARED event with geo |
| Present (last known) | Most recent provenance event with geo for DNA record |

Function: `getLocationStatusForAssets()` in `forensic-provenance.service.ts`  
Optional client GPS: `client/src/lib/location-consent.ts` at DNA generation and vault store.

---

## 8. Current Implementation Status

| Feature | Status |
|---------|--------|
| Append-only provenance table | Implemented |
| Legacy timeline synthesis | Implemented |
| Chain-of-custody report projection | Implemented |
| Vault tracking dashboard | Implemented |
| Event bus (in-process) | Implemented â€” `src/services/provenance/event-bus.ts` |
| Live SHARED append on link create | Not Yet Implemented |
| FORWARDED / RECOVERED / CRAWLER_DETECTION events | Not Yet Implemented |
| Dedicated download_events table | Not Yet Implemented (uses provenance payload) |
| Certificate revoke provenance append | Not Yet Implemented (legacy synthesis only) |

---

## 9. Future Improvements

| Improvement | Description | Status |
|-------------|-------------|--------|
| Native app OPENED events | Report when file opened in PINIT viewer | Planned |
| CRAWLER_DETECTION append | Write provenance when monitor finds file | Planned |
| Share revoke provenance | Live REVOKED on share link deactivate | Planned |
| Async event queue (BullMQ/Redis) | Non-blocking provenance writes at scale | Planned |
| Formal chain hash linking | Each event hashes previous event ID | Planned |
| GPS continuous tracking | Background location after download | Planned â€” requires native app |

---

*End of document*




---

# PINIT-DNA â€” Protected Download and TEP

**Document version:** 1.0  
**Primary references:** `src/services/tep/tep.service.ts`, `src/services/vault/protected-download.service.ts`, `src/services/provenance/download-event.service.ts`, `docs/TEP_TRACKING_AUDIT.md`

---

## 1. What is TEP?

**TEP (Tracked Export Package)** is PINIT-DNA's system for exporting vault files with embedded forensic tracking markers. Version in code: **TEP v3.0**.

TEP creates a unique package record (`tepCode`) linked to DNA, vault, recipient, and export metadata. The exported file carries:

1. Steganographic/metadata watermark  
2. Structural binary tail (`TEP-MANIFEST:...:END-TEP-MANIFEST`) with HMAC signature  
3. Optional identity re-embedding from vault download pipeline  

**TEP is not DNA.** TEP tracks custody of exported copies. DNA remains the immutable identity anchor.

---

## 2. Two Export Channels

| Channel | Trigger | shareLinkId pattern | Provenance event |
|---------|---------|---------------------|------------------|
| Owner Protected Download | POST `/vault/:id/protected-download` | `protected-download:{vaultId}` | PROTECTED_EXPORT + DOWNLOADED |
| Share Link Download | Share viewer download | Real ShareLink.id | TEP_CREATED + DOWNLOADED |

---

## 3. Protected Download Flow

```
User selects Protected Download in Vault UI
        |
        v
POST /vault/:id/protected-download/prepare
        |  Ownership check, decrypt preview, steps list
        v
POST /vault/:id/protected-download
        |
        +--> protectedDownloadService.prepare()
        |       Ownership, decrypt, DNA check
        |       Certificate verify (if cert exists)
        |       Identity verify + re-embed token
        |
        +--> tepService.createTrackedExport() [if TEP enabled]
        |       Embed watermark + structural tail
        |       Write tracked_export_packages row
        |       Append PROTECTED_EXPORT / TEP_CREATED
        |
        +--> recordProtectedDownload()
        |       Append DOWNLOADED provenance event
        |       Emit event bus: download.recorded
        |
        v
HTTP response: file bytes + headers
        X-PINIT-Download-Event-Id
        X-TEP-Code
        X-PINIT-TEP-Tracking: full | partial | off
```

**Failure policy:** If tracking fails, download still proceeds (`tepTrackingFailed` flag in response headers).

---

## 4. TEP Generation

**File:** `src/services/tep/tep.service.ts`

| Step | Action |
|------|--------|
| 1 | Generate unique `tepCode` |
| 2 | Create watermark profile for recipient |
| 3 | Embed watermark (PDF metadata, image EXIF, DOCX XML, or pass-through) |
| 4 | Append HMAC-signed structural tail to file bytes |
| 5 | Compute `exportSha256`, `sourceSha256`, `watermarkHash` |
| 6 | Store `TrackedExportPackage` row |
| 7 | Append provenance event (non-blocking) |

### TrackedExportPackage fields

| Field | Description |
|-------|-------------|
| tepCode | Unique package identifier |
| dnaRecordId | Linked DNA |
| vaultId | Linked vault |
| shareLinkId | Channel identifier |
| recipientId | Recipient profile or logical owner ID |
| watermarkCode | Watermark profile code |
| sourceSha256 | Original vault file hash |
| exportSha256 | Exported file hash |
| embeddedLayers | JSON list of embedded layer types |
| ipAddress, country, region, city | Geo from client IP |
| userAgent, device | Client device info |
| ownerUserId | Vault owner |
| expiresAt | Expiry timestamp (default 90 days) |
| status | ACTIVE / EXPIRED / REVOKED / REDISCOVERED |

---

## 5. Information Recorded Per Download

| Field | Recorded? | Storage location |
|-------|-----------|------------------|
| IP address | Yes | provenance event + TEP row |
| Country | Yes | Geo-IP lookup via `geo-ip.service.ts` |
| City | Yes | Geo-IP lookup |
| Region | Yes | Geo-IP lookup |
| Browser / User agent | Yes | Request header |
| Device | Yes | Parsed from user agent |
| Timestamp | Yes | `createdAt` on event and TEP row |
| Owner | Yes | `ownerUserId`, actor fields |
| Vault ID | Yes | `vaultId` |
| DNA Record ID | Yes | `dnaRecordId` |
| Certificate ID | Yes | When applicable |
| Recipient label | Yes | Request body `recipientLabel` |
| Purpose | Yes | Request body `purpose` |
| Expiry days | Yes | Request body `expiryDays` |
| TEP ID (tepCode) | Yes | TEP row + response header |
| Download Event ID | Yes | UUID in payload + `X-PINIT-Download-Event-Id` header |
| GPS (client) | Partial | Only if user grants location at vault store / DNA generation |

**No dedicated `download_events` table** â€” events stored in `forensic_provenance_events` with `downloadEventId` in JSON payload.

---

## 6. What TEP Can Track Today

```
IMPLEMENTED TODAY:
  [x] Record that a protected download occurred
  [x] Record IP, country, city, region (via Geo-IP)
  [x] Record browser, device, timestamp
  [x] Record recipient label and purpose
  [x] Assign unique TEP code per export
  [x] Embed recoverable markers in exported file
  [x] Re-discover exported file when re-uploaded to PINIT
  [x] Display download timeline in Vault Tracking Dashboard
  [x] Revoke TEP package (registry status)
  [x] Include download events in investigation report timeline

NOT TRACKED TODAY:
  [ ] Where file goes after download (WhatsApp, email, USB)
  [ ] Who opens file on another device
  [ ] Continuous GPS of exported file
  [ ] Automatic notification when file appears online (requires Monitor)
  [ ] Enforcement of TEP expiry date
  [ ] Blocking extraction of revoked TEP files
```

---

## 7. TEP Re-Discovery

When a TEP-marked file is uploaded again:

| Step | File | Status |
|------|------|--------|
| Extract tail manifest | `tep.service.ts extractFromFile()` | Implemented |
| Match TrackedExportPackage | By exportSha256 | Implemented |
| Mark REDISCOVERED | `duplicate-check.service.ts` | Implemented |
| Audit log TEP_REDISCOVERED | audit.service.ts | Implemented |

---

## 8. Tracking Dashboard

**Endpoint:** `GET /api/v1/vault/:id/tracking`  
**Service:** `src/services/provenance/tracking-dashboard.service.ts`

Displays:

- TEP packages for vault  
- Download events  
- Chain of custody links  
- Location status (creation / shared / present)  
- Revoke action per TEP  

**UI:** `client/src/pages/VaultPage.tsx` â€” TrackingDashboardModal

---

## 9. Environment Flags

| Variable | Default | Effect |
|----------|---------|--------|
| TEP_PROTECTED_DOWNLOAD_ENABLED | true | TEP embedding on protected download |
| PROTECTED_DOWNLOAD_ENABLED | true | Protected download feature gate |

---

## 10. Limitations

| Limitation | Detail |
|------------|--------|
| Web-only export | File leaves PINIT control after HTTP download |
| WhatsApp sharing | No server-side forward event |
| localhost Geo-IP | Returns generic/empty geo in development |
| TEP expiry | Stored but not enforced at extraction |
| Revoked TEP | Status changes in DB; file bytes unchanged |
| TXT/CSV share watermark | Pass-through â€” no embed on some MIME types |
| Free-tier Render cold start | First download may delay 30â€“90 seconds |

---

## 11. Future Native App Enhancements (Planned)

| Enhancement | Description |
|-------------|-------------|
| PINIT Viewer | Open exports only in controlled viewer; report OPENED events |
| Device-bound TEP | Decryption key tied to device registration |
| Offline custody queue | Sync provenance events when device reconnects |
| GPS at download | Native geolocation permission with higher accuracy |
| Expiry enforcement | Block open after expiresAt |
| Push notification on re-discovery | Alert owner when TEP file investigated |

---

## 12. API Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/vault/:id/protected-download/prepare` | Preview steps |
| POST | `/vault/:id/protected-download` | Execute download + TEP |
| GET | `/vault/:id/tracking` | Tracking dashboard data |
| POST | `/vault/:id/tep/:tepCode/revoke` | Revoke TEP package |
| GET | `/tep/manifests?dnaRecordId=` | List TEP manifests |

---

*End of document*




---

# PINIT-DNA â€” Limitations and Future Roadmap

**Document version:** 1.0  
**Purpose:** Honest assessment of current constraints and planned enhancements  
**Rule:** Limitations verified from code and deployment behaviour; future items marked Planned unless implemented

---

## 1. Current Limitations

### 1.1 Web Application Limitations

| Limitation | Detail |
|------------|--------|
| No post-download tracking | After HTTP download, server cannot monitor file on recipient device |
| No remote file deletion | Downloaded bytes cannot be revoked or erased remotely |
| No WhatsApp forward detection | Sharing via messenger does not generate server events |
| Browser-only GPS | Location requires user consent; accuracy varies; no background tracking |
| JWT session bound to browser | Token in localStorage; clearing browser data requires re-login |
| Render free-tier cold starts | First API call after idle may take 30â€“90 seconds |
| Investigation timeouts | Large files / heavy crops may hit timeout on free-tier (`investigation-performance.ts`) |
| Single backend instance | No horizontal scaling configuration in `render.yaml` free plan |

### 1.2 DNA Engine Limitations

| Limitation | Detail |
|------------|--------|
| L11 deepfake | Heuristic byte analysis only â€” not ML model |
| L12 watermark record | Hash stored; actual DCT embed depends on vault/TEP pipeline |
| L14 ZK proof | Hash commitment â€” not true zero-knowledge protocol |
| L15 biometric | Database face embedding hash; not embedded in file by default |
| Video engine | Binary header/chunk SimHash; ffprobe/keyframe pHash not implemented |
| Audio engine | Chunk SimHash; Chromaprint not implemented |
| Probe L11â€“L15 | Not generated during investigation probe (no ownerUserId on probe path) |
| L7â€“L15 comparison weight | Zero weight in DNA score during standard compare |

### 1.3 Investigation Limitations

| Limitation | Detail |
|------------|--------|
| Heavy crop matching | May require local patch DNA rescue; not guaranteed for all crops |
| Camera scan quality | Probe DNA quality depends on capture conditions |
| INSUFFICIENT_EVIDENCE | Returned on timeout before vault candidate locked |
| Single winner | Ranking walks candidates but reports one accepted candidate |
| image-candidate-acceptance.service.ts | Exists but not wired into live pipeline |

### 1.4 Provenance and TEP Limitations

| Limitation | Detail |
|------------|--------|
| TEP expiry not enforced | expiresAt stored; extraction does not check |
| Revoked TEP still matches | duplicate-check does not filter REVOKED status |
| No dedicated download_events table | Uses provenance payload only |
| FORWARDED / RECOVERED / CRAWLER_DETECTION | Declared but not appended at runtime |
| Share revoke provenance | No live REVOKED append on share deactivate |
| Certificate revoke provenance | Legacy synthesis only |

### 1.5 Deployment Limitations

| Limitation | Detail |
|------------|--------|
| Prisma migrate on existing DB | P3005 error on databases without migration history; workaround via `ensure-provenance-table.cjs` |
| Multiple Render services | Must ensure Vercel frontend points to backend with correct Supabase DATABASE_URL |
| Python AI sidecar | Optional; not started in production by default |
| Apache Tika | Optional; enhanced metadata when available |

---

## 2. Future Enhancements

### Phase A â€” Stabilise Investigation (In Progress)

| Item | Status |
|------|--------|
| Evidence pairing L6/L7â€“L15 | Implemented |
| Timeout tuning for Render | Implemented |
| Derivative-aware scoring | Implemented |
| Deterministic investigation runs | Ongoing |

### Phase B â€” Protected Download + TEP (Implemented)

| Item | Status |
|------|--------|
| TEP v3.0 multi-layer export | Implemented |
| Download custody events | Implemented |
| Tracking dashboard | Implemented |
| TEP revoke | Implemented |

### Phase C â€” Evidence Timeline (Partially Implemented)

| Item | Status |
|------|--------|
| Append-only provenance table | Implemented |
| Investigation timeline attachment | Implemented |
| Live SHARED/OPENED append | Not Yet Implemented |
| Visual timeline UI (react-vertical-timeline) | Planned |

### Phase D â€” Chain of Custody (Partially Implemented)

| Item | Status |
|------|--------|
| chain-of-custody.service.ts | Implemented |
| Event hash chaining | Planned |
| Formal legal export format | Planned |

### Phase E â€” Investigation Dashboard (Partially Implemented)

| Item | Status |
|------|--------|
| Unified Investigation page | Implemented |
| PDF/ZIP report export | Implemented |
| Forensic dashboard | Implemented |
| Enterprise analyst portal | Planned |

### Phase F â€” Native Mobile/Desktop Apps (Planned)

| Item | Description |
|------|-------------|
| PINIT Viewer | Controlled file open with licence check |
| Device-bound encryption | Stronger post-download control |
| Background custody sync | Offline event queue |
| Native GPS | Higher accuracy location at generation/download |
| Push alerts | Re-discovery and leak notifications |

### Phase G â€” AI Enhancements (Optional / Planned)

| Item | Description |
|------|-------------|
| ML deepfake detection | Replace L11 heuristics |
| Camera quality assessment | Pre-scan quality gate |
| Document boundary detection | Auto-crop for camera scans |
| Semantic similarity upgrade | Better difficult-case matching |
| CLIP embeddings (DNA_L11_CLIP) | Config flag exists; default off |

---

## 3. Web vs Native Comparison

| Capability | Web (current) | Native (planned) |
|------------|---------------|------------------|
| DNA generation | Yes | Yes |
| Vault encryption | Yes | Yes |
| Protected download | Yes | Yes + device binding |
| Post-download tracking | No | Partial (viewer events) |
| Offline file control | No | Yes (encrypted container) |
| GPS background | No | Possible with permission |
| Remote revocation of file open | No | Yes (licence check) |
| WhatsApp detection | No | No (platform limitation) |

---

## 4. Continuous and Offline Tracking

| Feature | Current | Future |
|---------|---------|--------|
| Continuous file location tracking | Not Yet Implemented | Native app + viewer |
| Offline event recording | Not Yet Implemented | Native queue + sync |
| GPS at DNA generation | Optional consent (web) | Native high-accuracy |
| GPS at download | Geo-IP only | Client GPS + Geo-IP |
| Monitor crawler | Implemented (enrollment required) | Enhanced providers |

---

## 5. Protected Viewer (Planned)

Not Yet Implemented. Planned capabilities:

- Open TEP exports only inside PINIT Viewer  
- Report OPENED events with session ID  
- Enforce TEP expiry and revocation before decrypt  
- Block screenshot (platform-dependent)  

---

## 6. Leak Intelligence

| Feature | Status |
|---------|--------|
| Leak attribution API | Implemented â€” `share-link.controller.ts` forensics/attribute-leak |
| Leak intelligence in investigation | Implemented â€” `buildLeakIntelligence()` |
| Monitor alerts | Implemented |
| Automatic internet-wide leak search | Not Yet Implemented |

---

## 7. Crawler

| Feature | Status |
|---------|--------|
| Monitor enrollment | Implemented |
| Filename search provider | Implemented |
| Scheduled checks | Implemented â€” vault-scheduler |
| CRAWLER_DETECTION provenance | Not Yet Implemented |
| Image similarity crawl | Planned |

---

## 8. Deep Learning

| Feature | Status |
|---------|--------|
| Python AI sidecar (embeddings, OCR, vision) | Implemented â€” `python-ai/` |
| FAISS vector index | Implemented |
| Semantic search | Implemented |
| CLIP layer (L11) | Config flag off by default |
| Neural deepfake model | Planned |
| Self-learning DNA (DNA_P2_SELF_LEARNING) | Config flag off by default |

---

## 9. Known Technical Debt

| Item | Location |
|------|----------|
| README describes "6-layer" in places | README.md, package.json |
| layers/index.ts exports L1â€“L6 only | src/services/layers/index.ts |
| Multiple Render backend URLs historically | api.config.ts (corrected to pinit-dna-uf5y) |
| org/main branch behind ashwitha | Git branches diverged |

---

*End of document*



