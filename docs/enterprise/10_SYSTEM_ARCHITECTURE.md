# PINIT-DNA — System Architecture

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
|              FRONTEND — React + TypeScript + Vite                 |
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
|              BACKEND — Node.js + Express + TypeScript             |
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
|              DATABASE — PostgreSQL (Supabase)                     |
|              STORAGE — Supabase Storage (vault-files)             |
+------------------------------------------------------------------+
                              |
                              v (optional, dev)
+------------------------------------------------------------------+
|              PYTHON AI SIDECAR — FastAPI (port 8001)              |
|              OCR, embeddings, vision, document analysis           |
+------------------------------------------------------------------+
```

---

## 2. Request Flow — DNA Generation

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

## 3. Request Flow — Vault Store

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

## 4. Request Flow — Unified Investigation

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

### 5.4 Layer Services (L1–L15)

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
| L11–L15 | services/layers/layers-11-15.service.ts |

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

**ORM:** Prisma — `prisma/schema.prisma`

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
  tenant-scope.ts — all queries scoped to JWT sub
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

**Start command (Render):** `npm run render:start` → `ensure-provenance-table.cjs` + `node dist/server.js`

---

*End of document*
