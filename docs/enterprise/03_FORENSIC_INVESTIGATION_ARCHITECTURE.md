# PINIT-DNA — Forensic Investigation Architecture

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

## 3. Enterprise Recovery — Internal Stages

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
        v  Top 30 (RANKING_TOP_IDENTITY) — identity hit promoted
Identity filter
        |
        v  Top 20 (RANKING_TOP_MEDIA)
Media filter
        |
        v  Top 2–4 (RANKING_TOP_DEEP or RANKING_TOP_DEEP_STRONG_LEAD)
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

1. SHA-256 exact match → immediate accept as VERIFIED_ORIGINAL
2. For each deep-pool candidate: run deep DNA compare
3. Hard DNA gate: reject if score < 40 or classification DIFFERENT (unless exact hash or local-patch rescue)
4. Run Acceptance Engine per candidate
5. Accept on VERIFIED_ORIGINAL, VERIFIED_DERIVATIVE, or POSSIBLE_MATCH
6. Reject and try next candidate — does not stop at rank #1 by default

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

1. INSUFFICIENT_EVIDENCE — analysis incomplete
2. NOT_PINIT — no candidate
3. VERIFIED_ORIGINAL — full DNA pass, all gates PASS, scorecard > 95, no tamper
4. VERIFIED_DERIVATIVE — DNA + visual + tamper detected
5. POSSIBLE_MATCH — partial DNA + vault locked + weak/missing cert/watermark
6. Default → NOT_PINIT

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

Evidence is assembled from multiple sources — not a separate graph database class, but connected nodes in the report:

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

### Authoritative verdicts (Acceptance Engine — 5 types)

| Verdict | Display Label | Meaning |
|---------|---------------|---------|
| VERIFIED_ORIGINAL | Verified PINIT Asset | Original file identified; DNA ≥75%; certificate/vault/owner/timeline PASS; scorecard >95%; no tamper |
| VERIFIED_DERIVATIVE | Original Found — Derivative Detected | Original vault identified; probe is altered/tampered derivative |
| POSSIBLE_MATCH | Possible PINIT Asset — Needs Manual Review | Partial DNA match; certificate/watermark weak or missing; analyst review required |
| NOT_PINIT | No PINIT Asset Found | No candidate passed acceptance gates |
| INSUFFICIENT_EVIDENCE | Insufficient Evidence — Investigation Incomplete | Timeout, corrupt file, or incomplete analysis |

### Forensic verdicts (legacy display mapping — 4 types)

| ForensicVerdict | Mapped from |
|-----------------|-------------|
| ORIGINAL_VERIFIED | VERIFIED_ORIGINAL |
| ORIGINAL_FOUND_PARTIAL | VERIFIED_DERIVATIVE |
| POSSIBLE_ASSET | POSSIBLE_MATCH |
| NO_SIGNATURE | NOT_PINIT, INSUFFICIENT_EVIDENCE |

### Report state (UI — 3 types)

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
